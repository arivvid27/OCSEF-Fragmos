import { ALL_POLICY_IDS, isPolicyId, type PolicyId } from "../policies";
import { KEY_PATTERN, MODEL_PATTERN, providerById, type ProviderInfo } from "../providers";

export const MAX_PROMPT_CHARS = 20_000;

export interface ChatRequest {
  prompt: string;
  policies: PolicyId[];
  provider: ProviderInfo;
  model?: string;
  userKey?: string;
}

function rejected(status: number, error: string): Response {
  return Response.json({ error: error }, { status: status });
}

export function parseCredentials(headers: Headers): { provider: ProviderInfo; userKey?: string } | Response {
  const provider = providerById(headers.get("x-provider") || "gemini");
  if (!provider) {
    return rejected(400, "Unknown provider.");
  }
  const userKey = (headers.get("x-user-key") || "").trim();
  if (userKey && !KEY_PATTERN.test(userKey)) {
    return rejected(400, "That API key doesn't look valid.");
  }
  return { provider: provider, userKey: userKey || undefined };
}

export async function parseChatRequest(request: Request): Promise<ChatRequest | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return rejected(400, "Request body must be JSON.");
  }
  const { sanitizedPrompt, policies = ALL_POLICY_IDS } = (body ?? {}) as Record<string, unknown>;

  if (typeof sanitizedPrompt !== "string" || !sanitizedPrompt.trim()) {
    return rejected(400, "sanitizedPrompt is required.");
  }
  if (sanitizedPrompt.length > MAX_PROMPT_CHARS) {
    return rejected(413, "Prompt is too long.");
  }
  if (!Array.isArray(policies) || !policies.every(isPolicyId)) {
    return rejected(400, "policies must be a list of known policy ids.");
  }

  const credentials = parseCredentials(request.headers);
  if (credentials instanceof Response) {
    return credentials;
  }

  const model = (request.headers.get("x-model") || "").trim();
  if (model && !MODEL_PATTERN.test(model)) {
    return rejected(400, "That model name isn't valid.");
  }

  return { prompt: sanitizedPrompt, policies: policies, model: model || undefined, ...credentials };
}
