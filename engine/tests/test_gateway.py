"""The gateway doors: a turn needs a live key, every event names the key that sent it, and the OpenAI door runs the
same turn as the Anthropic one."""

import json

import pytest
from fastapi.testclient import TestClient

from sentinel import wire
from sentinel.app import LOOPBACK_HOSTS, create_app
from sentinel.core.model import Reply, Text
from sentinel.core.turn import UpstreamError

MONITOR = {"origin": "http://127.0.0.1:3000"}
NAME = "Jeff Serrano"


class EchoUpstream:
    """Answers "Hello <the last user text>" and keeps every request body it was sent."""

    def __init__(self):
        self.seen = []

    async def call_upstream(self, upstream, conversation, params, session_id):
        self.seen.append(wire.to_upstream(conversation, params))
        said = " ".join(b.text for b in conversation.messages[-1].content if isinstance(b, Text))
        if said == "overload":
            raise UpstreamError(529, {"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}})
        return Reply(id="msg_echo", model=upstream.model, blocks=(Text(f"Hello {said}"),), stop_reason="end_turn",
                     usage={"input_tokens": 11, "output_tokens": 7})


@pytest.fixture(scope="module")
def gateway(tmp_path_factory):
    upstream = EchoUpstream()
    db = tmp_path_factory.mktemp("gateway") / "sentinel.db"
    client = TestClient(create_app(db_path=db, hosts=(*LOOPBACK_HOSTS, "testserver"), clients=upstream))
    return client, upstream


def mint(client, name="open-webui"):
    body = client.post("/api/keys", json={"name": name}, headers=MONITOR).json()
    return body["id"], body["key"]


def anthropic_turn(client, headers, text="Is 391 prime?", session="s-anthropic"):
    return client.post("/v1/messages", headers={"x-sentinel-session": session, **headers},
                       json={"model": "x", "max_tokens": 50, "messages": [{"role": "user", "content": text}]})


def test_the_anthropic_door_takes_a_key_as_x_api_key_or_bearer(gateway):
    client, _ = gateway
    key_id, key = mint(client)
    assert anthropic_turn(client, {"x-api-key": key}).status_code == 200
    assert anthropic_turn(client, {"authorization": f"Bearer {key}"}).status_code == 200
    row = next(k for k in client.get("/api/keys", headers=MONITOR).json() if k["id"] == key_id)
    assert row["last_used_at"] is not None


@pytest.mark.parametrize("headers", [{}, {"x-api-key": "fk_" + "A" * 40}, {"authorization": "Bearer nope"},
                                     {"authorization": "Basic Zms="}], ids=["none", "wrong", "bearer-wrong", "basic"])
def test_the_anthropic_door_refuses_a_missing_or_wrong_key(gateway, headers):
    client, upstream = gateway
    calls = len(upstream.seen)
    response = anthropic_turn(client, headers)
    assert response.status_code == 401
    assert response.json()["error"]["type"] == "authentication_error"
    assert len(upstream.seen) == calls


def test_a_revoked_key_stops_working_at_once(gateway):
    client, _ = gateway
    key_id, key = mint(client, "short-lived")
    assert anthropic_turn(client, {"x-api-key": key}).status_code == 200
    assert client.delete(f"/api/keys/{key_id}", headers=MONITOR).status_code == 204
    assert anthropic_turn(client, {"x-api-key": key}).status_code == 401


def test_every_event_names_the_key_that_sent_the_turn(gateway):
    client, _ = gateway
    _, key = mint(client, "claude-code")
    with client.websocket_connect("/ws") as socket:
        assert anthropic_turn(client, {"x-api-key": key}, session="s-attrib").status_code == 200
        live = [socket.receive_json()["data"]]
        while live[-1]["stage"] != "returned":
            live.append(socket.receive_json()["data"])
    assert len(live) > 1 and {e["client"] for e in live} == {"claude-code"}
    stored = client.get("/api/events", params={"session": "s-attrib"}).json()
    assert [e["client"] for e in stored] == ["claude-code"]


def openai_turn(client, key, text, session, **body):
    return client.post("/v1/chat/completions", headers={"authorization": f"Bearer {key}", "x-sentinel-session": session},
                       json={"model": "fragmos", "messages": [{"role": "system", "content": "Be warm."},
                                                              {"role": "user", "content": text}], **body})


def sse(response):
    lines = [line for line in response.text.split("\n\n") if line]
    assert all(line.startswith("data: ") for line in lines)
    return [line[len("data: "):] for line in lines]


def test_a_chat_completion_masks_the_name_upstream_and_restores_it_in_the_answer(gateway):
    client, upstream = gateway
    _, key = mint(client, "open-webui")
    prompt = f"Write a greeting for {NAME}."
    response = openai_turn(client, key, prompt, "s-openai")
    assert response.status_code == 200
    sent = json.dumps(upstream.seen[-1])
    assert NAME not in sent and "[PERSON_1]" in sent and "Be warm." in sent
    body = response.json()
    assert body["object"] == "chat.completion" and isinstance(body["created"], int) and body["id"]
    assert body["choices"] == [{"index": 0, "message": {"role": "assistant", "content": f"Hello {prompt}"},
                                "finish_reason": "stop"}]
    assert body["usage"] == {"prompt_tokens": 11, "completion_tokens": 7, "total_tokens": 18}
    [event] = client.get("/api/events", params={"session": "s-openai"}).json()
    assert (event["client"], event["request"]["action"], event["upstream"]["id"]) == ("open-webui", "REDACT", "cloud")


def test_a_streamed_chat_completion_sends_a_role_chunk_the_answer_a_finish_chunk_then_done(gateway):
    client, upstream = gateway
    _, key = mint(client, "open-webui")
    prompt = f"Say hi to {NAME}."
    response = openai_turn(client, key, prompt, "s-stream", stream=True)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert NAME not in json.dumps(upstream.seen[-1])
    *data, done = sse(response)
    assert done == "[DONE]"
    chunks = [json.loads(d) for d in data]
    assert {c["object"] for c in chunks} == {"chat.completion.chunk"}
    assert chunks[0]["choices"][0]["delta"]["role"] == "assistant"
    assert "".join(c["choices"][0]["delta"].get("content", "") for c in chunks) == f"Hello {prompt}"
    assert [c["choices"][0]["finish_reason"] for c in chunks][-1] == "stop"
    assert all(c["choices"][0]["finish_reason"] is None for c in chunks[:-1])


@pytest.mark.parametrize("door", ["anthropic", "openai"])
def test_a_key_cannot_rehydrate_another_keys_placeholders_on_the_same_session(gateway, door):
    client, upstream = gateway
    _, alice = mint(client, f"alice-{door}")
    _, bob = mint(client, f"bob-{door}")
    session = f"s-shared-{door}"
    send = ((lambda key, text: anthropic_turn(client, {"x-api-key": key}, text, session)) if door == "anthropic" else
            (lambda key, text: openai_turn(client, key, text, session)))
    assert send(alice, f"Write a greeting for {NAME}.").status_code == 200
    assert "[PERSON_1]" in json.dumps(upstream.seen[-1])
    answer = send(bob, "[PERSON_1]")
    assert answer.status_code == 200
    assert NAME not in answer.text and "[PERSON_1]" in answer.text


def test_the_openai_model_field_picks_the_upstream(gateway):
    client, _ = gateway
    _, key = mint(client)
    assert openai_turn(client, key, "Is 391 prime?", "s-model", model="local").status_code == 200
    [event] = client.get("/api/events", params={"session": "s-model"}).json()
    assert event["upstream"]["id"] == "local"


def test_the_openai_door_answers_errors_in_openai_shape(gateway):
    client, upstream = gateway
    _, key = mint(client)
    calls = len(upstream.seen)
    for response, status in [(openai_turn(client, "fk_wrong", "hi", "s-err"), 401),
                             (client.post("/v1/chat/completions", json={"model": "x", "messages": []},
                                          headers={"authorization": f"Bearer {key}"}), 400),
                             (openai_turn(client, key, "overload", "s-err"), 529)]:
        assert response.status_code == status
        assert isinstance(response.json()["error"]["message"], str)
    assert openai_turn(client, "fk_wrong", "hi", "s-err").json()["error"]["code"] == "invalid_api_key"
    assert len(upstream.seen) == calls + 1


def test_models_and_gateway_list_the_upstreams_a_caller_can_pick(gateway):
    client, _ = gateway
    _, key = mint(client)
    assert client.get("/v1/models").status_code == 401
    models = client.get("/v1/models", headers={"authorization": f"Bearer {key}"}).json()
    assert models["object"] == "list"
    assert [(m["id"], m["object"]) for m in models["data"]] == [("cloud", "model"), ("local", "model")]
    assert client.get("/api/gateway").json() == {"openai_base_url": "http://127.0.0.1:8787/v1",
                                                 "anthropic_base_url": "http://127.0.0.1:8787",
                                                 "models": ["cloud", "local"]}


def test_the_public_url_is_only_shown_and_its_host_is_refused(tmp_path, monkeypatch):
    monkeypatch.setenv("SENTINEL_PUBLIC_URL", "https://fragmos.tunnel.example/")
    client = TestClient(create_app(db_path=tmp_path / "sentinel.db", clients=EchoUpstream()),
                        base_url="http://127.0.0.1:8787")
    assert client.get("/api/gateway").json()["openai_base_url"] == "https://fragmos.tunnel.example/v1"
    for path in ["/api/gateway", "/api/keys", "/api/events"]:
        assert client.get(path, headers={"host": "fragmos.tunnel.example"}).status_code == 400
