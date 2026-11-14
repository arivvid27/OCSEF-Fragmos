"""Every domain type SENTINEL's core speaks. Pure: stdlib only.

wire.py parses Anthropic JSON into these types once. Nothing here knows the wire format except Opaque.raw and
the `extra` maps, which are carried and never interpreted.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field, replace
from enum import Enum, IntEnum
from typing import Any, Callable, ClassVar, Iterator, Literal, Mapping

JSON = Any


class Tier(IntEnum):
    PUBLIC = 0
    INTERNAL = 1
    CONFIDENTIAL = 2
    RESTRICTED = 3


class Action(str, Enum):
    ALLOW = "ALLOW"
    REDACT = "REDACT"
    REROUTE = "REROUTE"
    HOLD = "HOLD"
    BLOCK = "BLOCK"


class Trust(str, Enum):
    CLOUD = "cloud"
    LOCAL = "local"


@dataclass(frozen=True)
class Upstream:
    id: str
    trust: Trust
    base_url: str
    model: str
    api_key_env: str | None
    simulated: bool = False  # a scripted stand-in, not a real model; the event log says so


@dataclass(frozen=True)
class Text:
    text: str
    extra: Mapping[str, JSON] = field(default_factory=dict)


@dataclass(frozen=True)
class ToolUse:
    id: str
    name: str
    input: JSON
    extra: Mapping[str, JSON] = field(default_factory=dict)


@dataclass(frozen=True)
class ToolResult:
    tool_use_id: str
    content: tuple[Block, ...]
    extra: Mapping[str, JSON] = field(default_factory=dict)


@dataclass(frozen=True)
class Opaque:
    """thinking, redacted_thinking, image, or any unknown block. Re-emitted as the identical dict."""

    raw: Mapping[str, JSON]


Block = Text | ToolUse | ToolResult | Opaque


@dataclass(frozen=True)
class Message:
    role: Literal["user", "assistant"]
    content: tuple[Block, ...]


LeafPath = tuple[str | int, ...]


@dataclass(frozen=True)
class Leaf:
    path: LeafPath
    text: str
    rewritable: bool
    identifier: bool = False  # a tool name, id, header, or number: NER reads `read_file` as a LOCATION
    encoded: bool = False  # base64 media bytes: NER finds names all over that noise, and spaCy caps text at 1M chars


def json_leaves(value: JSON, path: LeafPath = (), rewritable: bool = True) -> Iterator[Leaf]:
    """Every string, plus each object's keys (one leaf at the object's own path) and every number. Keys and
    numbers are read-only: rewriting them would change the shape."""
    if isinstance(value, str):
        yield Leaf(path, value, rewritable)
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        yield Leaf(path, str(value), False, identifier=True)
    elif isinstance(value, dict):
        if value:
            yield Leaf(path, "\n".join(value), False)
        for k, v in value.items():
            yield from json_leaves(v, (*path, k), rewritable)
    elif isinstance(value, list):
        for i, v in enumerate(value):
            yield from json_leaves(v, (*path, i), rewritable)


def json_rewrite(value: JSON, fn: Callable[[Leaf], str], path: LeafPath = ()) -> JSON:
    if isinstance(value, str):
        return fn(Leaf(path, value, True))
    if isinstance(value, dict):
        return {k: json_rewrite(v, fn, (*path, k)) for k, v in value.items()}
    if isinstance(value, list):
        return [json_rewrite(v, fn, (*path, i)) for i, v in enumerate(value)]
    return value


def _block_leaves(block: Block, path: LeafPath) -> Iterator[Leaf]:
    """Every value the block puts on the wire. Only text and tool_use.input strings are rewritable."""
    match block:
        case Text(text=t, extra=x):
            yield Leaf(path, t, True)
            yield from json_leaves(dict(x), (*path, "extra"), False)
        case ToolUse(id=i, name=n, input=inp, extra=x):
            yield Leaf((*path, "id"), i, False, identifier=True)
            yield Leaf((*path, "name"), n, False, identifier=True)
            yield from json_leaves(inp, (*path, "input"))
            yield from json_leaves(dict(x), (*path, "extra"), False)
        case ToolResult(tool_use_id=i, content=content, extra=x):
            yield Leaf((*path, "tool_use_id"), i, False, identifier=True)
            for k, b in enumerate(content):
                yield from _block_leaves(b, (*path, "content", k))
            yield from json_leaves(dict(x), (*path, "extra"), False)
        case Opaque(raw=raw):
            source = raw.get("source")
            data = (*path, "source", "data") if isinstance(source, dict) and source.get("type") == "base64" else None
            for leaf in json_leaves(dict(raw), path, False):
                yield replace(leaf, encoded=True) if leaf.path == data else leaf


def _block_rewrite(block: Block, path: LeafPath, fn: Callable[[Leaf], str]) -> Block:
    match block:
        case Text(text=t, extra=x):
            return Text(fn(Leaf(path, t, True)), x)
        case ToolUse(id=i, name=n, input=inp, extra=x):
            return ToolUse(i, n, json_rewrite(inp, fn, (*path, "input")), x)
        case ToolResult(tool_use_id=i, content=content, extra=x):
            return ToolResult(i, tuple(_block_rewrite(b, (*path, "content", j), fn) for j, b in enumerate(content)), x)
        case _:
            return block


def nested_tool_uses(block: Block) -> list[tuple[str, str]]:
    """(id, name) of every tool_use below the top level of this block: in tool_result content, inside an opaque
    block, or in extra fields. A tool call there would reach the agent without an egress check."""
    found: list[tuple[str, str]] = []

    def walk(value: JSON) -> None:
        if isinstance(value, dict):
            if value.get("type") == "tool_use":
                found.append((str(value.get("id")), str(value.get("name"))))
            for v in value.values():
                walk(v)
        elif isinstance(value, list):
            for v in value:
                walk(v)

    match block:
        case Opaque(raw=raw):
            walk(dict(raw))
        case ToolResult(content=content, extra=x):
            for b in content:
                found += [(b.id, b.name)] if isinstance(b, ToolUse) else nested_tool_uses(b)
            walk(dict(x))
        case Text(extra=x) | ToolUse(extra=x):
            walk(dict(x))
    return found


@dataclass(frozen=True)
class Conversation:
    system: tuple[Text, ...]
    messages: tuple[Message, ...]

    def leaves(self) -> Iterator[Leaf]:
        """Every value of the system prompt and messages that SENTINEL forwards, in wire order."""
        for i, t in enumerate(self.system):
            yield from _block_leaves(t, ("system", i))
        for i, m in enumerate(self.messages):
            for j, b in enumerate(m.content):
                yield from _block_leaves(b, ("messages", i, j))

    def rewrite(self, fn: Callable[[Leaf], str]) -> Conversation:
        """Same structure with each rewritable leaf replaced by fn(leaf). Opaque blocks are reused by identity."""
        return Conversation(
            system=tuple(_block_rewrite(t, ("system", i), fn) for i, t in enumerate(self.system)),
            messages=tuple(
                Message(m.role, tuple(_block_rewrite(b, ("messages", i, j), fn) for j, b in enumerate(m.content)))
                for i, m in enumerate(self.messages)
            ),
        )


@dataclass(frozen=True)
class Params:
    """The request knobs that survive the edge. Everything else the agent sends is dropped in wire.parse_request."""

    max_tokens: int
    tools: tuple[JSON, ...] = ()
    stop_sequences: tuple[str, ...] = ()
    anthropic_version: str | None = None  # wire.parse_request admits only a date, which cannot carry data
    anthropic_beta: str | None = None

    def leaves(self) -> Iterator[Leaf]:
        """Every forwarded knob that can carry text. All read-only: SENTINEL never rewrites a tool definition."""
        for i, tool in enumerate(self.tools):
            for leaf in json_leaves(tool, ("tools", i), False):
                yield replace(leaf, identifier=True) if leaf.path == ("tools", i, "name") else leaf
        for i, s in enumerate(self.stop_sequences):
            yield Leaf(("stop_sequences", i), s, False)
        if self.anthropic_beta:
            yield Leaf(("anthropic_beta",), self.anthropic_beta, False, identifier=True)


@dataclass(frozen=True)
class Inbound:
    session_id: str
    upstream_id: str
    conversation: Conversation
    params: Params

    def leaves(self) -> Iterator[Leaf]:
        """Everything this request would put on the wire to an upstream."""
        yield from self.conversation.leaves()
        yield from self.params.leaves()


@dataclass(frozen=True)
class Reply:
    id: str
    model: str
    blocks: tuple[Block, ...]
    stop_reason: str | None
    stop_sequence: str | None = None
    usage: Mapping[str, JSON] = field(default_factory=dict)
    extra: Mapping[str, JSON] = field(default_factory=dict)

    def rewrite(self, fn: Callable[[Leaf], str]) -> Reply:
        return replace(self, blocks=tuple(_block_rewrite(b, ("content", j), fn) for j, b in enumerate(self.blocks)))


@dataclass(frozen=True)
class Span:
    """What a Detector returns for one string. Offsets into that string."""

    entity_type: str
    start: int
    end: int
    score: float


@dataclass(frozen=True)
class Finding:
    entity_type: str
    tier: Tier
    path: LeafPath
    start: int  # offsets into the leaf text the agent sent
    end: int
    score: float
    value: str
    source: Literal["vault", "detector"]
    read_only: bool = False  # in a place SENTINEL never rewrites, so REDACT cannot cover it


@dataclass(frozen=True)
class Detection:
    findings: tuple[Finding, ...]

    @property
    def tier(self) -> Tier:
        return max((f.tier for f in self.findings), default=Tier.PUBLIC)

    def counts(self) -> dict[str, int]:
        """Distinct values per type, so a name repeated across history counts once."""
        distinct = {(f.entity_type, f.value) for f in self.findings}
        return dict(sorted(Counter(t for t, _ in distinct).items()))


@dataclass(frozen=True)
class Allow:
    ACTION: ClassVar[Action] = Action.ALLOW
    rule: str
    reason: str
    upstream: str


@dataclass(frozen=True)
class Redact:
    ACTION: ClassVar[Action] = Action.REDACT
    rule: str
    reason: str
    upstream: str
    entity_types: frozenset[str]  # new values of these types get placeholders; vault-known values always do


@dataclass(frozen=True)
class Reroute:
    ACTION: ClassVar[Action] = Action.REROUTE
    rule: str
    reason: str
    upstream: str
    already_local: bool


@dataclass(frozen=True)
class ForwardHold:
    ACTION: ClassVar[Action] = Action.HOLD
    rule: str
    reason: str
    upstream: str


@dataclass(frozen=True)
class Block:
    ACTION: ClassVar[Action] = Action.BLOCK
    rule: str
    reason: str  # no upstream: a Block cannot be forwarded by construction


Decision = Allow | Redact | Reroute | ForwardHold | Block

ApprovalStatus = Literal["approved", "denied", "expired"]  # what Ports.hold returns; never "pending"
HoldOutcome = Literal["forwarded", "blocked"]


def resolution(status: ApprovalStatus) -> HoldOutcome:
    """The only mapping from an approval to a lifecycle outcome. A HOLD resolves to forwarded or blocked."""
    return "forwarded" if status == "approved" else "blocked"


@dataclass(frozen=True)
class ApprovalRef:
    id: str
    status: Literal["pending", "approved", "denied", "expired"]
    created_at: float
    expires_at: float


@dataclass(frozen=True)
class EgressVerdict:
    tool_use_id: str
    tool: str
    destination: str | None  # normalized host; None for internal tools and missing or unparseable destinations
    entities: frozenset[str]  # every type found in the payload
    action: Action  # ALLOW, HOLD, or BLOCK
    rule: str
    reason: str
    outcome: Literal["forwarded", "blocked", "pending"]


@dataclass(frozen=True)
class HeldCall:
    tool_use_id: str
    tool: str
    destination: str | None
    arguments: JSON  # rehydrated: the reviewer approves the real values
    entities: frozenset[str]
    rule: str
    reason: str


@dataclass(frozen=True)
class HoldSubject:
    """What the approval modal renders on its own."""

    event_id: str
    kind: Literal["request", "tool_calls"]
    rule: str
    reason: str
    entities: frozenset[str]
    tool_calls: tuple[HeldCall, ...] = ()


@dataclass(frozen=True)
class Mark:
    start: int  # offsets into LeafDiff.real
    end: int
    entity_type: str
    placeholder: str | None  # None when the value went upstream raw


@dataclass(frozen=True)
class LeafDiff:
    where: str
    direction: Literal["request", "tool_call"]
    real: str
    masked: str
    marks: tuple[Mark, ...]


class Stage(str, Enum):
    RECEIVED = "received"
    DETECTED = "detected"
    DECIDED = "decided"
    HELD = "held"
    FORWARDED = "forwarded"
    REHYDRATED = "rehydrated"
    EGRESS_CHECKED = "egress_checked"
    TOOL_HELD = "tool_held"
    BLOCKED = "blocked"
    FAILED = "failed"
    RETURNED = "returned"


TRANSITIONS: Mapping[Stage, frozenset[Stage]] = {
    Stage.RECEIVED: frozenset({Stage.DETECTED}),
    Stage.DETECTED: frozenset({Stage.DECIDED}),
    Stage.DECIDED: frozenset({Stage.FORWARDED, Stage.HELD, Stage.BLOCKED}),
    Stage.HELD: frozenset({Stage.FORWARDED, Stage.BLOCKED}),
    Stage.FORWARDED: frozenset({Stage.REHYDRATED, Stage.FAILED}),
    Stage.REHYDRATED: frozenset({Stage.EGRESS_CHECKED}),
    Stage.EGRESS_CHECKED: frozenset({Stage.RETURNED, Stage.TOOL_HELD}),
    Stage.TOOL_HELD: frozenset({Stage.RETURNED}),
    Stage.BLOCKED: frozenset({Stage.RETURNED}),
    Stage.FAILED: frozenset(),
    Stage.RETURNED: frozenset(),
}


@dataclass(frozen=True)
class UpstreamRef:
    id: str
    trust: Trust
    model: str
    simulated: bool
    already_local: bool  # REROUTE kept a request on the local-class upstream it asked for


@dataclass(frozen=True)
class RequestSummary:
    action: Action
    rule: str
    reason: str
    tier: Tier
    entity_counts: Mapping[str, int]


HopState = Literal["active", "done", "pending", "blocked"]


@dataclass(frozen=True)
class Hop:
    """One edge of the data-flow graph. Node ids: agent, sentinel, model:<upstream>, tool:<name>, domain:<host>."""

    src: str
    dst: str
    action: Action
    state: HopState


@dataclass(frozen=True)
class Event:
    """One turn's public record, the dashboard contract. Rebuilt at every stage and upserted by id."""

    id: str
    session_id: str
    created_at: float
    updated_at: float
    stage: Stage
    headline: Action
    request: RequestSummary | None
    upstream: UpstreamRef | None
    egress: tuple[EgressVerdict, ...]
    approval: ApprovalRef | None
    diff: tuple[LeafDiff, ...]
    hops: tuple[Hop, ...]
    stop_reason: str | None
    latency_ms: Mapping[str, int]
    error: str | None
