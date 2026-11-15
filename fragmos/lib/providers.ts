export type ProviderId = "gemini" | "claude" | "gpt";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  vendor: string;
  defaultModel: string;
  models: string[];
  keyUrl: string;
  keyPlaceholder: string;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "gemini",
    label: "Gemini",
    vendor: "Google",
    defaultModel: "",
    models: ["gemini-3.6-flash", "gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash"],
    keyUrl: "https://aistudio.google.com/apikey",
    keyPlaceholder: "AIza… or AQ.…",
  },
  {
    id: "claude",
    label: "Claude",
    vendor: "Anthropic",
    defaultModel: "claude-sonnet-5-5",
    models: ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5", "claude-fable-5-1"],
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyPlaceholder: "sk-ant-…",
  },
  {
    id: "gpt",
    label: "GPT",
    vendor: "OpenAI",
    defaultModel: "gpt-5-mini",
    models: ["gpt-5-mini", "gpt-5", "gpt-4.1-mini"],
    keyUrl: "https://platform.openai.com/api-keys",
    keyPlaceholder: "sk-…",
  },
];

export function providerById(id: string | null | undefined): ProviderInfo | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export const MODEL_PATTERN = /^[A-Za-z0-9._:\/-]{1,100}$/;
export const KEY_PATTERN = /^[\x21-\x7E]{8,512}$/;
