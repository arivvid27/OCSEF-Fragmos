import json
from pathlib import Path

import pytest

from sentinel import wire
from sentinel.core.model import Opaque, Text, ToolUse

CAPTURED = json.loads((Path(__file__).parent / "fixtures" / "deepseek_reply.json").read_text())
UPSTREAMS = frozenset({"cloud", "local"})


def request(**overrides):
    return {"model": "anything", "max_tokens": 500, "messages": [{"role": "user", "content": "hi"}], **overrides}


def test_captured_reply_round_trips_exactly():
    reply = wire.parse_reply(CAPTURED)
    assert wire.reply_to_json(reply) == CAPTURED
    thinking = [b for b in reply.blocks if isinstance(b, Opaque)]
    assert thinking and thinking[0].raw["signature"] == ""


def test_assistant_history_reaches_upstream_unchanged():
    """The agent sends the captured reply back as history; the upstream must see those exact blocks."""
    tool_use = next(b for b in CAPTURED["content"] if b["type"] == "tool_use")
    body = request(
        system=[{"type": "text", "text": "be brief", "cache_control": {"type": "ephemeral"}}],
        messages=[
            {"role": "user", "content": "Is 391 prime?"},
            {"role": "assistant", "content": CAPTURED["content"]},
            {"role": "user", "content": [{"type": "tool_result", "tool_use_id": tool_use["id"],
                                          "content": [{"type": "text", "text": "17, 23"}], "is_error": False}]},
        ],
    )
    inbound = wire.parse_request(body, {}, UPSTREAMS)
    kwargs = wire.to_upstream(inbound.conversation, inbound.params)
    assert kwargs["system"] == body["system"]
    assert kwargs["messages"][1]["content"] == CAPTURED["content"]
    assert kwargs["messages"][2] == body["messages"][2]


def test_string_content_normalizes_the_same_way_every_turn():
    body = request(system="be brief", messages=[
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "hi there"},
        {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "file text"}]},
    ])
    inbound = wire.parse_request(body, {}, UPSTREAMS)
    first = wire.to_upstream(inbound.conversation, inbound.params)
    assert first["system"] == [{"type": "text", "text": "be brief"}]
    assert first["messages"][0]["content"] == [{"type": "text", "text": "hello"}]
    assert first["messages"][2]["content"][0]["content"] == [{"type": "text", "text": "file text"}]

    again = wire.parse_request({**body, "system": first["system"], "messages": first["messages"]}, {}, UPSTREAMS)
    assert json.dumps(wire.to_upstream(again.conversation, again.params)) == json.dumps(first)


def test_sampling_knobs_dropped_and_tool_choice_forced_auto():
    tools = [{"name": "read_file", "input_schema": {"type": "object"}}]
    body = request(temperature=0.2, top_p=0.9, top_k=5, tools=tools, tool_choice={"type": "any"})
    inbound = wire.parse_request(body, {}, UPSTREAMS)
    kwargs = wire.to_upstream(inbound.conversation, inbound.params)
    assert set(kwargs) == {"max_tokens", "messages", "tools", "tool_choice"}
    assert kwargs["tool_choice"] == {"type": "auto"}


def test_headers_pick_session_upstream_and_forwarded_versions():
    headers = {"x-sentinel-session": "s1", "x-sentinel-upstream": "local", "anthropic-version": "2023-06-01"}
    inbound = wire.parse_request(request(), headers, UPSTREAMS)
    assert (inbound.session_id, inbound.upstream_id, inbound.params.anthropic_version) == ("s1", "local", "2023-06-01")
    default = wire.parse_request(request(), {}, UPSTREAMS)
    assert (default.session_id, default.upstream_id) == ("default", "cloud")


@pytest.mark.parametrize("body, headers", [
    (request(stream=True), {}),
    (request(), {"x-sentinel-upstream": "elsewhere"}),
    (request(messages=[]), {}),
    (request(max_tokens="500"), {}),
    (request(messages=[{"role": "system", "content": "x"}]), {}),
])
def test_bad_requests_are_rejected(body, headers):
    with pytest.raises(wire.WireError):
        wire.parse_request(body, headers, UPSTREAMS)


def test_rewrite_touches_text_and_tool_input_strings_but_never_thinking():
    body = request(messages=[{"role": "user", "content": "alice"}, {"role": "assistant", "content": CAPTURED["content"]}])
    conv = wire.parse_request(body, {}, UPSTREAMS).conversation
    assert [leaf.rewritable for leaf in conv.leaves()] == [True, False, True]

    upper = conv.rewrite(lambda leaf: leaf.text.upper())
    assert upper.messages[0].content == (Text("ALICE"),)
    assert upper.messages[1].content[0] is conv.messages[1].content[0]
    tool = upper.messages[1].content[1]
    assert isinstance(tool, ToolUse) and all(v == v.upper() for v in tool.input.values())
