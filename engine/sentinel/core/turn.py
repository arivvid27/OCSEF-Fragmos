"""The lifecycle spine. run_turn is the core's one entry point and reads top to bottom as the lifecycle."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field, replace
from typing import Awaitable, Callable, Mapping, Protocol

from .detect import Detector, detect
from .model import (TRANSITIONS, Action, ApprovalRef, ApprovalStatus, Block, Conversation, Decision, EgressVerdict,
                    Event, ForwardHold, HeldCall, HoldSubject, Hop, HopState, Inbound, LeafDiff, Params, Redact, Reply,
                    RequestSummary, Reroute, Stage, Text, ToolUse, Upstream, UpstreamRef, json_rewrite,
                    nested_tool_uses, resolution)
from .policy import Policy, check_egress, decide
from .vault import DIFF_CAP, Vault, raw_diffs, redact, rehydrate


class UpstreamError(Exception):
    """Raised by Ports.call_upstream. Carries the status and Anthropic-shaped error body for the agent."""

    def __init__(self, status: int, body: object):
        super().__init__(status)
        self.status, self.body = status, body


class Ports(Protocol):
    async def call_upstream(self, upstream: Upstream, conversation: Conversation, params: Params,
                            session_id: str) -> Reply: ...

    async def hold(self, subject: HoldSubject, on_open: Callable[[ApprovalRef], Awaitable[None]]) -> ApprovalStatus:
        """Wait for a reviewer or the deadline. Calls on_open once the approval exists, before waiting."""
        ...

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
    decision: Decision | None = None
    upstream: Upstream | None = None
    reply: Reply | None = None
    egress: tuple[EgressVerdict, ...] = ()
    approval: ApprovalRef | None = None
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
        headline=headline(turn),
        request=turn.request,
        upstream=UpstreamRef(u.id, u.trust, u.model, u.simulated,
                             isinstance(turn.decision, Reroute) and turn.decision.already_local) if u else None,
        egress=turn.egress,
        approval=turn.approval,
        diff=turn.diff,
        hops=hops_of(turn),
        stop_reason=turn.reply.stop_reason if turn.reply else None,
        latency_ms=dict(turn.latency_ms),
        error=turn.error,
    )


HOP_STATE: Mapping[str, HopState] = {"forwarded": "done", "pending": "pending", "blocked": "blocked"}


def hops_of(turn: Turn) -> tuple[Hop, ...]:
    """The turn's path through the graph. `blocked` marks the hop into the place the data was stopped: SENTINEL for
    a refused request, the domain for an external tool call, the tool itself when there is no domain."""
    action = turn.request.action if turn.request else Action.ALLOW
    if turn.upstream is None:
        refused = turn.stage in (Stage.BLOCKED, Stage.RETURNED)
        state: HopState = "blocked" if refused else "pending" if turn.stage is Stage.HELD else "active"
        return (Hop("agent", "sentinel", action, state),)
    out = [Hop("agent", "sentinel", action, "done"),
           Hop("sentinel", f"model:{turn.upstream.id}", action, "active" if turn.stage is Stage.FORWARDED else "done")]
    for v in turn.egress:
        state = HOP_STATE[v.outcome]
        tool = f"tool:{v.tool}"
        if v.destination is None:
            out.append(Hop("sentinel", tool, v.action, state))
        else:
            out += [Hop("sentinel", tool, v.action, "done" if state == "blocked" else state),
                    Hop(tool, f"domain:{v.destination}", v.action, state)]
    return tuple(out)


SEVERITY = (Action.ALLOW, Action.REDACT, Action.REROUTE, Action.HOLD, Action.BLOCK)


def headline(turn: Turn) -> Action:
    """The most severe of the request action and the egress outcomes. A refused approval counts as BLOCK."""
    actions = [turn.request.action if turn.request else Action.ALLOW]
    actions += [Action.BLOCK if v.outcome == "blocked" else v.action for v in turn.egress]
    if turn.approval and turn.approval.status in ("denied", "expired"):
        actions.append(Action.BLOCK)
    return max(actions, key=SEVERITY.index)


def refusal(approval: ApprovalRef) -> str:
    if approval.status == "denied":
        return "denied by reviewer"
    return f"approval expired after {approval.expires_at - approval.created_at:.3g} s"


def tool_calls_blocked(reply: Reply, reason: str) -> Reply:
    """Every tool_use goes, not only the offending one: the model planned the batch together. So does every block
    with a tool_use nested inside it."""
    kept = tuple(b for b in reply.blocks if not isinstance(b, ToolUse) and not nested_tool_uses(b))
    return replace(reply, blocks=(*kept, Text(f"[SENTINEL] Tool call blocked: {reason}")), stop_reason="end_turn")


def _held_calls(reply: Reply, verdicts: tuple[EgressVerdict, ...]) -> tuple[HeldCall, ...]:
    """check_egress gives the top-level tool calls their verdicts first and in order, so position pairs them."""
    calls = [b for b in reply.blocks if isinstance(b, ToolUse)]
    return tuple(HeldCall(v.tool_use_id, v.tool, v.destination, json_rewrite(b.input, lambda leaf: leaf.text[:DIFF_CAP]),
                          v.entities, v.rule, v.reason) for b, v in zip(calls, verdicts) if v.outcome == "pending")


def blocked_reply(turn_id: str, reason: str) -> Reply:
    """A complete Anthropic message, so a stock SDK agent shows the refusal instead of raising."""
    return Reply(id=f"msg_sentinel_{turn_id}", model="sentinel",
                 blocks=(Text(f"[SENTINEL] Request blocked: {reason}"),), stop_reason="end_turn",
                 usage={"input_tokens": 0, "output_tokens": 0})


def _ms(since: float) -> int:
    return round((time.monotonic() - since) * 1000)


async def run_turn(inbound: Inbound, ctx: TurnContext) -> Reply:
    started = time.monotonic()
    turn = Turn(id=uuid.uuid4().hex, inbound=inbound)

    async def move(stage: Stage) -> None:
        turn.advance(stage)
        await ctx.ports.emit(event_of(turn))

    async def hold(subject: HoldSubject) -> ApprovalRef:
        async def opened(ref: ApprovalRef) -> None:
            turn.approval = ref
            await ctx.ports.emit(event_of(turn))

        status = await ctx.ports.hold(subject, opened)
        turn.approval = replace(turn.approval, status=status)
        return turn.approval

    await ctx.ports.emit(event_of(turn))
    detected = time.monotonic()
    conversation = inbound.conversation
    detection = detect(inbound, ctx.detector, ctx.vault, ctx.policy.tiers)
    turn.latency_ms["detect"] = _ms(detected)
    await move(Stage.DETECTED)

    decision: Decision = decide(detection, ctx.policy, ctx.upstreams[inbound.upstream_id], ctx.upstreams["local"])
    turn.decision = decision
    turn.request = RequestSummary(decision.ACTION, decision.rule, decision.reason, detection.tier, detection.counts())
    await move(Stage.DECIDED)

    blocked = decision.reason if isinstance(decision, Block) else None
    if isinstance(decision, ForwardHold):
        await move(Stage.HELD)
        approval = await hold(HoldSubject(turn.id, "request", decision.rule, decision.reason,
                                          frozenset(detection.counts())))
        if resolution(approval.status) == "blocked":
            blocked = refusal(approval)
    if blocked is not None:
        await move(Stage.BLOCKED)
        turn.reply = blocked_reply(turn.id, blocked)
        turn.latency_ms["total"] = _ms(started)
        await move(Stage.RETURNED)
        return turn.reply

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
    turn.egress = check_egress(reply, ctx.policy, ctx.detector, ctx.vault)
    await move(Stage.EGRESS_CHECKED)

    refused = "; ".join(v.reason for v in turn.egress if v.action is Action.BLOCK) or None
    held = [v for v in turn.egress if v.outcome == "pending"]
    if refused is None and held:
        await move(Stage.TOOL_HELD)
        approval = await hold(HoldSubject(turn.id, "tool_calls", held[0].rule, "; ".join(v.reason for v in held),
                                          frozenset().union(*(v.entities for v in held)), _held_calls(reply, turn.egress)))
        outcome = resolution(approval.status)
        turn.egress = tuple(replace(v, outcome=outcome) if v.outcome == "pending" else v for v in turn.egress)
        if outcome == "blocked":
            refused = refusal(approval)
    if refused is not None:
        turn.egress = tuple(replace(v, outcome="blocked") for v in turn.egress)
        reply = tool_calls_blocked(reply, refused)
    turn.reply = reply
    turn.latency_ms["total"] = _ms(started)
    await move(Stage.RETURNED)
    return reply


def _new_since_last_assistant(conversation: Conversation) -> frozenset:
    """Leaf paths the agent added this turn: the system prompt counts only before the first reply."""
    last = max((i for i, m in enumerate(conversation.messages) if m.role == "assistant"), default=None)
    return frozenset(leaf.path for leaf in conversation.leaves()
                     if (leaf.path[0] == "messages" and (last is None or leaf.path[1] > last))
                     or (leaf.path[0] == "system" and last is None))
