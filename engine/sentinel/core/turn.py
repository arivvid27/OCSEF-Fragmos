"""The lifecycle spine. run_turn is the core's one entry point and reads top to bottom as the lifecycle."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Mapping, Protocol

from .model import (TRANSITIONS, Action, Conversation, Event, Inbound, Params, Reply, RequestSummary, Stage, Tier,
                    Upstream, UpstreamRef)


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
    upstreams: Mapping[str, Upstream]
    ports: Ports


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
    await move(Stage.DETECTED)
    turn.request = RequestSummary(Action.ALLOW, rule="pass-through", reason="no detection yet",
                                  tier=Tier.PUBLIC, entity_counts={})
    await move(Stage.DECIDED)

    turn.upstream = ctx.upstreams[inbound.upstream_id]
    await move(Stage.FORWARDED)
    called = time.monotonic()
    try:
        reply = await ctx.ports.call_upstream(turn.upstream, inbound.conversation, inbound.params,
                                              inbound.session_id)
    except UpstreamError as e:
        turn.latency_ms.update(upstream=_ms(called), total=_ms(started))
        turn.error = f"upstream {e.status}"
        await move(Stage.FAILED)
        raise
    turn.latency_ms["upstream"] = _ms(called)
    turn.reply = reply

    await move(Stage.REHYDRATED)
    await move(Stage.EGRESS_CHECKED)
    turn.latency_ms["total"] = _ms(started)
    await move(Stage.RETURNED)
    return reply
