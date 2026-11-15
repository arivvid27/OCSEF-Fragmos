"""The gateway doors: a turn needs a live key, and every event names the key that sent it."""

import pytest
from fastapi.testclient import TestClient

from sentinel import wire
from sentinel.app import LOOPBACK_HOSTS, create_app
from sentinel.core.model import Reply, Text

MONITOR = {"origin": "http://127.0.0.1:3000"}
NAME = "Jeff Serrano"


class EchoUpstream:
    """Answers "Hello <the last user text>" and keeps every request body it was sent."""

    def __init__(self):
        self.seen = []

    async def call_upstream(self, upstream, conversation, params, session_id):
        self.seen.append(wire.to_upstream(conversation, params))
        said = " ".join(b.text for b in conversation.messages[-1].content if isinstance(b, Text))
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
