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

    @property
    def scan_text(self) -> str | None:
        return self.raw.get("thinking") if self.raw.get("type") == "thinking" else None


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


def json_leaves(value: JSON, path: LeafPath = ()) -> Iterator[Leaf]:
    if isinstance(value, str):
        yield Leaf(path, value, True)
    elif isinstance(value, dict):
        for k, v in value.items():
            yield from json_leaves(v, (*path, k))
    elif isinstance(value, list):
        for i, v in enumerate(value):
            yield from json_leaves(v, (*path, i))


def json_rewrite(value: JSON, fn: Callable[[Leaf], str], path: LeafPath = ()) -> JSON:
    if isinstance(value, str):
        return fn(Leaf(path, value, True))
    if isinstance(value, dict):
        return {k: json_rewrite(v, fn, (*path, k)) for k, v in value.items()}
    if isinstance(value, list):
        return [json_rewrite(v, fn, (*path, i)) for i, v in enumerate(value)]
    return value


def _block_leaves(block: Block, path: LeafPath) -> Iterator[Leaf]:
    match block:
        case Text(text=t):
            yield Leaf(path, t, True)
        case ToolUse(input=inp):
            yield from json_leaves(inp, (*path, "input"))
        case ToolResult(content=content):
            for i, b in enumerate(content):
                yield from _block_leaves(b, (*path, "content", i))
        case Opaque() if block.scan_text is not None:
            yield Leaf(path, block.scan_text, False)


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


@dataclass(frozen=True)
class Conversation:
    system: tuple[Text, ...]
    messages: tuple[Message, ...]

    def leaves(self) -> Iterator[Leaf]:
        """Every string SENTINEL may scan. Keys of tool_use.input are never leaves; thinking is read-only."""
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
    anthropic_version: str | None = None
    anthropic_beta: str | None = None


@dataclass(frozen=True)
class Inbound:
    session_id: str
    upstream_id: str
    conversation: Conversation
    params: Params


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
    opaque: bool = False  # found in a block SENTINEL never rewrites, so REDACT cannot cover it


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
    stop_reason: str | None
    latency_ms: Mapping[str, int]
    error: str | None
