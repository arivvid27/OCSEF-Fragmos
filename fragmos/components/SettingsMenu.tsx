"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { PROVIDERS, providerById, type ProviderId } from "@/lib/providers";
import { requestHeaders, type Settings } from "@/lib/settings";
import { ModelPicker } from "./ModelPicker";
import { GearIcon, ProviderIcon } from "./ProviderIcons";

interface Props {
  settings: Settings;
  onChange: (change: (current: Settings) => Settings) => void;
}

type Check = { state: "idle" } | { state: "checking" } | { state: "ok" } | { state: "error"; message: string };

interface ModelList {
  for: string;
  models: string[];
  source: "live" | "fallback";
  error?: string;
}

function Section({
  open,
  step,
  raised = false,
  children,
}: {
  open: boolean;
  step: number;
  raised?: boolean;
  children: ReactNode;
}) {
  const style: CSSProperties = {
    transitionProperty: "opacity, transform",
    transitionDuration: open ? "500ms, 500ms" : "250ms, 0ms",
    transitionDelay: open ? 70 + step * 55 + "ms, " + (70 + step * 55) + "ms" : "0ms, 250ms",
  };
  return (
    <div
      style={style}
      className={`ease-ios ${raised ? "relative z-10" : ""} ${
        open ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      }`}
    >
      {children}
    </div>
  );
}

