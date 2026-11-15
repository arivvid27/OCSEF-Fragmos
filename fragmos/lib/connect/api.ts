// Mirrors the engine's /api/gateway and /api/keys routes.
import { ENGINE, isRecord } from "../monitor/api";

export type KeyId = string & { readonly __brand: "KeyId" };

export interface Gateway {
  openai_base_url: string;
  anthropic_base_url: string;
  models: string[];
}

export interface ApiKey {
  id: KeyId;
  name: string;
  prefix: string;
  created_at: number; // unix seconds
  last_used_at: number | null;
}

/** The only time the engine returns the plain key. */
export interface CreatedKey extends ApiKey {
  key: string;
}

function parseKey(raw: unknown): ApiKey | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  if (typeof raw.prefix !== "string" || typeof raw.created_at !== "number") return null;
  return {
    id: raw.id as KeyId,
    name: raw.name,
    prefix: raw.prefix,
    created_at: raw.created_at,
    last_used_at: typeof raw.last_used_at === "number" ? raw.last_used_at : null,
  };
}

/** The engine did not answer: the request failed or timed out, or the /engine rewrite could not reach it. */
export class EngineUnreachable extends Error {}

const TIMEOUT_MS = 5000;

async function call(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${ENGINE}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new EngineUnreachable(`${path} did not answer`, { cause: e });
  }
}

// The engine answers errors as {"error": "..."}, FastAPI's own as {"detail": "..."}. A dead engine reaches
// the browser as the rewrite's plain-text 500.
async function failure(res: Response, what: string): Promise<Error> {
  const body: unknown = await res.json().catch(() => undefined);
  if (body === undefined && res.status >= 500) return new EngineUnreachable(`${what} answered ${res.status}`);
  const detail = isRecord(body) ? (body.error ?? body.detail) : undefined;
  return new Error(`${what} answered ${res.status}${typeof detail === "string" ? `: ${detail}` : ""}`);
}

async function getJson(path: string): Promise<unknown> {
  const res = await call(path);
  if (!res.ok) throw await failure(res, path);
  return res.json();
}

export async function fetchGateway(): Promise<Gateway> {
  const raw = await getJson("/api/gateway");
  if (
    !isRecord(raw) ||
    typeof raw.openai_base_url !== "string" ||
    typeof raw.anthropic_base_url !== "string" ||
    !Array.isArray(raw.models)
  ) {
    throw new Error("/api/gateway has an unexpected shape");
  }
  return {
    openai_base_url: raw.openai_base_url,
    anthropic_base_url: raw.anthropic_base_url,
    models: raw.models.filter((m): m is string => typeof m === "string"),
  };
}

export async function fetchKeys(): Promise<ApiKey[]> {
  const raw = await getJson("/api/keys");
  if (!Array.isArray(raw)) throw new Error("/api/keys has an unexpected shape");
  return raw.flatMap((item) => parseKey(item) ?? []);
}

export async function createKey(name: string): Promise<CreatedKey> {
  const res = await call("/api/keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (res.status !== 201) throw await failure(res, "creating a key");
  const raw: unknown = await res.json();
  const key = parseKey(raw);
  if (!key || !isRecord(raw) || typeof raw.key !== "string") throw new Error("the new key has an unexpected shape");
  return { ...key, key: raw.key };
}

/** Resolves once the key is gone, including when it was already gone (404). */
export async function revokeKey(id: KeyId): Promise<void> {
  const res = await call(`/api/keys/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (res.status !== 204 && res.status !== 404) throw await failure(res, `revoking key ${id}`);
}
