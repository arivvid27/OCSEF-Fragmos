import { GoogleGenAI } from "@google/genai";
import { containsStructuredPII } from "@/lib/patterns";

const MODELS = process.env.GEMINI_MODEL
  ? [process.env.GEMINI_MODEL]
  : ["gemini-3.6-flash", "gemini-3.1-flash-lite"];
const MAX_PROMPT_CHARS = 20_000;
const ATTEMPTS_PER_MODEL = 2;
const RETRYABLE = new Set([404, 429, 500, 503, 504]);

function upstreamStatus(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === "number") return status;
  const fromMessage = /"code":\s*(\d{3})/.exec(err instanceof Error ? err.message : "");
  return fromMessage ? Number(fromMessage[1]) : undefined;
}

function upstreamMessage(status: number | undefined): string {
  if (status === 404) return "No configured Gemini model is available for this key. Set GEMINI_MODEL in .env.local.";
  if (status === 401 || status === 403) return "The API key was rejected. Check GEMINI_API_KEY in .env.local.";
  if (status === 429 || status === 503) return "The model is busy right now. Please try again in a moment.";
  return "The upstream model request failed.";
}

const SYSTEM_INSTRUCTION = `You are a professional drafting assistant for schools and clinics.

The user's text has been anonymized. Sensitive details were replaced with bracketed placeholders such as [SUBJECT_1], [INSTITUTION_1], [RECORD_ID_1], [EMAIL_1], [PHONE_1] and [SSN_1].

Rules you must follow:
1. Treat every bracketed placeholder as an immutable, atomic proper noun. Copy it character-for-character, including the square brackets and the underscore and number.
2. Never alter, split, translate, pluralize, abbreviate, or invent placeholders, and never try to guess the real value behind one.
3. A possessive is written like [SUBJECT_1]'s.
4. Write plain text only: no Markdown headings, bold, italics, tables or code fences. Simple dashes for lists are fine.
5. Complete the task the user describes, with a professional and warm tone.`;

export async function POST(request: Request) {
  let sanitizedPrompt: unknown;
  try {
    ({ sanitizedPrompt } = await request.json());
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  if (typeof sanitizedPrompt !== "string" || !sanitizedPrompt.trim()) {
    return Response.json({ error: "sanitizedPrompt is required." }, { status: 400 });
  }
  if (sanitizedPrompt.length > MAX_PROMPT_CHARS) {
    return Response.json({ error: "Prompt is too long." }, { status: 413 });
  }

  if (containsStructuredPII(sanitizedPrompt)) {
    return Response.json(
      { error: "Payload rejected: it still contains an email, SSN, phone number or record ID." },
      { status: 422 },
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const useVertex = process.env.GOOGLE_GENAI_USE_VERTEXAI === "true";
  if (!apiKey && !useVertex) {
    return Response.json(
      { error: "Server is not configured: set GEMINI_API_KEY (or Vertex AI env vars)." },
      { status: 503 },
    );
  }

  const ai = new GoogleGenAI(apiKey && !useVertex ? { apiKey } : {});

  let upstream: Awaited<ReturnType<typeof ai.models.generateContentStream>> | undefined;
  let failedWith: number | undefined;

  for (const model of MODELS) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL && !upstream; attempt++) {
      try {
        upstream = await ai.models.generateContentStream({
          model,
          contents: sanitizedPrompt,
          config: { systemInstruction: SYSTEM_INSTRUCTION, temperature: 0.4 },
        });
      } catch (err) {
        failedWith = upstreamStatus(err);
        console.error(`Gemini request failed: status ${failedWith ?? "unknown"}, model ${model}, attempt ${attempt}`);
        if (failedWith === undefined || !RETRYABLE.has(failedWith)) break;
        if (attempt < ATTEMPTS_PER_MODEL) await new Promise((resolve) => setTimeout(resolve, 600));
      }
    }
    if (upstream) break;
  }

  if (!upstream) {
    return Response.json({ error: upstreamMessage(failedWith) }, { status: 502 });
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of upstream) {
          if (chunk.text) controller.enqueue(encoder.encode(chunk.text));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