export function SettingsMenu({ settings, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [replay, setReplay] = useState(0);
  const [showKey, setShowKey] = useState(false);
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const wrapRef = useRef<HTMLDivElement>(null);

  const provider = providerById(settings.provider) || PROVIDERS[0];
  const index = PROVIDERS.findIndex((p) => p.id === provider.id);
  const key = settings.keys[provider.id] || "";
  const model = settings.models[provider.id] || "";

  const [modelList, setModelList] = useState<ModelList | null>(null);
  const providerId = provider.id;
  const wanted = providerId + ":" + key;

  useEffect(() => {
    if (!open) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(
      async () => {
        const headers: Record<string, string> = { "x-provider": providerId };
        if (key) {
          headers["x-user-key"] = key;
        }
        try {
          const res = await fetch("/api/models", { headers: headers, signal: controller.signal });
          const data = await res.json();
          setModelList({ for: wanted, models: data.models || [], source: data.source || "fallback", error: data.error });
        } catch {
          if (!controller.signal.aborted) {
            setModelList({ for: wanted, models: [], source: "fallback" });
          }
        }
      },
      key ? 450 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, providerId, key, wanted]);

  const listReady = modelList !== null && modelList.for === wanted;
  const baseOptions = listReady && modelList.models.length > 0 ? modelList.models : provider.models;
  const options = model && !baseOptions.includes(model) ? [model, ...baseOptions] : baseOptions;
  const defaultLabel = provider.defaultModel ? "Default (" + provider.defaultModel + ")" : "Automatic";

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function toggle() {
    if (!open) {
      setReplay((n) => n + 1);
    }
    setOpen(!open);
  }

  function pickProvider(id: ProviderId) {
    setCheck({ state: "idle" });
    onChange((s) => ({ ...s, provider: id }));
    setReplay((n) => n + 1);
  }

  function setKey(value: string) {
    setCheck({ state: "idle" });
    onChange((s) => ({ ...s, keys: { ...s.keys, [provider.id]: value.trim() } }));
  }

  function setModel(value: string) {
    setCheck({ state: "idle" });
    onChange((s) => ({ ...s, models: { ...s.models, [provider.id]: value.trim() } }));
  }

  async function verify() {
    setCheck({ state: "checking" });
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: requestHeaders(settings),
        body: JSON.stringify({ sanitizedPrompt: "Reply with the single word: ok" }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        setCheck({ state: "error", message: detail?.error || "The request failed." });
        return;
      }
      await res.text();
      setCheck({ state: "ok" });
    } catch {
      setCheck({ state: "error", message: "Couldn't reach the server." });
    }
  }

  const canVerify = provider.id === "gemini" ? true : key.length > 0;

  return (
    <div
      ref={wrapRef}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-label="Settings"
        aria-expanded={open}
        onClick={toggle}
        className={`group flex h-9 w-9 items-center justify-center rounded-lg transition-colors duration-300 ease-ios ${
          open ? "bg-panel text-ink" : "text-taupe hover:bg-panel/70 hover:text-ink"
        }`}
      >
        <span
          className={`transition-transform duration-700 ease-ios ${open ? "rotate-90" : "group-hover:rotate-45"}`}
        >
          <GearIcon />
        </span>
      </button>

      <div
        inert={!open}
        aria-hidden={!open}
        style={{
          transformOrigin: "top right",
          transitionProperty: "opacity, transform",
          transitionDuration: open ? "420ms, 420ms" : "250ms, 0ms",
          transitionDelay: open ? "0ms, 0ms" : "0ms, 250ms",
        }}
        className={`absolute right-0 top-full z-50 pt-3 ease-ios ${
          open ? "translate-y-0 scale-100 opacity-100" : "pointer-events-none -translate-y-2 scale-[0.96] opacity-0"
        }`}
      >
        <div className="w-[min(392px,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-5 shadow-[0_24px_60px_-20px_rgba(44,36,30,0.3)]">
          <Section open={open} step={0}>
            <h2 className="font-serif text-[18px] font-medium tracking-tight text-ink">Model</h2>
            <p className="mt-0.5 text-[12.5px] text-taupe">Choose where your scrubbed text goes.</p>
          </Section>

          <Section open={open} step={1}>
            <div className="relative mt-4 grid grid-cols-3 rounded-xl bg-canvas p-1" role="radiogroup" aria-label="Provider">
              <span
                aria-hidden
                className="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-[10px] bg-surface shadow-[0_1px_3px_rgba(44,36,30,0.14)] transition-transform duration-500 ease-ios"
                style={{ transform: "translateX(" + index * 100 + "%)" }}
              />
              {PROVIDERS.map((p) => {
                const selected = p.id === provider.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => pickProvider(p.id)}
                    className="group relative z-10 flex flex-col items-center gap-1.5 rounded-[10px] py-3 outline-none focus-visible:ring-2 focus-visible:ring-forest/30"
                  >
                    <ProviderIcon id={p.id} selected={selected} replay={replay} />
                    <span
                      className={`text-[12.5px] transition-colors duration-300 ease-ios ${
                        selected ? "font-medium text-ink" : "text-taupe"
                      }`}
                    >
                      {p.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </Section>

          <Section open={open} step={2} raised>
            <div key={provider.id} className="mt-5 animate-rise">
              <div className="mb-1.5 flex items-baseline justify-between">
                <span id="model-label" className="text-[12.5px] text-taupe">
                  Model
                </span>
                <span className="text-[11.5px] text-taupe/80">{provider.vendor}</span>
              </div>
              <ModelPicker
                labelId="model-label"
                value={model}
                options={options}
                defaultLabel={defaultLabel}
                loading={!listReady}
                onSelect={setModel}
              />
              {listReady && modelList.error && (
                <p className="mt-1.5 animate-fade text-[11.5px] text-taupe">{modelList.error}</p>
              )}

              <div className="mb-1.5 mt-4 flex items-baseline justify-between">
                <label htmlFor="key-input" className="text-[12.5px] text-taupe">
                  API key
                </label>
                <a
                  href={provider.keyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11.5px] text-taupe underline-offset-4 transition-colors duration-300 hover:text-forest hover:underline"
                >
                  Get a key
                </a>
              </div>
              <div className="relative">
                <input
                  id="key-input"
                  type={showKey ? "text" : "password"}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={provider.id === "gemini" ? "Optional, built-in key by default" : provider.keyPlaceholder}
                  spellCheck={false}
                  autoComplete="off"
                  className="w-full rounded-lg border border-line bg-canvas py-2 pl-3 pr-14 text-[13.5px] text-ink outline-none transition-[border-color,box-shadow] duration-300 ease-ios placeholder:text-taupe/60 focus:border-forest/50 focus:shadow-[0_0_0_3px_rgba(45,90,39,0.1)]"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-1.5 py-0.5 text-[11.5px] text-taupe transition-colors duration-300 hover:text-ink"
                >
                  {showKey ? "Hide" : "Show"}
                </button>
              </div>
            </div>
          </Section>

          <Section open={open} step={3}>
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="min-h-[1.25rem] text-[12px] leading-snug">
                {check.state === "ok" && <span className="animate-fade text-forest">Connected. This key works.</span>}
                {check.state === "error" && <span className="animate-fade text-terracotta">{check.message}</span>}
                {check.state === "checking" && <span className="text-taupe">Checking…</span>}
                {check.state === "idle" && (
                  <span className="text-taupe">
                    {key ? "Kept in this tab only." : provider.id === "gemini" ? "Using the built-in key." : "A key is required."}
                  </span>
                )}
              </p>
              <div className="flex shrink-0 items-center gap-3">
                {key && (
                  <button
                    type="button"
                    onClick={() => setKey("")}
                    className="text-[12px] text-taupe transition-colors duration-300 hover:text-terracotta"
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  onClick={verify}
                  disabled={!canVerify || check.state === "checking"}
                  className="rounded-lg bg-forest px-3.5 py-1.5 text-[12.5px] font-medium text-white transition-[background-color,opacity,transform] duration-300 ease-ios hover:bg-forest-deep active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Verify
                </button>
              </div>
            </div>
          </Section>

          <Section open={open} step={4}>
            <p className="mt-4 border-t border-line pt-3 text-[11.5px] leading-relaxed text-taupe">
              Your key stays in this tab and travels only as a request header. It never appears in the Wire payload.
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}
