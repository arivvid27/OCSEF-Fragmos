import asyncio
import json
import re
from pathlib import Path

import pytest
import yaml

from sentinel import wire
from sentinel.core.model import Action, ApprovalRef, Span
from sentinel.core.policy import load_policy
from sentinel.core.turn import TurnContext, run_turn
from sentinel.core.vault import REDACTION_NOTE, Vault
from sentinel.upstreams import registry_from_env

ROOT = Path(__file__).parent.parent
DATA = ROOT / "demo" / "data"
POLICY = load_policy(yaml.safe_load((ROOT / "policy.yaml").read_text()))
UPSTREAMS = registry_from_env({})
NOTE = (DATA / "patient_note_light.txt").read_text()
NAMES = ["Jeff Serrano", "Daniel Burton", "Laura Sanders", "Maria Lopez"]
EMAILS = re.compile(r"[\w.]+@demo\.sentinel\.local")
PLACEHOLDER = re.compile(r"\[[A-Z][A-Z_]*_\d+\]")
THINKING = {"type": "thinking", "thinking": "The user wants [PERSON_1] emailed.", "signature": ""}


class FakeDetector:
    """Names from a fixed list, emails by regex; Presidio is not the subject here."""

    def scan(self, text, entity_types):
        spans = [Span("PERSON", m.start(), m.end(), 0.85) for n in NAMES for m in re.finditer(re.escape(n), text)]
        spans += [Span("EMAIL_ADDRESS", m.start(), m.end(), 0.9) for m in EMAILS.finditer(text)]
        return [s for s in spans if s.entity_type in entity_types]

    patterns = scan


class EchoUpstream:
    """Plays a model that saw only placeholders: it echoes them in text and in a nested send_email call."""

    def __init__(self):
        self.requests, self.produced, self.events = [], [], []

    async def call_upstream(self, upstream, conversation, params, session_id):
        kwargs = wire.to_upstream(conversation, params)
        self.requests.append(kwargs)
        seen = sorted(set(PLACEHOLDER.findall(json.dumps(kwargs["messages"]))))
        n = len(self.requests)
        self.produced.append({
            "id": f"msg_{n}", "type": "message", "role": "assistant", "model": "deepseek-v4.1-flash",
            "content": [
                THINKING,
                {"type": "text", "text": f"Turn {n}. I saw {' '.join(seen)}. [PERSON_99] is not mine."},
                {"type": "tool_use", "id": f"toolu_{n}", "name": "send_email",
                 "input": {"to": "[EMAIL_ADDRESS_1]", "subject": "Handoff",
                           "body": "[PERSON_2] asked to move the meeting.", "cc": [{"name": "[PERSON_3]"}]}},
            ],
            "stop_reason": "tool_use", "stop_sequence": None, "usage": {"input_tokens": 1, "output_tokens": 1},
        })
        return wire.parse_reply(json.loads(json.dumps(self.produced[-1])))

    async def hold(self, subject, on_open):
        """The send_email names people, so egress holds it; a reviewer approves."""
        await on_open(ApprovalRef("a", "pending", 0.0, 60.0))
        return "approved"

    async def emit(self, event):
        self.events.append(event)


class Agent:
    """A stateless agent: it sends its full history, with real values, every turn."""

    def __init__(self, detector=None):
        self.ports = EchoUpstream()
        self.vault = Vault()
        self.detector = detector or FakeDetector()
        self.history = []

    def turn(self, *content):
        self.history.append({"role": "user", "content": list(content)})
        inbound = wire.parse_request({"model": "x", "max_tokens": 500, "messages": self.history},
                                     {"x-sentinel-session": "s"}, frozenset(UPSTREAMS))
        ctx = TurnContext(UPSTREAMS, self.ports, POLICY, self.detector, self.vault)
        reply = wire.reply_to_json(asyncio.run(run_turn(inbound, ctx)))
        self.history.append({"role": "assistant", "content": reply["content"]})
        return reply


def text(s):
    return {"type": "text", "text": s}


def result_for(reply, s):
    tool = next(b for b in reply["content"] if b["type"] == "tool_use")
    return {"type": "tool_result", "tool_use_id": tool["id"], "content": s}


def test_upstream_sees_placeholders_and_agent_gets_real_values_back():
    agent = Agent()
    reply = agent.turn(text(f"Handoff note:\n{NOTE}\nEmail dr.lee@demo.sentinel.local a summary."))

    sent = json.dumps(agent.ports.requests[0])
    assert "handled by [PERSON_1] ([EMAIL_ADDRESS_1]).\\n[PERSON_2] ([EMAIL_ADDRESS_2]) asked to move" in sent
    assert "Email [EMAIL_ADDRESS_4] a summary." in sent
    assert not [n for n in NAMES if n in sent] and "@demo.sentinel.local" not in sent

    said = next(b["text"] for b in reply["content"] if b["type"] == "text")
    assert all(n in said for n in NAMES[:3]) and "dr.lee@demo.sentinel.local" in said
    assert "[PERSON_99]" in said
    tool = next(b for b in reply["content"] if b["type"] == "tool_use")
    assert tool["input"] == {"to": "jeff.serrano@demo.sentinel.local", "subject": "Handoff",
                             "body": "Daniel Burton asked to move the meeting.", "cc": [{"name": "Laura Sanders"}]}


