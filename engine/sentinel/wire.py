"""The only module that knows Anthropic JSON. Parse once at the edge, serialize once on the way out."""

from __future__ import annotations

import dataclasses
import re
from enum import Enum
from typing import Any, Mapping
from urllib.parse import urlsplit

from sentinel.core.model import (Block, Conversation, Event, HoldSubject, Inbound, Message, Opaque, Params, Reply, Text,
                                 ToolResult, ToolUse, Upstream)
from sentinel.core.policy import Policy


class WireError(ValueError):
    """Becomes HTTP 400 with an Anthropic-shaped invalid_request_error body."""


# Forwarded verbatim, so each must be a shape that cannot carry prose; anthropic-beta is also scanned as a leaf.
FORWARDED_HEADERS = {"anthropic-version": re.compile(r"\d{4}-\d{2}-\d{2}"),
                     "anthropic-beta": re.compile(r"[a-z0-9-]+(,[a-z0-9-]+)*")}


def error_body(kind: str, message: str) -> dict[str, Any]:
    return {"type": "error", "error": {"type": kind, "message": message}}


def _rest(raw: Mapping[str, Any], *known: str) -> dict[str, Any]:
    return {k: v for k, v in raw.items() if k not in known}


def _str(raw: Mapping[str, Any], key: str) -> str:
    value = raw[key]
    if not isinstance(value, str):
        raise WireError(f"{raw['type']}.{key} must be a string")
    return value


def _block(raw: Any) -> Block:
    if not isinstance(raw, dict) or not isinstance(raw.get("type"), str):
        raise WireError("each content block must be an object with a type")
    match raw["type"]:
        case "text":
            return Text(_str(raw, "text"), _rest(raw, "type", "text"))
        case "tool_use":
            return ToolUse(_str(raw, "id"), _str(raw, "name"), raw["input"], _rest(raw, "type", "id", "name", "input"))
        case "tool_result":
            return ToolResult(_str(raw, "tool_use_id"), _content(raw.get("content", [])),
                              _rest(raw, "type", "tool_use_id", "content"))
        case _:
            return Opaque(raw)


def _content(raw: Any) -> tuple[Block, ...]:
    """String content becomes one Text block, the same way every turn, so upstream bytes stay stable."""
    if isinstance(raw, str):
        return (Text(raw),)
    if isinstance(raw, list):
        return tuple(_block(b) for b in raw)
    raise WireError("content must be a string or a list of blocks")


def _system(raw: Any) -> tuple[Text, ...]:
    blocks = _content(raw) if raw is not None else ()
    if not all(isinstance(b, Text) for b in blocks):
        raise WireError("system blocks must be text")
    return blocks  # type: ignore[return-value]


def parse_request(body: Any, headers: Mapping[str, str], known_upstreams: frozenset[str], client: str) -> Inbound:
    """headers must be case-insensitive or lower-cased. The agent's model, key, and sampling knobs are ignored."""
    if not isinstance(body, dict):
        raise WireError("request body must be a JSON object")
    if body.get("stream"):
        raise WireError("streaming is not supported by SENTINEL; send stream=false")
    upstream_id = headers.get("x-sentinel-upstream") or "cloud"
    if upstream_id not in known_upstreams:
        raise WireError(f"unknown x-sentinel-upstream {upstream_id!r}")
    max_tokens = body.get("max_tokens")
    if not isinstance(max_tokens, int) or isinstance(max_tokens, bool):
        raise WireError("max_tokens must be an integer")
    messages = body.get("messages")
    if not isinstance(messages, list) or not messages:
        raise WireError("messages must be a non-empty list")
    tools = body.get("tools") or []
    if not isinstance(tools, list) or not all(isinstance(t, dict) for t in tools):
        raise WireError("tools must be a list of objects")
    stop_sequences = body.get("stop_sequences") or []
    if not isinstance(stop_sequences, list) or not all(isinstance(s, str) for s in stop_sequences):
        raise WireError("stop_sequences must be a list of strings")
    for name, shape in FORWARDED_HEADERS.items():
        if headers.get(name) is not None and not shape.fullmatch(headers[name]):
            raise WireError(f"{name} must match {shape.pattern}")
    try:
        parsed = tuple(Message(_role(m), _content(m.get("content"))) for m in messages)
        system = _system(body.get("system"))
    except (KeyError, TypeError) as e:
        raise WireError(f"malformed block: missing {e}") from e
    return Inbound(
        session_id=headers.get("x-sentinel-session") or "default",
        client=client,
        upstream_id=upstream_id,
        conversation=Conversation(system, parsed),
        params=Params(
            max_tokens=max_tokens,
            tools=tuple(tools),
            stop_sequences=tuple(stop_sequences),
            anthropic_version=headers.get("anthropic-version"),
            anthropic_beta=headers.get("anthropic-beta"),
        ),
    )


