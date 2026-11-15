import type { Gateway } from "./api";

export const KEY_PLACEHOLDER = "YOUR_FRAGMOS_KEY";

export const CHAT_APP_URL = "http://127.0.0.1:8080";

export type SnippetId = "curl" | "openai" | "anthropic" | "openwebui";

export interface Field {
  label: string;
  value: string;
}

export type Snippet = { id: SnippetId; label: string; hint: string } & (
  | { kind: "code"; code: string }
  | { kind: "fields"; fields: Field[] }
);

/** Every snippet is ready to paste: the key on screen when there is one, a placeholder otherwise. */
export function snippets(gateway: Gateway, key: string | null): Snippet[] {
  const apiKey = key ?? KEY_PLACEHOLDER;
  const model = gateway.models[0] ?? "cloud";
  return [
    {
      id: "curl",
      label: "curl",
      hint: "One chat completion from the shell.",
      kind: "code",
      code: [
        `curl ${gateway.openai_base_url}/chat/completions \\`,
        `  -H "Authorization: Bearer ${apiKey}" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -d '{"model": "${model}", "messages": [{"role": "user", "content": "Hello"}]}'`,
      ].join("\n"),
    },
    {
      id: "openai",
      label: "Python · openai",
      hint: "Any OpenAI SDK client. Only the base URL and key change.",
      kind: "code",
      code: [
        "from openai import OpenAI",
        "",
        `client = OpenAI(base_url="${gateway.openai_base_url}", api_key="${apiKey}")`,
        "reply = client.chat.completions.create(",
        `    model="${model}",`,
        '    messages=[{"role": "user", "content": "Hello"}],',
        ")",
        "print(reply.choices[0].message.content)",
      ].join("\n"),
    },
    {
      id: "anthropic",
      label: "Python · anthropic",
      hint: "The Anthropic SDK sends the key as x-api-key.",
      kind: "code",
      code: [
        "from anthropic import Anthropic",
        "",
        `client = Anthropic(base_url="${gateway.anthropic_base_url}", api_key="${apiKey}")`,
        "reply = client.messages.create(",
        `    model="${model}",`,
        "    max_tokens=1024,",
        '    messages=[{"role": "user", "content": "Hello"}],',
        ")",
        "print(reply.content[0].text)",
      ].join("\n"),
    },
    {
      id: "openwebui",
      label: "Open WebUI",
      hint: "Admin Panel → Settings → Connections → OpenAI API. Add a connection with these two values.",
      kind: "fields",
      fields: [
        { label: "API Base URL", value: gateway.openai_base_url },
        { label: "API Key", value: apiKey },
      ],
    },
  ];
}

export function since(unixSeconds: number | null, nowSeconds: number): string {
  if (unixSeconds === null) return "never";
  const s = Math.max(0, nowSeconds - unixSeconds);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
