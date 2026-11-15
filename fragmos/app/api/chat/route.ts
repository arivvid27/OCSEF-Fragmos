import { containsHighEntropySecret } from "@/lib/entropy";
import { containsStructuredPII } from "@/lib/patterns";
import { OPTIONAL_CATEGORIES } from "@/lib/policies";
import { KEY_PATTERN, MODEL_PATTERN, providerById, type ProviderId } from "@/lib/providers";
import { openStream, statusOf } from "@/lib/server/llm";

const DEFAULT_MODELS: Record<ProviderId, string[]> = {
  gemini: process.env.GEMINI_MODEL
    ? [process.env.GEMINI_MODEL]
    : ["gemini-3.6-flash", "gemini-3.1-flash-lite"],
  claude: ["claude-sonnet-5-5", "claude-haiku-5-5"],
  gpt: ["gpt-5-mini"],
};

const MAX_PROMPT_CHARS = 20_000;
const ATTEMPTS_PER_MODEL = 2;
const RETRYABLE = new Set([404, 429, 500, 503, 504, 529]);

function upstreamMessage(label: string, status: number | undefined, ownKey: boolean, providerId: ProviderId): string {
  if (providerId === "gemini" && ownKey && status === 400) {
    return "The Gemini key was rejected. Check it in Settings.";
  }
  if (status === 404) {
    return ownKey
      ? "That model isn't available for this key. Try another model in Settings."
      : "No configured " + label + " model is available. Set GEMINI_MODEL in .env.local.";
  }
  if (status === 401 || status === 403) {
    return ownKey
      ? "The " + label + " key was rejected. Check it in Settings."
      : "The server's API key was rejected. Check GEMINI_API_KEY in .env.local.";
  }
  if (status === 429) {
    return "The " + label + " rate limit or quota was hit. Try again shortly.";
  }
  if (status === 503 || status === 529) {
    return "The model is busy right now. Please try again in a moment.";
  }
  return "The " + label + " request failed.";
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

  if (containsStructuredPII(sanitizedPrompt, OPTIONAL_CATEGORIES) || containsHighEntropySecret(sanitizedPrompt)) {
    return Response.json(
      { error: "Payload rejected: it still contains an email, SSN, phone number, record ID or secret." },
      { status: 422 },
    );
  }

  const providerHeader = request.headers.get("x-provider");
  const provider = providerHeader ? providerById(providerHeader) : providerById("gemini");
  if (!provider) {
    return Response.json({ error: "Unknown provider." }, { status: 400 });
  }

  const modelHeader = (request.headers.get("x-model") || "").trim();
  if (modelHeader && !MODEL_PATTERN.test(modelHeader)) {
    return Response.json({ error: "That model name isn't valid." }, { status: 400 });
  }

  const keyHeader = (request.headers.get("x-user-key") || "").trim();
  if (keyHeader && !KEY_PATTERN.test(keyHeader)) {
    return Response.json({ error: "That API key doesn't look valid." }, { status: 400 });
  }
  const userKey = keyHeader || undefined;

  if (provider.id !== "gemini" && !userKey) {
    return Response.json(
      { error: "Add your " + provider.label + " API key in Settings (the gear icon) first." },
      { status: 400 },
    );
  }
  if (provider.id === "gemini" && !userKey) {
    const hasServerKey = Boolean(process.env.GEMINI_API_KEY) || process.env.GOOGLE_GENAI_USE_VERTEXAI === "true";
    if (!hasServerKey) {
      return Response.json(
        { error: "No Gemini key available. Add your own in Settings, or set GEMINI_API_KEY on the server." },
        { status: 503 },
      );
    }
  }

  const models = modelHeader ? [modelHeader] : DEFAULT_MODELS[provider.id];

  let upstream: ReadableStream<Uint8Array> | undefined;
  let failedWith: number | undefined;

  for (const model of models) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL && !upstream; attempt++) {
      try {
        upstream = await openStream(provider.id, {
          model: model,
          key: userKey,
          system: SYSTEM_INSTRUCTION,
          prompt: sanitizedPrompt,
        });
      } catch (err) {
        failedWith = statusOf(err);
        console.error(
          `${provider.label} request failed: status ${failedWith ?? "unknown"}, model ${model}, attempt ${attempt}`,
        );
        if (failedWith === undefined || !RETRYABLE.has(failedWith)) break;
        if (attempt < ATTEMPTS_PER_MODEL) await new Promise((resolve) => setTimeout(resolve, 600));
      }
    }
    if (upstream) break;
  }

  if (!upstream) {
    return Response.json(
      { error: upstreamMessage(provider.label, failedWith, Boolean(userKey), provider.id) },
      { status: 502 },
    );
  }

  return new Response(upstream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
