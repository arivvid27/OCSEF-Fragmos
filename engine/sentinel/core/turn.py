"""The lifecycle spine. run_turn is the core's one entry point and reads top to bottom as the lifecycle."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Mapping, Protocol

from .detect import Detector, detect
from .model import (TRANSITIONS, Action, Conversation, Decision, Event, Inbound, LeafDiff, Params, Redact, Reply,
                    RequestSummary, Stage, Upstream, UpstreamRef)
from .policy import Policy, decide
from .vault import Vault, raw_diffs, redact, rehydrate


class UpstreamError(Exception):
    """Raised by Ports.call_upstream. Carries the status and Anthropic-shaped error body for the agent."""

    def __init__(self, status: int, body: object):
        super().__init__(status)
        self.status, self.body = status, body


class Ports(Protocol):
    async def call_upstream(self, upstream: Upstream, conversation: Conversation, params: Params,
                            session_id: str) -> Reply: ...

    async def emit(self, event: Event) -> None:
        """Upsert by event.id and broadcast. Each event is a full snapshot, so the same one twice is harmless."""
        ...


@dataclass(frozen=True)
class TurnContext:
    """Built per request: the vault belongs to the request's session."""

    upstreams: Mapping[str, Upstream]
    ports: Ports
    policy: Policy
    detector: Detector
    vault: Vault


@dataclass
class Turn:
    """Mutable record of one request. Single writer: the run_turn call that created it."""

    id: str
    inbound: Inbound
    stage: Stage = Stage.RECEIVED
    created_at: float = field(default_factory=time.time)
    request: RequestSummary | None = None
    upstream: Upstream | None = None
    reply: Reply | None = None
    diff: tuple[LeafDiff, ...] = ()
    latency_ms: dict[str, int] = field(default_factory=dict)
    error: str | None = None

    def advance(self, to: Stage) -> None:
        if to not in TRANSITIONS[self.stage]:
            raise AssertionError(f"illegal lifecycle edge {self.stage.value} -> {to.value}")
        self.stage = to


def event_of(turn: Turn) -> Event:
    u = turn.upstream
    return Event(
        id=turn.id,
        session_id=turn.inbound.session_id,
        created_at=turn.created_at,
        updated_at=time.time(),
        stage=turn.stage,
        headline=turn.request.action if turn.request else Action.ALLOW,
        request=turn.request,
        upstream=UpstreamRef(u.id, u.trust, u.model) if u else None,
        diff=turn.diff,
        stop_reason=turn.reply.stop_reason if turn.reply else None,
        latency_ms=dict(turn.latency_ms),
        error=turn.error,
    )


def _ms(since: float) -> int:
    return round((time.monotonic() - since) * 1000)


async def run_turn(inbound: Inbound, ctx: TurnContext) -> Reply:
    started = time.monotonic()
    turn = Turn(id=uuid.uuid4().hex, inbound=inbound)

    async def move(stage: Stage) -> None:
        turn.advance(stage)
        await ctx.ports.emit(event_of(turn))

    await ctx.ports.emit(event_of(turn))
    detected = time.monotonic()
    conversation = inbound.conversation
    detection = detect(conversation, ctx.detector, ctx.vault, ctx.policy.tiers)
    turn.latency_ms["detect"] = _ms(detected)
    await move(Stage.DETECTED)

    decision: Decision = decide(detection, ctx.policy, ctx.upstreams[inbound.upstream_id], ctx.upstreams["local"])
    turn.request = RequestSummary(decision.ACTION, decision.rule, decision.reason, detection.tier, detection.counts())
    await move(Stage.DECIDED)

    new = _new_since_last_assistant(conversation)
    if isinstance(decision, Redact):
        sent, request_diff = redact(conversation, detection, ctx.vault, decision.entity_types, new)
    else:
        sent, request_diff = conversation, raw_diffs(conversation, detection, new)
    turn.diff = request_diff
    turn.upstream = ctx.upstreams[decision.upstream]
    await move(Stage.FORWARDED)
    called = time.monotonic()
    try:
        model_reply = await ctx.ports.call_upstream(turn.upstream, sent, inbound.params, inbound.session_id)
    except UpstreamError as e:
        turn.latency_ms.update(upstream=_ms(called), total=_ms(started))
        turn.error = f"upstream {e.status}"
        await move(Stage.FAILED)
        raise
    turn.latency_ms["upstream"] = _ms(called)

    reply, tool_diff = rehydrate(model_reply, ctx.vault)
    turn.reply, turn.diff = reply, request_diff + tool_diff
    await move(Stage.REHYDRATED)
    await move(Stage.EGRESS_CHECKED)
    turn.latency_ms["total"] = _ms(started)
    await move(Stage.RETURNED)
    return reply


def _new_since_last_assistant(conversation: Conversation) -> frozenset:
    """Leaf paths the agent added this turn: the system prompt counts only before the first reply."""
    last = max((i for i, m in enumerate(conversation.messages) if m.role == "assistant"), default=None)
    return frozenset(leaf.path for leaf in conversation.leaves()
                     if (leaf.path[0] == "messages" and (last is None or leaf.path[1] > last))
                     or (leaf.path[0] == "system" and last is None))