def _role(m: Any) -> str:
    if not isinstance(m, dict) or m.get("role") not in ("user", "assistant"):
        raise WireError("each message needs role user or assistant")
    return m["role"]


def block_to_json(block: Block) -> dict[str, Any]:
    match block:
        case Text(text=t, extra=x):
            return {"type": "text", "text": t, **x}
        case ToolUse(id=i, name=n, input=inp, extra=x):
            return {"type": "tool_use", "id": i, "name": n, "input": inp, **x}
        case ToolResult(tool_use_id=i, content=c, extra=x):
            return {"type": "tool_result", "tool_use_id": i, "content": [block_to_json(b) for b in c], **x}
        case Opaque(raw=raw):
            return raw  # type: ignore[return-value]


def to_upstream(conversation: Conversation, params: Params) -> dict[str, Any]:
    """kwargs for AsyncAnthropic.messages.create, minus model and headers."""
    kwargs: dict[str, Any] = {
        "max_tokens": params.max_tokens,
        "messages": [{"role": m.role, "content": [block_to_json(b) for b in m.content]}
                     for m in conversation.messages],
    }
    if conversation.system:
        kwargs["system"] = [block_to_json(t) for t in conversation.system]
    if params.tools:
        kwargs["tools"] = list(params.tools)
        kwargs["tool_choice"] = {"type": "auto"}
    if params.stop_sequences:
        kwargs["stop_sequences"] = list(params.stop_sequences)
    return kwargs


def parse_reply(message: Mapping[str, Any]) -> Reply:
    """From the upstream's raw response JSON. Thinking blocks with an empty signature become Opaque unchanged."""
    return Reply(
        id=message["id"],
        model=message["model"],
        blocks=tuple(_block(b) for b in message["content"]),
        stop_reason=message.get("stop_reason"),
        stop_sequence=message.get("stop_sequence"),
        usage=message.get("usage") or {},
        extra=_rest(message, "id", "type", "role", "model", "content", "stop_reason", "stop_sequence", "usage"),
    )


def reply_to_json(reply: Reply) -> dict[str, Any]:
    return {
        "id": reply.id,
        "type": "message",
        "role": "assistant",
        "model": reply.model,
        "content": [block_to_json(b) for b in reply.blocks],
        "stop_reason": reply.stop_reason,
        "stop_sequence": reply.stop_sequence,
        "usage": dict(reply.usage),
        **reply.extra,
    }


def _plain(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, frozenset):
        return sorted(value)
    return value


def _to_json(obj: Any) -> dict[str, Any]:
    return dataclasses.asdict(obj, dict_factory=lambda items: {k: _plain(v) for k, v in items})


def event_to_json(event: Event) -> dict[str, Any]:
    """The dashboard's Event type mirrors this function's output."""
    return _to_json(event)


def hold_subject_to_json(subject: HoldSubject) -> dict[str, Any]:
    return _to_json(subject)


def policy_to_json(policy: Policy) -> dict[str, Any]:
    return _to_json(policy)


def upstream_to_json(upstream: Upstream) -> dict[str, Any]:
    """No base_url or key env name, only the host, so the dashboard can say whether "local" is really on-device."""
    return {"id": upstream.id, "trust": upstream.trust.value, "model": upstream.model, "simulated": upstream.simulated,
            "host": urlsplit(upstream.base_url).hostname or ""}
