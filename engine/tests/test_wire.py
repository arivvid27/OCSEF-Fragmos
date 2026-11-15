import json
from pathlib import Path

import pytest

from sentinel import wire
from sentinel.core.model import Opaque, Text, ToolUse
from sentinel.upstreams import registry_from_env

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
    inbound = wire.parse_request(body, {}, UPSTREAMS, client="test")
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
    inbound = wire.parse_request(body, {}, UPSTREAMS, client="test")
    first = wire.to_upstream(inbound.conversation, inbound.params)
    assert first["system"] == [{"type": "text", "text": "be brief"}]
    assert first["messages"][0]["content"] == [{"type": "text", "text": "hello"}]
    assert first["messages"][2]["content"][0]["content"] == [{"type": "text", "text": "file text"}]

    again = wire.parse_request({**body, "system": first["system"], "messages": first["messages"]}, {}, UPSTREAMS, client="test")
    assert json.dumps(wire.to_upstream(again.conversation, again.params)) == json.dumps(first)


def test_sampling_knobs_dropped_and_tool_choice_forced_auto():
    tools = [{"name": "read_file", "input_schema": {"type": "object"}}]
    body = request(temperature=0.2, top_p=0.9, top_k=5, tools=tools, tool_choice={"type": "any"})
    inbound = wire.parse_request(body, {}, UPSTREAMS, client="test")
    kwargs = wire.to_upstream(inbound.conversation, inbound.params)
    assert set(kwargs) == {"max_tokens", "messages", "tools", "tool_choice"}
    assert kwargs["tool_choice"] == {"type": "auto"}


def test_headers_pick_session_upstream_and_forwarded_versions():
    headers = {"x-sentinel-session": "s1", "x-sentinel-upstream": "local", "anthropic-version": "2023-06-01"}
    inbound = wire.parse_request(request(), headers, UPSTREAMS, client="test")
    assert (inbound.session_id, inbound.upstream_id, inbound.params.anthropic_version) == ("s1", "local", "2023-06-01")
    default = wire.parse_request(request(), {}, UPSTREAMS, client="test")
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
        wire.parse_request(body, headers, UPSTREAMS, client="test")


def test_rewrite_touches_text_and_tool_input_strings_but_never_thinking():
    body = request(messages=[{"role": "user", "content": "alice"}, {"role": "assistant", "content": CAPTURED["content"]}])
    conv = wire.parse_request(body, {}, UPSTREAMS, client="test").conversation
    leaves = list(conv.leaves())
    assert [leaf.text for leaf in leaves if leaf.rewritable] == ["alice", "primes.txt"]
    read_only = {leaf.text for leaf in leaves if not leaf.rewritable}
    assert {CAPTURED["content"][0]["thinking"], "read_file", "call_e18a2dd95d5840dba2d9eb17", "path"} <= read_only

    upper = conv.rewrite(lambda leaf: leaf.text.upper())
    assert upper.messages[0].content == (Text("ALICE"),)
    assert upper.messages[1].content[0] is conv.messages[1].content[0]
    tool = upper.messages[1].content[1]
    assert isinstance(tool, ToolUse) and all(v == v.upper() for v in tool.input.values())


def test_dashboard_sees_upstream_host_but_not_its_url_or_key_name():
    shown = [wire.upstream_to_json(u) for u in registry_from_env({}).values()]
    assert shown == [
        {"id": "cloud", "trust": "cloud", "model": "deepseek-v4.1-flash", "simulated": False, "host": "opencode.ai"},
        {"id": "local", "trust": "local", "model": "glm-5.3-flash", "simulated": False, "host": "opencode.ai"},
        {"id": "attacker-sim", "trust": "local", "model": "attacker-sim", "simulated": True, "host": "127.0.0.1"},
    ]


PROTOCOL = {"messages", "role", "content", "system", "tools", "stop_sequences", "type", "text", "id", "name", "input",
            "tool_use_id", "user", "assistant", "tool_use", "tool_result"}


