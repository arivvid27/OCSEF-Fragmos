"""FastAPI shell. Parse at the edge, call run_turn, serialize. No policy logic here."""

from __future__ import annotations

import asyncio
import dataclasses
import json
import os
import time
from pathlib import Path
from typing import Any, Awaitable, Callable

import yaml
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, Response, StreamingResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from sentinel import wire
from sentinel.approvals import HOLD_SECONDS, ApprovalDesk
from sentinel.core.model import (ApprovalRef, ApprovalStatus, Conversation, Event, HoldSubject, Inbound, Params,
                                 Reply, Upstream)
from sentinel.core.policy import load_policy
from sentinel.core.turn import TurnContext, UpstreamError, run_turn
from sentinel.core.vault import Vault
from sentinel.presidio_detector import PresidioDetector
from sentinel.store import DEFAULT_DB, KEY_NAME_MAX, Store
from sentinel.upstreams import UpstreamClients, registry_from_env

ROOT = Path(__file__).resolve().parent.parent
MONITOR_ORIGINS = "http://127.0.0.1:3000,http://localhost:3000"
LOOPBACK_HOSTS = ("127.0.0.1", "localhost")
NO_KEY = ("a valid Fragmos gateway key is required: create one in the dashboard or with "
          "python -m sentinel keys create <name>")


class Hub:
    def __init__(self) -> None:
        self._sockets: set[WebSocket] = set()

    async def serve(self, ws: WebSocket) -> None:
        await ws.accept()
        self._sockets.add(ws)
        try:
            while True:
                await ws.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            self._sockets.discard(ws)

    async def broadcast(self, message: dict[str, Any]) -> None:
        text = json.dumps(message)
        sockets = list(self._sockets)
        results = await asyncio.gather(*(ws.send_text(text) for ws in sockets), return_exceptions=True)
        for ws, result in zip(sockets, results):
            if isinstance(result, Exception):
                self._sockets.discard(ws)


async def json_or_none(request: Request) -> Any:
    try:
        return await request.json()
    except json.JSONDecodeError:
        return None


class ShellPorts:
    def __init__(self, clients: UpstreamClients, store: Store, hub: Hub, desk: ApprovalDesk) -> None:
        self._clients, self._store, self._hub, self._desk = clients, store, hub, desk

    async def call_upstream(self, upstream: Upstream, conversation: Conversation, params: Params,
                            session_id: str) -> Reply:
        return await self._clients.call_upstream(upstream, conversation, params, session_id)

    async def hold(self, subject: HoldSubject, on_open: Callable[[ApprovalRef], Awaitable[None]]) -> ApprovalStatus:
        return await self._desk.hold(subject, on_open)

    async def emit(self, event: Event) -> None:
        data = wire.event_to_json(event)
        self._store.upsert_event(data)
        await self._hub.broadcast({"kind": "event", "data": data})


