"""Upstream registry from env, and the call port. Every upstream is an Anthropic client; no translation layer."""

from __future__ import annotations

import os
import uuid
from typing import Mapping

import anthropic
import httpx

from sentinel import wire
from sentinel.core.model import Conversation, Params, Reply, Trust, Upstream
from sentinel.core.turn import UpstreamError

GO_BASE = "https://opencode.ai/inference/go/anthropic"
USER_AGENT = "sentinel/0.1"
_SESSION_NS = uuid.UUID("6f1c2b1e-5e7a-4c39-9a51-3d1f0c2e8b40")


def registry_from_env(env: Mapping[str, str] = os.environ) -> dict[str, Upstream]:
    """A real local model later is SENTINEL_LOCAL_BASE_URL=http://localhost:11434 SENTINEL_LOCAL_MODEL=qwen2.5:7b."""
    return {
        "cloud": Upstream("cloud", Trust.CLOUD, GO_BASE,
                          env.get("SENTINEL_CLOUD_MODEL") or "deepseek-v4.1-flash", "OPENCODE_API_KEY"),
        "local": Upstream("local", Trust.LOCAL, env.get("SENTINEL_LOCAL_BASE_URL") or GO_BASE,
                          env.get("SENTINEL_LOCAL_MODEL") or "glm-5.3-flash",
                          env.get("SENTINEL_LOCAL_API_KEY_ENV") or "OPENCODE_API_KEY"),
    }


def opencode_session(session_id: str) -> str:
    """Stable per SENTINEL session and across restarts, so it is derived and never stored."""
    return str(uuid.uuid5(_SESSION_NS, session_id))


class UpstreamClients:
    def __init__(self, upstreams: Mapping[str, Upstream], env: Mapping[str, str] = os.environ) -> None:
        self._env = env
        self._clients = {
            u.id: anthropic.AsyncAnthropic(
                base_url=u.base_url,
                # Go answers 401 for a placeholder, which reaches the agent as a normal error.
                api_key=env.get(u.api_key_env) or "missing",
                max_retries=0,
                timeout=60,
                default_headers={"User-Agent": USER_AGENT},
            )
            for u in upstreams.values()
        }
        self._upstreams = upstreams

    async def call_upstream(self, upstream: Upstream, conversation: Conversation, params: Params,
                            session_id: str) -> Reply:
        headers = {"x-opencode-session": opencode_session(session_id)}
        if params.anthropic_version:
            headers["anthropic-version"] = params.anthropic_version
        if params.anthropic_beta:
            headers["anthropic-beta"] = params.anthropic_beta
        try:
            raw = await self._clients[upstream.id].messages.with_raw_response.create(
                model=upstream.model, **wire.to_upstream(conversation, params), extra_headers=headers)
        except anthropic.APIStatusError as e:
            raise UpstreamError(e.status_code, e.body or wire.error_body("api_error", str(e))) from e
        except anthropic.APIConnectionError as e:
            raise UpstreamError(502, wire.error_body("api_error", f"upstream {upstream.id} unreachable: {e}")) from e
        return wire.parse_reply(raw.http_response.json())

    def cloud_credentials(self) -> bool:
        return bool(self._env.get(self._upstreams["cloud"].api_key_env))

    async def reachable(self, upstream_id: str) -> bool:
        try:
            async with httpx.AsyncClient(timeout=1) as client:
                await client.get(self._upstreams[upstream_id].base_url)
            return True
        except httpx.HTTPError:
            return False
