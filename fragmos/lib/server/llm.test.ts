import { describe, expect, it, vi } from "vitest";
import { UpstreamError, openStream, pickClaude, pickOpenAI, statusOf, textStream } from "./llm";

function body(chunks: (string | Uint8Array)[], cancel?: () => void): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let next = 0;
  return new ReadableStream({
    pull(controller) {
      if (next === chunks.length) {
        controller.close();
        return;
      }
      const chunk = chunks[next++];
      controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
    },
    cancel: cancel,
  });
}

function delta(text: string): string {
  return "data: " + JSON.stringify({ choices: [{ delta: { content: text } }] });
}

describe("textStream", () => {
  it("emits the text of each data line and skips everything else", async () => {
    const stream = textStream(
      body([
        "event: message\n" + delta("Hello") + "\n\n",
        ": keep-alive\n\n",
        "data: {not json\n\n",
        delta(", world") + "\r\n\r\n",
        "data: [DONE]\n\n",
      ]),
      pickOpenAI,
    );
    expect(await new Response(stream).text()).toBe("Hello, world");
  });

  it("reassembles a line and a character split across chunks", async () => {
    const line = new TextEncoder().encode(delta("café [SUBJECT_1]") + "\n");
    const cut = line.indexOf(0xc3) + 1;
    const stream = textStream(body([line.slice(0, 9), line.slice(9, cut), line.slice(cut)]), pickOpenAI);
    expect(await new Response(stream).text()).toBe("café [SUBJECT_1]");
  });

  it("delivers a last line that has no trailing newline", async () => {
    const stream = textStream(body([delta("Hello") + "\n", delta(" there")]), pickOpenAI);
    expect(await new Response(stream).text()).toBe("Hello there");
  });

  it("fails the stream when the provider reports an error mid-reply", async () => {
    const stream = textStream(
      body(['data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n', 'data: {"type":"error","error":{"type":"overloaded_error"}}\n']),
      pickClaude,
    );
    await expect(new Response(stream).text()).rejects.toMatchObject({ status: 529 });
  });

  it("cancels the provider's stream when the reader goes away", async () => {
    const cancelled = vi.fn();
    const stream = textStream(body([delta("Hello") + "\n", delta(" there") + "\n", delta(" again") + "\n"], cancelled), pickOpenAI);
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
});

describe("pickClaude", () => {
  it("returns text deltas and ignores other events", () => {
    expect(pickClaude('{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}')).toBe("Hi");
    expect(pickClaude('{"type":"message_start"}')).toBe("");
    expect(pickClaude('{"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{"}}')).toBe("");
  });

  it("throws the provider's error as a status", () => {
    expect(() => pickClaude('{"type":"error","error":{"type":"overloaded_error"}}')).toThrow(
      expect.objectContaining({ status: 529 }),
    );
    expect(() => pickClaude('{"type":"error","error":{"type":"api_error"}}')).toThrow(
      expect.objectContaining({ status: 500 }),
    );
  });
});

describe("pickOpenAI", () => {
  it("returns the delta content, or nothing when there is none", () => {
    expect(pickOpenAI('{"choices":[{"delta":{"content":"Hi"}}]}')).toBe("Hi");
    expect(pickOpenAI('{"choices":[{"delta":{}}]}')).toBe("");
    expect(pickOpenAI('{"choices":[]}')).toBe("");
  });
});

describe("statusOf", () => {
  it("reads the status from each error shape the providers throw", () => {
    expect(statusOf(new UpstreamError(429))).toBe(429);
    expect(statusOf(Object.assign(new Error("x"), { status: 404 }))).toBe(404);
    expect(statusOf(new Error('got {"error":{"code": 503,"message":"busy"}}'))).toBe(503);
    expect(statusOf(new Error("socket hang up"))).toBeUndefined();
    expect(statusOf(null)).toBeUndefined();
  });
});

describe("openStream for Gemini", () => {
  async function requestedWith(key: string | undefined) {
    const fetched = vi.fn<typeof fetch>(async () => new Response('{"error":{"code":400}}', { status: 400 }));
    vi.stubGlobal("fetch", fetched);
    await openStream("gemini", { model: "gemini-test", key: key, system: "s", prompt: "p" }).catch(() => {});
    vi.unstubAllGlobals();
    const [url, init] = fetched.mock.calls[0];
    return { url: String(url), key: new Headers(init?.headers).get("x-goog-api-key") };
  }

  it("sends a user's key to the Gemini API even when the server is set up for Vertex AI", async () => {
    vi.stubEnv("GOOGLE_GENAI_USE_VERTEXAI", "true");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "server-project");
    vi.stubEnv("GOOGLE_CLOUD_LOCATION", "us-central1");
    vi.stubEnv("GEMINI_API_KEY", "");
    const sent = await requestedWith("AIzaUserKey-1234567890");
    vi.unstubAllEnvs();
    expect(sent.url).toMatch(/^https:\/\/generativelanguage\.googleapis\.com\//);
    expect(sent.key).toBe("AIzaUserKey-1234567890");
  });

  it("uses the server's key when the request brings none", async () => {
    vi.stubEnv("GOOGLE_GENAI_USE_VERTEXAI", "");
    vi.stubEnv("GEMINI_API_KEY", "server-key-for-tests");
    const sent = await requestedWith(undefined);
    vi.unstubAllEnvs();
    expect(sent.url).toMatch(/^https:\/\/generativelanguage\.googleapis\.com\/.*gemini-test/);
    expect(sent.key).toBe("server-key-for-tests");
  });
});
