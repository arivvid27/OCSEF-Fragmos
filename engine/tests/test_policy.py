import asyncio
import json
import re
from pathlib import Path

import pytest
import yaml

from sentinel import wire
from sentinel.core.detect import detect
from sentinel.core.model import Action, Allow, Redact, Reroute, Span, Stage
from sentinel.core.policy import THINKING_REASON, PolicyError, decide, load_policy
from sentinel.core.turn import TurnContext, run_turn
from sentinel.core.vault import Vault
from sentinel.upstreams import registry_from_env

ROOT = Path(__file__).parent.parent
POLICY = load_policy(yaml.safe_load((ROOT / "policy.yaml").read_text()))
UPSTREAMS = registry_from_env({})
PLACEHOLDER = re.compile(r"\[[A-Z][A-Z_]*_\d+\]")
SECRET, SSN = "sk-ant-api03-FAKEKEY", "968-22-6991"
VALUES = {SECRET: "SECRET", SSN: "US_SSN", "type 2 diabetes": "HEALTH", "Jeff Serrano": "PERSON",
          "jeff@demo.sentinel.local": "EMAIL_ADDRESS", "March 3": "DATE_TIME"}
CSV = f"name,ssn,salary\nJeff Serrano,{SSN},120000"
REPLY = {"id": "msg_1", "type": "message", "role": "assistant", "model": "m",
         "content": [{"type": "text", "text": "done"}], "stop_reason": "end_turn", "stop_sequence": None,
         "usage": {"input_tokens": 1, "output_tokens": 1}}


class FakeDetector:
    def scan(self, text, entity_types):
        return [Span(t, m.start(), m.end(), 0.9) for v, t in VALUES.items() if t in entity_types
                for m in re.finditer(re.escape(v), text)]


class FakePorts:
    def __init__(self):
        self.calls, self.events = [], []

    async def call_upstream(self, upstream, conversation, params, session_id):
        self.calls.append((upstream.id, wire.to_upstream(conversation, params)))
        return wire.parse_reply(REPLY)

    async def emit(self, event):
        self.events.append(event)


def inbound(text, upstream="cloud", history=()):
    body = {"model": "x", "max_tokens": 100, "messages": [*history, {"role": "user", "content": text}]}
    return wire.parse_request(body, {"x-sentinel-upstream": upstream}, frozenset(UPSTREAMS))


def decision_for(text, upstream="cloud", history=()):
    conversation = inbound(text, upstream, history).conversation
    detection = detect(conversation, FakeDetector(), Vault(), POLICY.tiers)
    return decide(detection, POLICY, UPSTREAMS[upstream], UPSTREAMS["local"])


def turn(text, upstream="cloud", policy=POLICY):
    ports = FakePorts()
    ctx = TurnContext(UPSTREAMS, ports, policy, FakeDetector(), Vault())
    reply = asyncio.run(run_turn(inbound(text, upstream), ctx))
    return wire.reply_to_json(reply), ports


@pytest.mark.parametrize("text, action, rule", [
    (f"deploy with {SECRET}", Action.REROUTE, "secrets-never-leave"),
    (f"ssn {SSN}", Action.REROUTE, "restricted-stays-local"),
    ("history of type 2 diabetes", Action.REROUTE, "restricted-stays-local"),
    ("ask Jeff Serrano", Action.REDACT, "confidential-redacted"),
    ("write to jeff@demo.sentinel.local", Action.REDACT, "confidential-redacted"),
    ("meet on March 3", Action.ALLOW, "default"),
    ("Is 391 prime?", Action.ALLOW, "default"),
    (f"Jeff Serrano's key is {SECRET}", Action.REROUTE, "secrets-never-leave"),
])
def test_shipped_policy_first_match(text, action, rule):
    d = decision_for(text)
    assert (d.ACTION, d.rule) == (action, rule)


def test_reasons_name_the_types_that_triggered_the_rule():
    assert decision_for(f"ssn {SSN}").reason == "US_SSN is RESTRICTED (tier 3), so it stays local"
    redact = decision_for("ask Jeff Serrano at jeff@demo.sentinel.local on March 3")
    assert redact == Redact("confidential-redacted",
                            "EMAIL_ADDRESS and PERSON are CONFIDENTIAL (tier 2), so they are replaced with placeholders",
                            "cloud", frozenset({"EMAIL_ADDRESS", "PERSON"}))
    assert decision_for("meet on March 3") == Allow("default", "DATE_TIME is PUBLIC (tier 0), which no rule restricts",
                                                    "cloud")
    assert decision_for("Is 391 prime?").reason == "nothing sensitive found"