def test_every_value_sent_upstream_is_a_scanned_leaf():
    """The structural form of "everything SENTINEL forwards is seen by detection"."""
    document = {"type": "document", "source": {"type": "text", "media_type": "text/plain", "data": "doc body"}}
    body = request(
        system=[{"type": "text", "text": "sys", "cache_control": {"type": "ephemeral"},
                 "citations": [{"cited_text": "cited in system"}]}],
        tools=[{"name": "save", "description": "Save it.", "input_schema": {
            "type": "object", "properties": {"p": {"type": "integer", "default": 7, "enum": ["one"]}}}}],
        stop_sequences=["STOP"],
        messages=[
            {"role": "user", "content": [
                {"type": "text", "text": "hello", "citations": [{"cited_text": "cited in user", "start": 3}]},
                document,
                {"type": "image", "source": {"type": "url", "url": "https://images.invalid/a.png"}},
                {"type": "search_result", "source": "kb://1", "title": "kb", "content": [{"type": "text", "text": "kb"}]},
            ]},
            {"role": "assistant", "content": [
                *CAPTURED["content"], {"type": "redacted_thinking", "data": "opaque blob"},
                {"type": "tool_use", "id": "toolu_9", "name": "save", "input": {"k": [1, 2.5, "v"], "n": None},
                 "metadata": "meta"}]},
            {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "toolu_9", "is_error": "maybe",
                                          "content": [{"type": "text", "text": "saved"}, document]}]},
        ])
    inbound = wire.parse_request(body, {"anthropic-beta": "files-api-2025-04-14"}, UPSTREAMS, client="test")
    leaves = list(inbound.leaves())
    texts = {leaf.text for leaf in leaves}
    keys = {line for leaf in leaves for line in leaf.text.split("\n")}
    sent = wire.to_upstream(inbound.conversation, inbound.params)
    del sent["max_tokens"], sent["tool_choice"]

    def scalars(value):
        if isinstance(value, dict):
            for k, v in value.items():
                yield k, keys
                yield from scalars(v)
        elif isinstance(value, list):
            for v in value:
                yield from scalars(v)
        elif isinstance(value, str) or (isinstance(value, (int, float)) and not isinstance(value, bool)):
            yield str(value), texts

    assert {v for v, scanned in scalars(sent) if v not in scanned and v not in PROTOCOL} == set()
    assert "files-api-2025-04-14" in texts


def chat(**overrides):
    return {"model": "gpt-4o", "messages": [{"role": "user", "content": "hi"}], **overrides}


def openai_upstream_body(body, headers=None):
    inbound = wire.parse_openai_request(body, headers or {}, UPSTREAMS, client="test")
    return inbound.upstream_id, wire.to_upstream(inbound.conversation, inbound.params)


def test_an_openai_chat_becomes_the_anthropic_request_the_core_forwards():
    body = chat(messages=[
        {"role": "system", "content": "Be brief."},
        {"role": "developer", "content": [{"type": "text", "text": "Answer in English."}]},
        {"role": "user", "content": [{"type": "text", "text": "Hi,"}, {"type": "text", "text": "who are you?"}]},
        {"role": "assistant", "content": "An assistant."},
        {"role": "user", "content": "Thanks."},
    ], max_tokens=300, temperature=0.3, top_p=0.5, stream=True, stream_options={"include_usage": True})
    upstream, sent = openai_upstream_body(body)
    assert upstream == "cloud"
    assert sent == {
        "max_tokens": 300,
        "temperature": 0.3,
        "system": [{"type": "text", "text": "Be brief."}, {"type": "text", "text": "Answer in English."}],
        "messages": [
            {"role": "user", "content": [{"type": "text", "text": "Hi,"}, {"type": "text", "text": "who are you?"}]},
            {"role": "assistant", "content": [{"type": "text", "text": "An assistant."}]},
            {"role": "user", "content": [{"type": "text", "text": "Thanks."}]},
        ],
    }


def test_empty_openai_text_never_reaches_the_upstream():
    body = chat(messages=[{"role": "user", "content": "hi"}, {"role": "assistant", "content": ""},
                          {"role": "user", "content": [{"type": "text", "text": ""}, {"type": "text", "text": "again"}]}])
    assert openai_upstream_body(body)[1]["messages"] == [
        {"role": "user", "content": [{"type": "text", "text": "hi"}]},
        {"role": "user", "content": [{"type": "text", "text": "again"}]},
    ]


def test_openai_token_caps_prefer_max_completion_tokens_and_default_when_absent():
    assert openai_upstream_body(chat(max_tokens=10, max_completion_tokens=20))[1]["max_tokens"] == 20
    assert openai_upstream_body(chat(max_tokens=10, max_completion_tokens=None))[1]["max_tokens"] == 10
    assert openai_upstream_body(chat())[1]["max_tokens"] == wire.OPENAI_MAX_TOKENS


def test_the_openai_model_picks_an_upstream_and_anything_else_routes_like_the_anthropic_door():
    assert openai_upstream_body(chat(model="local"))[0] == "local"
    assert openai_upstream_body(chat(model="gpt-4o"))[0] == "cloud"
    assert openai_upstream_body(chat(model="gpt-4o"), {"x-sentinel-upstream": "local"})[0] == "local"


@pytest.mark.parametrize("body", [
    chat(messages=[{"role": "user", "content": [{"type": "image_url", "image_url": {"url": "data:image/png;base64,AA"}}]}]),
    chat(tools=[{"type": "function", "function": {"name": "f"}}]),
    chat(messages=[{"role": "user", "content": "hi"}, {"role": "assistant", "content": None, "tool_calls": [{"id": "c"}]}]),
    chat(messages=[{"role": "tool", "tool_call_id": "c", "content": "42"}]),
    chat(messages=[{"role": "system", "content": "only a system prompt"}]),
    chat(messages=[]),
    chat(max_tokens="many"),
    chat(temperature="warm"),
], ids=["image", "tools", "tool-calls", "tool-role", "system-only", "empty", "max-tokens", "temperature"])
def test_openai_requests_the_core_cannot_carry_yet_are_refused(body):
    with pytest.raises(wire.WireError):
        wire.parse_openai_request(body, {}, UPSTREAMS, client="test")
