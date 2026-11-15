import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { ProviderId } from "./providers";

export interface Settings {
  provider: ProviderId;
  keys: Partial<Record<ProviderId, string>>;
  models: Partial<Record<ProviderId, string>>;
}

const STORAGE_KEY = "fragmos.settings";
const CHANGE_EVENT = "fragmos-settings";
const DEFAULTS: Settings = { provider: "gemini", keys: {}, models: {} };

export function requestHeaders(settings: Settings): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-provider": settings.provider,
  };
  const key = settings.keys[settings.provider];
  if (key) {
    headers["x-user-key"] = key;
  }
  const model = settings.models[settings.provider];
  if (model) {
    headers["x-model"] = model;
  }
  return headers;
}

function readRaw(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): Settings {
  if (!raw) {
    return DEFAULTS;
  }
  try {
    const value = JSON.parse(raw);
    const provider = value.provider === "claude" || value.provider === "gpt" ? value.provider : "gemini";
    return { provider: provider, keys: value.keys || {}, models: value.models || {} };
  } catch {
    return DEFAULTS;
  }
}

function subscribe(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function useSettings(): [Settings, (change: (current: Settings) => Settings) => void] {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  const settings = useMemo(() => parse(raw), [raw]);

  const update = useCallback((change: (current: Settings) => Settings) => {
    const next = change(parse(readRaw()));
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      return;
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return [settings, update];
}
