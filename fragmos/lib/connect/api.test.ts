import { afterEach, describe, expect, it, vi } from "vitest";
import { createKey, fetchGateway, fetchKeys, revokeKey, type KeyId } from "./api";

const gateway = {
  openai_base_url: "http://127.0.0.1:8787/v1",
  anthropic_base_url: "http://127.0.0.1:8787",
  models: ["cloud", "local"],
};
const row = { id: "k1", name: "openwebui", prefix: "fm_ab12", created_at: 1700000000, last_used_at: null };

function answer(status: number, body?: unknown) {
  const fetch = vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchGateway", () => {
  it("reads the base URLs and models through the engine rewrite", async () => {
    const fetch = answer(200, gateway);
    expect(await fetchGateway()).toEqual(gateway);
    expect(fetch).toHaveBeenCalledWith("/engine/api/gateway");
  });

  it("rejects a shape the engine does not send", async () => {
    answer(200, { openai_base_url: "http://x/v1" });
    await expect(fetchGateway()).rejects.toThrow();
  });

  it("rejects when the engine is down", async () => {
    answer(502, "Bad Gateway");
    await expect(fetchGateway()).rejects.toThrow("502");
  });
});

describe("fetchKeys", () => {
  it("keeps well-formed rows and drops the rest", async () => {
    answer(200, [row, { ...row, id: "k2", last_used_at: 1700000100 }, { id: "k3" }]);
    const keys = await fetchKeys();
    expect(keys.map((k) => k.id)).toEqual(["k1", "k2"]);
    expect(keys.map((k) => k.last_used_at)).toEqual([null, 1700000100]);
  });
});

describe("createKey", () => {
  it("posts the name and returns the plain key once", async () => {
    const fetch = answer(201, { id: "k1", name: "openwebui", prefix: "fm_ab12", created_at: 1700000000, key: "fm_ab12secret" });
    const created = await createKey("openwebui");
    expect(created).toEqual({ ...row, key: "fm_ab12secret" });
    expect(fetch).toHaveBeenCalledWith("/engine/api/keys", expect.objectContaining({ method: "POST", body: '{"name":"openwebui"}' }));
  });

  it("throws on any answer but 201", async () => {
    answer(400, { detail: "name required" });
    await expect(createKey("")).rejects.toThrow("400");
  });

  it("throws when the plain key is missing", async () => {
    answer(201, row);
    await expect(createKey("openwebui")).rejects.toThrow();
  });
});

describe("revokeKey", () => {
  it("deletes by id and expects 204", async () => {
    const fetch = answer(204);
    await revokeKey("k1" as KeyId);
    expect(fetch).toHaveBeenCalledWith("/engine/api/keys/k1", { method: "DELETE" });
  });

  it("throws when the key is already gone", async () => {
    answer(404, { detail: "no such key" });
    await expect(revokeKey("k1" as KeyId)).rejects.toThrow("404");
  });
});
