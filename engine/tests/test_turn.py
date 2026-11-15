import asyncio
import json
import subprocess
import sys
from pathlib import Path

import pytest

from sentinel import wire
from sentinel.core.model import Action, Stage
from sentinel.core.policy import load_policy
from sentinel.core.turn import Turn, TurnContext, UpstreamError, run_turn
from sentinel.core.vault import Vault
from sentinel.upstreams import registry_from_env

CAPTURED = json.loads((Path(__file__).parent / "fixtures" / "deepseek_reply.json").read_text())
UPSTREAMS = registry_from_env({})


class NoFindings:
    def scan(self, text, entity_types):
        return ()

    patterns = scan


def context(ports):
    policy = load_policy({"tiers": {}, "rules": [{"name": "default", "action": "ALLOW"}]})
    return TurnContext(UPSTREAMS, ports, policy, NoFindings(), Vault())


class FakePorts:
    def __init__(self, reply=None, error=None):
        self.reply, self.error = reply, error
        self.calls, self.events = [], []

    async def call_upstream(self, upstream, conversation, params, session_id):
        self.calls.append((upstream.id, wire.to_upstream(conversation, params), session_id))
        if self.error:
            raise self.error
        return self.reply

    async def emit(self, event):
        self.events.append(event)


def inbound(headers=None):
    body = {"model": "x", "max_tokens": 100, "messages": [{"role": "user", "content": "Is 391 prime?"}]}
    return wire.parse_request(body, headers or {}, frozenset(UPSTREAMS), client="test")


def test_turn_returns_what_the_upstream_returned_and_logs_one_event():
    ports = FakePorts(reply=wire.parse_reply(CAPTURED))
    reply = asyncio.run(run_turn(inbound({"x-sentinel-session": "s1"}), context(ports)))

    assert wire.reply_to_json(reply) == CAPTURED
    assert ports.calls == [("cloud", {"max_tokens": 100,
                                      "messages": [{"role": "user", "content": [{"type": "text", "text": "Is 391 prime?"}]}]},
                            "s1")]
    assert len({e.id for e in ports.events}) == 1
    last = ports.events[-1]
    assert (last.stage, last.headline, last.upstream.id, last.stop_reason) == (Stage.RETURNED, Action.ALLOW, "cloud", "tool_use")
    assert wire.event_to_json(last)["upstream"] == {"id": "cloud", "trust": "cloud", "model": "deepseek-v4.1-flash",
                                                       "simulated": False, "already_local": False}


def test_requested_upstream_header_is_honored():
    ports = FakePorts(reply=wire.parse_reply(CAPTURED))
    asyncio.run(run_turn(inbound({"x-sentinel-upstream": "local"}), context(ports)))
    assert ports.calls[0][0] == "local"
    assert ports.events[-1].upstream.model == "glm-5.3-flash"


def test_upstream_error_fails_the_turn_and_propagates():
    ports = FakePorts(error=UpstreamError(429, {"type": "error", "error": {"type": "rate_limit_error"}}))
    with pytest.raises(UpstreamError):
        asyncio.run(run_turn(inbound(), context(ports)))
    assert (ports.events[-1].stage, ports.events[-1].error) == (Stage.FAILED, "upstream 429")


def test_illegal_lifecycle_edge_raises():
    turn = Turn(id="t", inbound=inbound())
    with pytest.raises(AssertionError):
        turn.advance(Stage.FORWARDED)


def test_core_imports_no_framework():
    code = ("import sys, sentinel.core.turn; "
            "bad = {'fastapi', 'anthropic', 'presidio_analyzer', 'sqlite3'} & set(sys.modules); "
            "assert not bad, bad")
    subprocess.run([sys.executable, "-c", code], check=True, cwd=Path(__file__).parent.parent)
