"""Every domain type SENTINEL's core speaks. Pure: stdlib only.

wire.py parses Anthropic JSON into these types once. Nothing here knows the wire format except Opaque.raw and
the `extra` maps, which are carried and never interpreted.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum, IntEnum
from typing import Any, Callable, Iterator, Literal, Mapping

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
    api_key_env: str


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


def _json_leaves(value: JSON, path: LeafPath) -> Iterator[Leaf]:
    if isinstance(value, str):
        yield Leaf(path, value, True)
    elif isinstance(value, dict):
        for k, v in value.items():
            yield from _json_leaves(v, (*path, k))
    elif isinstance(value, list):
        for i, v in enumerate(value):
            yield from _json_leaves(v, (*path, i))


def _json_rewrite(value: JSON, path: LeafPath, fn: Callable[[Leaf], str]) -> JSON:
    if isinstance(value, str):
        return fn(Leaf(path, value, True))
    if isinstance(value, dict):
        return {k: _json_rewrite(v, (*path, k), fn) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_rewrite(v, (*path, i), fn) for i, v in enumerate(value)]
    return value


def _block_leaves(block: Block, path: LeafPath) -> Iterator[Leaf]:
    match block:
        case Text(text=t):
            yield Leaf(path, t, True)
        case ToolUse(input=inp):
            yield from _json_leaves(inp, (*path, "input"))
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
            return ToolUse(i, n, _json_rewrite(inp, (*path, "input"), fn), x)
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
    stop_reason: str | None
    latency_ms: Mapping[str, int]
    error: str | None
