import { GoogleGenAI } from "@google/genai";
import type { ProviderId } from "../providers";

export class UpstreamError extends Error {
  status?: number;
  constructor(status?: number) {
    super("Upstream request failed");
    this.status = status;
  }
}

export interface Call {
  model: string;
  key?: string;
  system: string;
  prompt: string;
}

export function statusOf(err: unknown): number | undefined {
  if (err instanceof UpstreamError) {
    return err.status;
  }
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === "number") {
    return status;
  }
  const fromMessage = /"code":\s*(\d{3})/.exec(err instanceof Error ? err.message : "");
  return fromMessage ? Number(fromMessage[1]) : undefined;
}

export function textStream(body: ReadableStream<Uint8Array>, pick: (data: string) => string) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = body.getReader();
      let buffer = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });

          let newline = buffer.indexOf("\n");
          while (newline !== -1) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf("\n");

            if (!line.startsWith("data:")) {
              continue;
            }
            const data = line.slice(5).trim();
            if (data === "" || data === "[DONE]") {
              continue;
            }

            let text = "";
            try {
              text = pick(data);
            } catch (err) {
              if (err instanceof UpstreamError) {
                throw err;
              }
              continue;
            }
            if (text) {
              controller.enqueue(encoder.encode(text));
            }
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
    cancel() {
      return body.cancel();
    },
  });
}

export function pickClaude(data: string): string {
  const event = JSON.parse(data);
  if (event.type === "error") {
    throw new UpstreamError(event.error?.type === "overloaded_error" ? 529 : 500);
  }
  if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
    return event.delta.text || "";
  }
  return "";
}

export function pickOpenAI(data: string): string {
  const event = JSON.parse(data);
  return event.choices?.[0]?.delta?.content || "";
}

async function openGemini(call: Call) {
  const envKey = process.env.GEMINI_API_KEY;
  const useVertex = process.env.GOOGLE_GENAI_USE_VERTEXAI === "true";

  let options = {};
  if (call.key) {
    options = { apiKey: call.key };
  } else if (envKey && !useVertex) {
    options = { apiKey: envKey };
  }

  const ai = new GoogleGenAI(options);
  const upstream = await ai.models.generateContentStream({
    model: call.model,
    contents: call.prompt,
    config: { systemInstruction: call.system, temperature: 0.4 },
  });

  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of upstream) {
          if (chunk.text) {
            controller.enqueue(encoder.encode(chunk.text));
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

async function openClaude(call: Call) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": call.key || "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: call.model,
      max_tokens: 4096,
      system: call.system,
      stream: true,
      messages: [{ role: "user", content: call.prompt }],
    }),
  });
  if (!res.ok || !res.body) {
    throw new UpstreamError(res.status);
  }
  return textStream(res.body, pickClaude);
}

async function openOpenAI(call: Call) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + (call.key || ""),
    },
    body: JSON.stringify({
      model: call.model,
      stream: true,
      messages: [
        { role: "system", content: call.system },
        { role: "user", content: call.prompt },
      ],
    }),
  });
  if (!res.ok || !res.body) {
    throw new UpstreamError(res.status);
  }
  return textStream(res.body, pickOpenAI);
}

function newestFirst(ids: string[]): string[] {
  return Array.from(new Set(ids)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}

async function listGemini(key?: string): Promise<string[]> {
  const envKey = process.env.GEMINI_API_KEY;
  const useVertex = process.env.GOOGLE_GENAI_USE_VERTEXAI === "true";

  let options = {};
  if (key) {
    options = { apiKey: key };
  } else if (envKey && !useVertex) {
    options = { apiKey: envKey };
  }

  const ai = new GoogleGenAI(options);
  const pager = await ai.models.list({ config: { pageSize: 100 } });
  const ids: string[] = [];
  for await (const m of pager) {
    const id = (m.name || "").replace("models/", "");
    const canChat = (m.supportedActions || []).includes("generateContent");
    if (canChat && /^gemini-/.test(id) && !/(image|tts|live|audio|embedding|robotics|computer|banana)/.test(id)) {
      ids.push(id);
    }
  }
  return newestFirst(ids);
}

async function listClaude(key: string): Promise<string[]> {
  const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
  });
  if (!res.ok) {
    throw new UpstreamError(res.status);
  }
  const data = await res.json();
  return (data.data || []).map((m: { id: string }) => m.id);
}

async function listOpenAI(key: string): Promise<string[]> {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { authorization: "Bearer " + key },
  });
  if (!res.ok) {
    throw new UpstreamError(res.status);
  }
  const data = await res.json();
  const ids: string[] = (data.data || []).map((m: { id: string }) => m.id);
  const chatty = ids.filter(
    (id) => /^(gpt-|o\d|chatgpt)/.test(id) && !/(audio|realtime|tts|transcribe|image|embedding|moderation|search|instruct)/.test(id),
  );
  return newestFirst(chatty);
}

export function listModels(provider: ProviderId, key?: string): Promise<string[]> {
  if (provider === "claude") {
    return listClaude(key || "");
  }
  if (provider === "gpt") {
    return listOpenAI(key || "");
  }
  return listGemini(key);
}

export function openStream(provider: ProviderId, call: Call): Promise<ReadableStream<Uint8Array>> {
  if (provider === "claude") {
    return openClaude(call);
  }
  if (provider === "gpt") {
    return openOpenAI(call);
  }
  return openGemini(call);
}
