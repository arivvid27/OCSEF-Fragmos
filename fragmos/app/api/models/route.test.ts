import { beforeEach, describe, expect, it, vi, type MockedFunction } from "vitest";
import type * as llm from "@/lib/server/llm";

vi.mock("@/lib/server/llm", async (importOriginal) => ({
  ...(await importOriginal<typeof llm>()),
  listModels: vi.fn(),
}));

let GET: (request: Request) => Promise<Response>;
let listModels: MockedFunction<typeof llm.listModels>;

function get(headers: Record<string, string> = {}): Promise<Response> {
  return GET(new Request("http://localhost/api/models", { headers: headers }));
}

beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv("GEMINI_API_KEY", "server-key-for-tests");
  vi.stubEnv("GOOGLE_GENAI_USE_VERTEXAI", "");
  vi.stubEnv("TRUST_FORWARDED_FOR", "");
  vi.spyOn(console, "error").mockImplementation(() => {});

  vi.resetModules();
  listModels = vi.mocked((await import("@/lib/server/llm")).listModels);
  listModels.mockReset().mockResolvedValue(["gemini-live-1"]);
  ({ GET } = await import("./route"));
});

describe("GET /api/models", () => {
  it("lists live models with the server's key", async () => {
    const res = await get();
    expect(await res.json()).toEqual({ models: ["gemini-live-1"], source: "live" });
  });

  it("falls back to suggestions without calling out when no key is available", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const gemini = await (await get()).json();
    const claude = await (await get({ "x-provider": "claude" })).json();
    expect(gemini.source).toBe("fallback");
    expect(claude.source).toBe("fallback");
    expect(claude.models).toContain("claude-sonnet-5-5");
    expect(listModels).not.toHaveBeenCalled();
  });

  it("lists live models when the server uses Vertex AI instead of an API key", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_GENAI_USE_VERTEXAI", "true");
    expect((await (await get()).json()).source).toBe("live");
  });

  it("falls back to suggestions when the provider rejects the key", async () => {
    listModels.mockRejectedValue(Object.assign(new Error("denied"), { status: 401 }));
    const body = await (await get({ "x-provider": "gpt", "x-user-key": "sk-user-key-12345678" })).json();
    expect(body.source).toBe("fallback");
    expect(body.error).toContain("rejected");
  });

  it("answers 400 to an unknown provider or a malformed key", async () => {
    expect((await get({ "x-provider": "llama" })).status).toBe(400);
    expect((await get({ "x-user-key": "short" })).status).toBe(400);
  });

  it("answers 429 once the shared-key limit is passed, whatever address is claimed, but not for a user's own key", async () => {
    vi.stubEnv("SERVER_KEY_RATE_LIMIT", "2");
    expect((await get({ "x-forwarded-for": "203.0.113.7" })).status).toBe(200);
    expect((await get({ "x-forwarded-for": "203.0.113.8" })).status).toBe(200);
    expect((await get({ "x-forwarded-for": "203.0.113.9" })).status).toBe(429);
    expect((await get({ "x-user-key": "AIzaUserKey-1234567890" })).status).toBe(200);
    expect(listModels).toHaveBeenCalledTimes(3);
  });
});