def create_app(db_path: Path = DEFAULT_DB, policy_path: Path = ROOT / "policy.yaml",
               hold_seconds: float = HOLD_SECONDS, hosts: tuple[str, ...] = LOOPBACK_HOSTS,
               clients: UpstreamClients | None = None) -> FastAPI:
    """clients replaces the real upstream calls, for tests."""
    policy = load_policy(yaml.safe_load(policy_path.read_text()))
    detector = PresidioDetector()
    upstreams = registry_from_env()
    clients = clients or UpstreamClients(upstreams)
    store = Store(db_path)
    hub = Hub()
    desk = ApprovalDesk(store.db, hub.broadcast, hold_seconds)
    desk.expire_orphans()
    ports = ShellPorts(clients, store, hub, desk)
    vaults: dict[tuple[str, str], Vault] = {}  # by (key name, x-sentinel-session), so one key cannot read another's
    origins = {o.strip() for o in (os.environ.get("SENTINEL_ALLOWED_ORIGINS") or MONITOR_ORIGINS).split(",")} - {""}
    bound = f"http://127.0.0.1:{os.environ.get('SENTINEL_PORT') or 8787}"  # where python -m sentinel listens
    public = (os.environ.get("SENTINEL_PUBLIC_URL") or bound).rstrip("/")
    models = [u.id for u in upstreams.values() if not u.simulated]  # attacker-sim exists for the scripted demo
    app = FastAPI(title="SENTINEL")
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(hosts))  # a rebound DNS name is not loopback

    def foreign(origin: str | None) -> bool:
        """An agent or curl sends no Origin; a browser always does, and only the monitor's may reach in."""
        return origin is not None and origin not in origins

    def client_of(request: Request) -> str | None:
        """The name of the live gateway key the request presents, as a Bearer token or as x-api-key."""
        scheme, _, token = request.headers.get("authorization", "").partition(" ")
        key = token.strip() if scheme.lower() == "bearer" else request.headers.get("x-api-key", "")
        return store.use_key(key) if key else None

    def browser_refusal(request: Request, posts_json: bool = False) -> JSONResponse | None:
        if foreign(request.headers.get("origin")):
            return JSONResponse({"error": "origin not allowed"}, status_code=403)
        # A page can POST text/plain or a form to any host without asking; JSON makes the browser ask first, and fail.
        if posts_json and request.headers.get("content-type", "").split(";")[0].strip().lower() != "application/json":
            return JSONResponse({"error": "content-type must be application/json"}, status_code=415)
        return None

    async def turn(inbound: Inbound) -> Reply:
        return await run_turn(inbound, TurnContext(upstreams, ports, policy, detector,
                                                   vaults.setdefault((inbound.client, inbound.session_id), Vault())))

    @app.post("/v1/messages")
    async def messages(request: Request) -> JSONResponse:
        if foreign(request.headers.get("origin")):
            return JSONResponse(wire.error_body("permission_error", "origin not allowed"), status_code=403)
        if (client := client_of(request)) is None:
            return JSONResponse(wire.error_body("authentication_error", NO_KEY), status_code=401)
        try:
            inbound = wire.parse_request(await request.json(), request.headers, frozenset(upstreams), client)
        except (wire.WireError, json.JSONDecodeError) as e:
            return JSONResponse(wire.error_body("invalid_request_error", str(e)), status_code=400)
        try:
            reply = await turn(inbound)
        except UpstreamError as e:
            return JSONResponse(e.body, status_code=e.status)
        return JSONResponse(wire.reply_to_json(reply))

    @app.post("/v1/chat/completions", response_model=None)
    async def chat_completions(request: Request) -> JSONResponse | StreamingResponse:
        """A blocked or denied turn answers with the [SENTINEL] text as a normal assistant message, as on /v1/messages,
        so Open WebUI shows it in the chat. A held turn waits here for the Monitor's verdict before answering."""
        if foreign(request.headers.get("origin")):
            return JSONResponse(wire.openai_error("origin not allowed"), status_code=403)
        if (client := client_of(request)) is None:
            return JSONResponse(wire.openai_error(NO_KEY, "invalid_api_key"), status_code=401)
        try:
            body = await request.json()
            inbound = wire.parse_openai_request(body, request.headers, frozenset(upstreams), client)
        except (wire.WireError, json.JSONDecodeError) as e:
            return JSONResponse(wire.openai_error(str(e)), status_code=400)
        try:
            reply = await turn(inbound)
        except UpstreamError as e:
            return JSONResponse(wire.upstream_error_to_openai(e.body), status_code=e.status)
        created = int(time.time())
        if body.get("stream") is not True:
            return JSONResponse(wire.reply_to_openai(reply, created))
        lines = [f"data: {json.dumps(c)}\n\n" for c in wire.reply_to_openai_chunks(reply, created)]
        return StreamingResponse(iter([*lines, "data: [DONE]\n\n"]), media_type="text/event-stream")

    @app.get("/v1/models")
    async def list_models(request: Request) -> JSONResponse:
        if client_of(request) is None:
            return JSONResponse(wire.openai_error(NO_KEY, "invalid_api_key"), status_code=401)
        return JSONResponse({"object": "list", "data": [{"id": m, "object": "model", "created": 0,
                                                         "owned_by": "fragmos"} for m in models]})

    @app.get("/api/gateway")
    async def gateway() -> dict[str, Any]:
        return {"openai_base_url": f"{public}/v1", "anthropic_base_url": public, "models": models}

    @app.get("/api/events")
    async def events(limit: int = 200, session: str | None = None) -> list[dict[str, Any]]:
        return store.events(limit, session)

    @app.get("/api/stats")
    async def stats() -> dict[str, dict[str, int]]:
        return store.stats()

    @app.get("/api/approvals")
    async def approvals() -> list[dict[str, Any]]:
        return desk.list()

    @app.post("/api/approvals/{approval_id}")
    async def decide(approval_id: str, request: Request) -> JSONResponse:
        if refused := browser_refusal(request, posts_json=True):
            return refused
        body = await json_or_none(request)
        decision = body.get("decision") if isinstance(body, dict) else None
        verdict = {"approve": "approved", "deny": "denied"}.get(decision) if isinstance(decision, str) else None
        if verdict is None:
            return JSONResponse({"error": 'body must be {"decision": "approve" | "deny"}'}, status_code=400)
        try:
            accepted, row = await desk.decide(approval_id, verdict)
        except KeyError:
            return JSONResponse({"error": f"no approval {approval_id}"}, status_code=404)
        return JSONResponse(row, status_code=200 if accepted else 409)

    @app.get("/api/keys", response_model=None)
    async def list_keys(request: Request) -> JSONResponse | list[dict[str, Any]]:
        return browser_refusal(request) or [dataclasses.asdict(k) for k in store.keys()]

    @app.post("/api/keys")
    async def create_key(request: Request) -> JSONResponse:
        if refused := browser_refusal(request, posts_json=True):
            return refused
        body = await json_or_none(request)
        name = body.get("name") if isinstance(body, dict) else None
        if not isinstance(name, str) or not 0 < len(name.strip()) <= KEY_NAME_MAX:
            return JSONResponse({"error": f'body must be {{"name": "<1 to {KEY_NAME_MAX} characters>"}}'},
                                status_code=400)
        record, key = store.create_key(name.strip())
        shown = {k: v for k, v in dataclasses.asdict(record).items() if k != "last_used_at"}
        return JSONResponse({**shown, "key": key}, status_code=201)

    @app.delete("/api/keys/{key_id}")
    async def revoke_key(key_id: str, request: Request) -> Response:
        if refused := browser_refusal(request):
            return refused
        if not store.revoke_key(key_id):
            return JSONResponse({"error": f"no key {key_id}"}, status_code=404)
        return Response(status_code=204)

    @app.get("/api/policy")
    async def get_policy() -> dict[str, Any]:
        return wire.policy_to_json(policy)

    @app.get("/api/upstreams")
    async def get_upstreams() -> list[dict[str, Any]]:
        return [wire.upstream_to_json(u) for u in upstreams.values()]

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {
            "cloud_credentials": clients.cloud_credentials(),
            "local_reachable": await clients.reachable("local"),
            "rules": len(policy.rules),
        }

    @app.websocket("/ws")
    async def ws(socket: WebSocket) -> None:
        if foreign(socket.headers.get("origin")):
            await socket.close(code=1008)
            return
        await hub.serve(socket)

    return app
