import { afterEach, describe, expect, it, vi } from "vitest";
import { createKey, EngineUnreachable, fetchGateway, fetchKeys, revokeKey, type KeyId } from "./api";

const gateway = {
  openai_base_url: "http://127.0.0.1:8787/v1",
  anthropic_base_url: "http://127.0.0.1:8787",
  models: ["cloud", "local"],
};
const row = { id: "k1", name: "openwebui", prefix: "fm_ab12", created_at: 1700000000, last_used_at: null };

function stub(respond: (init?: RequestInit) => Promise<Response>) {
  const fetch = vi.fn((_url: string, init?: RequestInit) => respond(init));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function answer(status: number, body?: unknown) {
  return stub(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }));
}

// What the /engine rewrite sends when nothing listens on SENTINEL_URL.
const rewriteCannotReachEngine = () => stub(async () => new Response("Internal Server Error", { status: 500 }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchGateway", () => {
  it("reads the base URLs and models through the engine rewrite", async () => {
    const fetch = answer(200, gateway);
    expect(await fetchGateway()).toEqual(gateway);
    expect(fetch).toHaveBeenCalledWith("/engine/api/gateway", expect.anything());
  });

  it("rejects a shape the engine does not send, as an engine error", async () => {
    answer(200, { openai_base_url: "http://x/v1" });
    const error = await fetchGateway().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(EngineUnreachable);
  });

  it("calls the engine unreachable when the rewrite cannot reach it", async () => {
    rewriteCannotReachEngine();
    await expect(fetchGateway()).rejects.toBeInstanceOf(EngineUnreachable);
  });

  it("calls the engine unreachable when the request fails", async () => {
    stub(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(fetchGateway()).rejects.toBeInstanceOf(EngineUnreachable);
  });

  it("gives up on a stalled request after five seconds", async () => {
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation(() => AbortSignal.abort(new DOMException("timed out", "TimeoutError")));
    stub(
      (init) =>
        new Promise((_, reject) => {
          if (init?.signal?.aborted) reject(init.signal.reason);
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    await expect(fetchGateway()).rejects.toBeInstanceOf(EngineUnreachable);
    expect(timeout).toHaveBeenCalledWith(5000);
  });

  it("passes on the engine's own error instead of calling it unreachable", async () => {
    answer(500, { error: "store is locked" });
    const error = await fetchGateway().catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(EngineUnreachable);
    expect(String(error)).toContain("store is locked");
  });
});

describe("fetchKeys", () => {
  it("keeps well-formed rows and drops the rest", async () => {
    const fetch = answer(200, [row, { ...row, id: "k2", last_used_at: 1700000100 }, { id: "k3" }]);
    const keys = await fetchKeys();
    expect(keys.map((k) => k.id)).toEqual(["k1", "k2"]);
    expect(keys.map((k) => k.last_used_at)).toEqual([null, 1700000100]);
    expect(fetch).toHaveBeenCalledWith("/engine/api/keys", expect.anything());
  });

  it("calls the engine unreachable when the rewrite cannot reach it", async () => {
    rewriteCannotReachEngine();
    await expect(fetchKeys()).rejects.toBeInstanceOf(EngineUnreachable);
  });
});

describe("createKey", () => {
  it("posts the name as JSON and returns the plain key once", async () => {
    const fetch = answer(201, { id: "k1", name: "openwebui", prefix: "fm_ab12", created_at: 1700000000, key: "fm_ab12secret" });
    const created = await createKey("openwebui");
    expect(created).toEqual({ ...row, key: "fm_ab12secret" });
    expect(fetch).toHaveBeenCalledWith(
      "/engine/api/keys",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"name":"openwebui"}',
      }),
    );
  });

  it("says what the engine refused", async () => {
    answer(400, { error: 'body must be {"name": "<1 to 64 characters>"}' });
    const error = await createKey("").catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(EngineUnreachable);
    expect(String(error)).toContain("400");
    expect(String(error)).toContain("<1 to 64 characters>");
  });

  it("reads FastAPI's own detail too", async () => {
    answer(405, { detail: "Method Not Allowed" });
    await expect(createKey("openwebui")).rejects.toThrow("Method Not Allowed");
  });

  it("throws when the plain key is missing", async () => {
    answer(201, row);
    await expect(createKey("openwebui")).rejects.toThrow();
  });
});

describe("revokeKey", () => {
  it("deletes by id", async () => {
    const fetch = answer(204);
    await revokeKey("k1" as KeyId);
    expect(fetch).toHaveBeenCalledWith("/engine/api/keys/k1", expect.objectContaining({ method: "DELETE" }));
  });

  it("counts a key that is already gone as revoked", async () => {
    answer(404, { error: "no key k1" });
    await expect(revokeKey("k1" as KeyId)).resolves.toBeUndefined();
  });

  it("says what the engine refused", async () => {
    answer(403, { error: "origin not allowed" });
    await expect(revokeKey("k1" as KeyId)).rejects.toThrow("origin not allowed");
  });
});