def test_event_records_tier_counts_action_and_both_diff_directions():
    agent = Agent()
    agent.turn(text(f"Handoff note:\n{NOTE}"))
    event = wire.event_to_json(agent.ports.events[-1])
    json.dumps(event)

    assert event["request"]["action"] == "REDACT" and event["request"]["rule"] == "confidential-redacted"
    assert event["headline"] == "HOLD" and event["egress"][0]["outcome"] == "forwarded"
    assert event["request"]["entity_counts"] == {"EMAIL_ADDRESS": 3, "PERSON": 3}
    assert event["request"]["tier"] == 2
    request, *calls = event["diff"]
    assert request["direction"] == "request" and request["where"] == "messages[0].content[0]"
    assert "Jeff Serrano" in request["real"] and "Jeff Serrano" not in request["masked"]
    first = request["marks"][0]
    assert request["real"][first["start"]:first["end"]] == "Jeff Serrano" and first["placeholder"] == "[PERSON_1]"
    to = next(c for c in calls if c["where"] == "tool_use send_email.to")
    assert (to["direction"], to["masked"], to["real"]) == ("tool_call", "[EMAIL_ADDRESS_1]",
                                                           "jeff.serrano@demo.sentinel.local")
    assert {c["where"] for c in calls} >= {"tool_use send_email.body", "tool_use send_email.cc[0].name"}


def test_three_turn_replay_keeps_upstream_history_byte_identical():
    agent = Agent()
    r1 = agent.turn(text(f"Handoff note:\n{NOTE}\nWho asked to move the meeting?"))
    r2 = agent.turn(result_for(r1, "sent"), text("Draft a two-line email to that person."))
    agent.turn(result_for(r2, "sent"), text("Who covers reception? Also cc Maria Lopez."))

    reqs, produced = agent.ports.requests, agent.ports.produced
    for before, said, after in zip(reqs, produced, reqs[1:]):
        assert json.dumps(after["system"]) == json.dumps(before["system"])
        prefix = after["messages"][:len(before["messages"]) + 1]
        assert json.dumps(prefix) == json.dumps(before["messages"] + [{"role": "assistant", "content": said["content"]}])
    assert "[PERSON_4]" in json.dumps(reqs[2]["messages"][-1]) and "Maria Lopez" not in json.dumps(reqs[2])


def test_thinking_blocks_are_byte_identical_in_both_directions():
    agent = Agent()
    r1 = agent.turn(text(f"Handoff note:\n{NOTE}"))
    assert json.dumps(r1["content"][0]) == json.dumps(THINKING)

    agent.turn(result_for(r1, "sent"))
    assert json.dumps(agent.ports.requests[1]["messages"][1]["content"][0]) == json.dumps(THINKING)


def test_placeholder_note_on_every_redact_turn_and_only_then():
    agent = Agent()
    agent.turn(text("Is 391 prime?"))
    assert "system" not in agent.ports.requests[0]
    assert agent.ports.events[-1].request.action is Action.ALLOW

    r2 = agent.turn(text(f"Handoff note:\n{NOTE}"))
    agent.turn(result_for(r2, "sent"))
    notes = [req["system"][-1] for req in agent.ports.requests[1:]]
    assert notes == [{"type": "text", "text": REDACTION_NOTE}] * 2


def test_a_known_value_alone_is_still_redacted():
    """Turn 2 carries only a name the vault already knows; it must not drop to ALLOW."""
    agent = Agent()
    agent.turn(text("Ping Jeff Serrano."))
    agent.history = []
    agent.turn(text("Ping Jeff Serrano again."))
    assert agent.ports.events[-1].request.action is Action.REDACT
    assert "[PERSON_1]" in json.dumps(agent.ports.requests[-1]["messages"])


@pytest.fixture(scope="module")
def found(presidio):
    return lambda text: {(s.entity_type, text[s.start:s.end]) for s in presidio.scan(text, frozenset(POLICY.tiers))}


class TestPresidioDetector:
    @staticmethod
    def types(spans):
        return {t for t, _ in spans}

    def test_light_note_has_people_and_local_emails_and_no_health(self, found):
        spans = found(NOTE)
        assert {"PERSON", "EMAIL_ADDRESS"} <= self.types(spans) and "HEALTH" not in self.types(spans)
        assert {("EMAIL_ADDRESS", e) for e in EMAILS.findall(NOTE)} <= spans

    def test_patient_note_has_health(self, found):
        assert "HEALTH" in self.types(found((DATA / "patient_note.txt").read_text()))

    def test_employees_have_ssns(self, found):
        assert "US_SSN" in self.types(found((DATA / "employees.csv").read_text()))

    @pytest.mark.parametrize("secret", [
        (DATA / ".env.fake").read_text(),
        "aws key AKIAIOSFODNN7EXAMPLE here",
        "token ghp_" + "a1B2c3D4e5" * 4,
        "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Z3VS5JJcds3xfn\n-----END RSA PRIVATE KEY-----",
        "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    ], ids=["env.fake", "aws", "github", "private-key", "jwt"])
    def test_secrets(self, found, secret):
        assert "SECRET" in self.types(found(secret))

    def test_ignored_presidio_types_never_appear(self, found):
        texts = [NOTE, *(p.read_text() for p in DATA.iterdir() if p.is_file())]
        assert not set().union(*(self.types(found(t)) for t in texts)) & {"URL", "US_ITIN", "US_DRIVER_LICENSE"}
