import { KEY_PATTERN, providerById } from "@/lib/providers";
import { listModels, statusOf } from "@/lib/server/llm";

export async function GET(request: Request) {
  const provider = providerById(request.headers.get("x-provider") || "gemini");
  if (!provider) {
    return Response.json({ error: "Unknown provider." }, { status: 400 });
  }

  const keyHeader = (request.headers.get("x-user-key") || "").trim();
  if (keyHeader && !KEY_PATTERN.test(keyHeader)) {
    return Response.json({ error: "That API key doesn't look valid." }, { status: 400 });
  }
  const key = keyHeader || undefined;

  const fallback = { models: provider.models, source: "fallback" as const };

  if (provider.id !== "gemini" && !key) {
    return Response.json({ ...fallback, error: "Add a key to load your available models." });
  }
  if (provider.id === "gemini" && !key && !process.env.GEMINI_API_KEY) {
    return Response.json({ ...fallback, error: "Add a key to load your available models." });
  }

  try {
    const models = await listModels(provider.id, key);
    if (models.length === 0) {
      return Response.json(fallback);
    }
    return Response.json({ models: models, source: "live" as const });
  } catch (err) {
    const status = statusOf(err);
    console.error(`${provider.label} model list failed: status ${status ?? "unknown"}`);
    const rejected = status === 401 || status === 403 || (provider.id === "gemini" && status === 400);
    return Response.json({
      ...fallback,
      error: rejected ? "That key was rejected, so these are suggestions." : "Couldn't load your models, so these are suggestions.",
    });
  }
}