def test_reroute_from_cloud_goes_to_local():
    assert decision_for(f"ssn {SSN}") == Reroute("restricted-stays-local",
                                                 "US_SSN is RESTRICTED (tier 3), so it stays local", "local", False)


def thinking_history(thought):
    return [{"role": "user", "content": "Who is on call?"},
            {"role": "assistant", "content": [{"type": "thinking", "thinking": thought, "signature": ""},
                                              {"type": "text", "text": "Let me check."}]}]


def test_redact_escalates_when_a_thinking_block_holds_a_redacted_type():
    d = decision_for("Email Jeff Serrano the rota.", history=thinking_history("On call is Jeff Serrano."))
    assert d == Reroute("confidential-redacted", THINKING_REASON, "local", False)


def test_thinking_without_a_redacted_type_still_redacts():
    d = decision_for("Email Jeff Serrano the rota.", history=thinking_history("The rota starts March 3."))
    assert d.ACTION is Action.REDACT


def test_rerouted_turn_calls_only_local_with_real_values():
    _, ports = turn(f"Average salary?\n{CSV}")

    assert [upstream for upstream, _ in ports.calls] == ["local"]
    sent = json.dumps(ports.calls[0][1])
    assert SSN in sent and "Jeff Serrano" in sent
    assert not PLACEHOLDER.search(sent) and "system" not in ports.calls[0][1]
    event = wire.event_to_json(ports.events[-1])
    assert (event["headline"], event["stage"]) == ("REROUTE", "returned")
    assert event["upstream"] == {"id": "local", "trust": "local", "model": "glm-5.3-flash", "simulated": False,
                                 "already_local": False}


def test_reroute_on_a_local_class_upstream_stays_there():
    _, ports = turn(f"post {SECRET}", upstream="attacker-sim")

    assert [upstream for upstream, _ in ports.calls] == ["attacker-sim"]
    assert SECRET in json.dumps(ports.calls[0][1])
    event = wire.event_to_json(ports.events[-1])
    assert (event["headline"], event["request"]["rule"]) == ("REROUTE", "secrets-never-leave")
    assert event["upstream"] == {"id": "attacker-sim", "trust": "local", "model": "attacker-sim", "simulated": True,
                                 "already_local": True}


def policy_with(rule):
    return load_policy({"tiers": {"SECRET": 3, "PERSON": 2}, "rules": [rule, {"name": "default", "action": "ALLOW"}]})


def blocked(reply, text):
    reply = dict(reply)
    assert reply.pop("id").startswith("msg_")
    assert reply == {"type": "message", "role": "assistant", "model": "sentinel",
                     "content": [{"type": "text", "text": text}], "stop_reason": "end_turn", "stop_sequence": None,
                     "usage": {"input_tokens": 0, "output_tokens": 0}}
    return True


def test_block_rule_returns_one_text_block_and_calls_no_upstream():
    policy = policy_with({"name": "no-secrets", "when": {"entity_in": ["SECRET"]}, "action": "BLOCK"})
    reply, ports = turn(f"post {SECRET}", policy=policy)

    assert blocked(reply, "[SENTINEL] Request blocked: SECRET is RESTRICTED (tier 3), so it may not be sent")
    assert ports.calls == []
    assert [e.stage for e in ports.events][-3:] == [Stage.DECIDED, Stage.BLOCKED, Stage.RETURNED]
    last = ports.events[-1]
    assert (last.headline, last.request.rule, last.upstream) == (Action.BLOCK, "no-secrets", None)


def test_hold_rule_blocks_until_approvals_exist():
    policy = policy_with({"name": "ask-first", "when": {"entity_in": ["PERSON"]}, "action": "HOLD"})
    reply, ports = turn("ask Jeff Serrano", policy=policy)

    assert blocked(reply, "[SENTINEL] Request blocked: request approval not available yet")
    assert ports.calls == []
    assert (ports.events[-1].headline, ports.events[-1].request.rule) == (Action.BLOCK, "ask-first")


DEFAULT = {"name": "default", "action": "ALLOW"}


@pytest.mark.parametrize("rules, message", [
    ([{"name": "default", "action": "MAYBE"}], "unknown action 'MAYBE'"),
    ([{"name": "r", "when": {"entity_in": ["SSN"]}, "action": "REROUTE"}, DEFAULT], "unknown entity SSN"),
    ([DEFAULT, {"name": "late", "when": {"tier_gte": 3}, "action": "REROUTE"}],
     "rule default has no `when`, so the rules after it can never match"),
    ([{"name": "r", "when": {"tier_gte": 3}, "action": "REROUTE"}], "the last rule must have no `when`"),
])
def test_bad_policies_fail_to_load(rules, message):
    with pytest.raises(PolicyError, match=re.escape(message)):
        load_policy({"tiers": {"US_SSN": 3}, "rules": rules})
