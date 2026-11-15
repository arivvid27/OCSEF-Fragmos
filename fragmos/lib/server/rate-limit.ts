let windowStartedAt = 0;
let total = 0;
const perClient = new Map<string, number>();

function setting(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function clientOf(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  return forwarded.split(",")[0].trim() || "unknown";
}

export function limitServerKey(request: Request): Response | null {
  const windowMs = setting("SERVER_KEY_RATE_WINDOW_SECONDS", 60) * 1000;
  const now = Date.now();
  if (now - windowStartedAt >= windowMs) {
    windowStartedAt = now;
    total = 0;
    perClient.clear();
  }

  const client = clientOf(request);
  const used = perClient.get(client) || 0;
  if (used < setting("SERVER_KEY_RATE_LIMIT", 20) && total < setting("SERVER_KEY_RATE_LIMIT_TOTAL", 200)) {
    perClient.set(client, used + 1);
    total = total + 1;
    return null;
  }

  const retryAfter = Math.ceil((windowStartedAt + windowMs - now) / 1000);
  return Response.json(
    {
      error:
        "Too many requests on the shared Gemini key. Try again in " + retryAfter + " seconds, or add your own key in Settings.",
    },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}
