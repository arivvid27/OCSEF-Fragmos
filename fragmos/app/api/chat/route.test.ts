import { beforeEach, describe, expect, it, vi, type MockedFunction } from "vitest";
import type * as llm from "@/lib/server/llm";
import { DISGUISED_SSNS } from "@/lib/test-fixtures";

vi.mock("@/lib/server/llm", async (importOriginal) => ({
  ...(await importOriginal<typeof llm>()),
  openStream: vi.fn(),
}));

let POST: (request: Request) => Promise<Response>;
let openStream: MockedFunction<typeof llm.openStream>;

function reply(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv("GEMINI_API_KEY", "server-key-for-tests");
  vi.stubEnv("GEMINI_MODEL", "");
  vi.stubEnv("GOOGLE_GENAI_USE_VERTEXAI", "");
  vi.spyOn(console, "error").mockImplementation(() => {});

  vi.resetModules();
  openStream = vi.mocked((await import("@/lib/server/llm")).openStream);
  openStream.mockReset().mockImplementation(async () => reply("Dear [SUBJECT_1], ok"));
  ({ POST } = await import("./route"));
});

describe("POST /api/chat", () => {
  it("streams the model's reply for a scrubbed prompt", async () => {
    const res = await post({ sanitizedPrompt: "Write to [SUBJECT_1] about [SSN_1].", policies: ["hipaa", "pci"] });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Dear [SUBJECT_1], ok");
    expect(openStream.mock.calls[0][1].prompt).toBe("Write to [SUBJECT_1] about [SSN_1].");
  });

  it("answers 422 to a residual SSN and never calls the model", async () => {
    const res = await post({ sanitizedPrompt: "Patient [SUBJECT_1], SSN 531-62-4408." });
    expect(res.status).toBe(422);
    expect(openStream).not.toHaveBeenCalled();
  });

  for (const [name, form] of Object.entries(DISGUISED_SSNS)) {
    it(`answers 422 to an SSN disguised with ${name}`, async () => {
      const res = await post({ sanitizedPrompt: `Patient [SUBJECT_1], SSN ${form}.`, policies: [] });
      expect(res.status).toBe(422);
      expect(openStream).not.toHaveBeenCalled();
    });
  }

  it("answers 422 to a residual random secret", async () => {
    const res = await post({ sanitizedPrompt: "deploy with q9Zx7Lm2Pw8Rt5Vb3Nc6Hd1Jf4 tonight" });
    expect(res.status).toBe(422);
  });

  const OPTIONAL: Record<string, string> = {
    pci: "Charge card 4111 1111 1111 1111 today.",
    hipaa: "The portal runs on 10.0.4.12 now.",
    gov: "Their EIN is 12-3456789.",
    confidential: "Summarize Project Falcon for me.",
  };
  for (const [policy, prompt] of Object.entries(OPTIONAL)) {
    it(`rechecks the ${policy} pack only while it is on`, async () => {
      expect((await post({ sanitizedPrompt: prompt, policies: [policy] })).status).toBe(422);
      expect((await post({ sanitizedPrompt: prompt })).status).toBe(422);
      expect((await post({ sanitizedPrompt: prompt, policies: [] })).status).toBe(200);
    });
  }

  it("does not mistake a placeholder for the value of an assignment", async () => {
    const res = await post({ sanitizedPrompt: "The wifi pwd: [SUBJECT_1] set it." });
    expect(res.status).toBe(200);
  });

  it("answers 400 to an unknown policy id", async () => {
    const res = await post({ sanitizedPrompt: "hello", policies: ["hipaa", "nope"] });
    expect(res.status).toBe(400);
    expect(openStream).not.toHaveBeenCalled();
  });

  it("answers 400 when policies is not a list", async () => {
    expect((await post({ sanitizedPrompt: "hello", policies: "hipaa" })).status).toBe(400);
    expect((await post({ sanitizedPrompt: "hello", policies: null })).status).toBe(400);
  });

  it("answers 400 to a body that is not JSON or has no prompt", async () => {
    expect((await post("{not json")).status).toBe(400);
    expect((await post("null")).status).toBe(400);
    expect((await post({ sanitizedPrompt: "   " })).status).toBe(400);
  });

  it("answers 413 to an oversized prompt", async () => {
    expect((await post({ sanitizedPrompt: "word ".repeat(4001) })).status).toBe(413);
  });

  it("answers 400 to an unknown provider, a bad model name or a bad key", async () => {
    expect((await post({ sanitizedPrompt: "hello" }, { "x-provider": "llama" })).status).toBe(400);
    expect((await post({ sanitizedPrompt: "hello" }, { "x-model": "bad model?" })).status).toBe(400);
    expect((await post({ sanitizedPrompt: "hello" }, { "x-user-key": "short" })).status).toBe(400);
    expect(openStream).not.toHaveBeenCalled();
  });

  it("requires a user key for Claude and GPT", async () => {
    expect((await post({ sanitizedPrompt: "hello" }, { "x-provider": "claude" })).status).toBe(400);
    const res = await post({ sanitizedPrompt: "hello" }, { "x-provider": "claude", "x-user-key": "sk-ant-user-key-1234" });
    expect(res.status).toBe(200);
    expect(openStream.mock.calls[0]).toEqual([
      "claude",
      expect.objectContaining({ key: "sk-ant-user-key-1234", model: "claude-sonnet-5-5" }),
    ]);
  });

  it("answers 503 when no Gemini key is available", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    expect((await post({ sanitizedPrompt: "hello" })).status).toBe(503);
  });

  it("retries a busy model once, then falls back to the next default model", async () => {
    vi.useFakeTimers();
    const busy = Object.assign(new Error("busy"), { status: 503 });
    openStream.mockRejectedValueOnce(busy).mockRejectedValueOnce(busy);
    const pending = post({ sanitizedPrompt: "hello" });
    await vi.advanceTimersByTimeAsync(600);
    expect((await pending).status).toBe(200);
    expect(openStream.mock.calls.map((call) => call[1].model)).toEqual([
      "gemini-3.6-flash",
      "gemini-3.6-flash",
      "gemini-3.1-flash-lite",
    ]);
    vi.useRealTimers();
  });

  it("answers 502 with the reason when the model rejects the request", async () => {
    openStream.mockRejectedValue(Object.assign(new Error("denied"), { status: 403 }));
    const res = await post({ sanitizedPrompt: "hello" });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("server's API key was rejected");
  });

  describe("shared Gemini key", () => {
    function from(ip: string, headers: Record<string, string> = {}) {
      return post({ sanitizedPrompt: "hello" }, { "x-forwarded-for": ip, ...headers });
    }

    it("answers 429 once a client passes its limit, and says when to retry", async () => {
      vi.stubEnv("SERVER_KEY_RATE_LIMIT", "3");
      for (let i = 0; i < 3; i++) {
        expect((await from("203.0.113.7")).status).toBe(200);
      }
      const res = await from("203.0.113.7");
      expect(res.status).toBe(429);
      expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(Number(res.headers.get("retry-after"))).toBeLessThanOrEqual(60);
      expect(openStream).toHaveBeenCalledTimes(3);
    });

    it("counts each client on its own", async () => {
      vi.stubEnv("SERVER_KEY_RATE_LIMIT", "1");
      expect((await from("203.0.113.7")).status).toBe(200);
      expect((await from("203.0.113.7")).status).toBe(429);
      expect((await from("203.0.113.8, 10.0.0.1")).status).toBe(200);
    });

    it("caps all clients together, whatever address they claim", async () => {
      vi.stubEnv("SERVER_KEY_RATE_LIMIT_TOTAL", "2");
      expect((await from("203.0.113.1")).status).toBe(200);
      expect((await from("203.0.113.2")).status).toBe(200);
      expect((await from("203.0.113.3")).status).toBe(429);
    });

    it("does not limit requests that bring their own key", async () => {
      vi.stubEnv("SERVER_KEY_RATE_LIMIT", "1");
      expect((await from("203.0.113.7")).status).toBe(200);
      expect((await from("203.0.113.7")).status).toBe(429);
      expect((await from("203.0.113.7", { "x-user-key": "AIzaUserKey-1234567890" })).status).toBe(200);
    });

    it("does not count requests rejected before the model is called", async () => {
      vi.stubEnv("SERVER_KEY_RATE_LIMIT", "1");
      const leaky = { sanitizedPrompt: "SSN 531-62-4408" };
      expect((await post(leaky, { "x-forwarded-for": "203.0.113.7" })).status).toBe(422);
      expect((await from("203.0.113.7")).status).toBe(200);
    });

    it("opens a new window after the old one ends", async () => {
      vi.stubEnv("SERVER_KEY_RATE_LIMIT", "1");
      vi.stubEnv("SERVER_KEY_RATE_WINDOW_SECONDS", "30");
      vi.useFakeTimers({ toFake: ["Date"] });
      expect((await from("203.0.113.7")).status).toBe(200);
      expect((await from("203.0.113.7")).status).toBe(429);
      vi.advanceTimersByTime(30_000);
      expect((await from("203.0.113.7")).status).toBe(200);
      vi.useRealTimers();
    });
  });
});
