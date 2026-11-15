"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ALL_POLICY_IDS, disabledCategories, type PolicyId } from "@/lib/policies";
import { PRESETS, type Preset } from "@/lib/presets";
import { providerById } from "@/lib/providers";
import { requestHeaders, useSettings } from "@/lib/settings";
import {
  leaksOriginal,
  rehydrateSegments,
  scrubText,
  withholdPartialToken,
  type ScrubOptions,
  type VaultEntry,
} from "@/lib/scrubber";
import { Editor } from "./Editor";
import { Header } from "./Header";
import { Inspector, type Phase } from "./Inspector";
import { Label } from "./Label";
import { PolicyBar } from "./PolicyBar";
import { ResponsePane } from "./ResponsePane";
import { SettingsMenu } from "./SettingsMenu";
import type { EgressEvent } from "./Telemetry";

function buildPayload(sanitizedPrompt: string) {
  return JSON.stringify({ sanitizedPrompt: sanitizedPrompt }, null, 2);
}

export function Fragmos() {
  const [input, setInput] = useState("");
  const [activePreset, setActivePreset] = useState<Preset["id"] | null>(null);
  const [activeToken, setActiveToken] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [rawResponse, setRawResponse] = useState("");
  const [responseVault, setResponseVault] = useState<VaultEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sentPayload, setSentPayload] = useState<string | null>(null);
  const [egress, setEgress] = useState<EgressEvent[]>([]);
  const controllerRef = useRef<AbortController | null>(null);

  const [policies, setPolicies] = useState<PolicyId[]>(ALL_POLICY_IDS);
  const [customTerms, setCustomTerms] = useState<string[]>([]);
  const [settings, updateSettings] = useSettings();
  const provider = providerById(settings.provider);

  const options: ScrubOptions = useMemo(() => {
    return { customTerms: customTerms, disabled: disabledCategories(policies) };
  }, [customTerms, policies]);

  const deferredInput = useDeferredValue(input);
  const scrub = useMemo(() => scrubText(deferredInput, options), [deferredInput, options]);
  const payload = buildPayload(scrub.sanitized);

  useEffect(() => {
    return () => {
      if (controllerRef.current) {
        controllerRef.current.abort();
      }
    };
  }, []);

  let visibleText = rawResponse;
  if (phase === "streaming") {
    visibleText = withholdPartialToken(rawResponse);
  }
  const segments = rehydrateSegments(visibleText, responseVault);

  const busy = phase === "sending" || phase === "streaming";

  let inspectorPhase: Phase = phase;
  if (phase !== "idle" && payload !== sentPayload) {
    inspectorPhase = "idle";
  }

  function recordTraffic(dir: "out" | "in", bytes: number) {
    const now = Date.now();
    setEgress((prev) => [...prev.filter((e) => now - e.t < 70_000), { t: now, bytes: bytes, dir: dir }]);
  }

  function handleInput(value: string) {
    setInput(value);
    setActivePreset(null);
  }

  function handlePreset(p: Preset) {
    setInput(p.text);
    setActivePreset(p.id);
  }

  function togglePolicy(id: PolicyId) {
    if (policies.indexOf(id) === -1) {
      setPolicies([...policies, id]);
    } else {
      setPolicies(policies.filter((p) => p !== id));
    }
  }

  function maskTerm(term: string) {
    const known = customTerms.some((t) => t.toLowerCase() === term.toLowerCase());
    if (!known) {
      setCustomTerms([...customTerms, term]);
    }
  }

  function unmaskTerm(term: string) {
    setCustomTerms(customTerms.filter((t) => t !== term));
  }

  async function generate() {
    if (busy || input.trim() === "") {
      return;
    }

    const fresh = scrubText(input, options);
    const body = buildPayload(fresh.sanitized);

    if (leaksOriginal(fresh.sanitized, fresh.vault)) {
      setPhase("error");
      setError("Blocked: the outbound payload still contained a sensitive value. Nothing was sent.");
      return;
    }

    if (provider && provider.id !== "gemini" && !settings.keys[provider.id]) {
      setPhase("error");
      setError("Add your " + provider.label + " API key in Settings (the gear icon) first.");
      return;
    }

    if (controllerRef.current) {
      controllerRef.current.abort();
    }
    const controller = new AbortController();
    controllerRef.current = controller;

    setError(null);
    setRawResponse("");
    setResponseVault(fresh.vault);
    setSentPayload(body);
    recordTraffic("out", new TextEncoder().encode(body).length);
    setPhase("sending");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: requestHeaders(settings),
        body: body,
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const detail = await res.json().catch(() => null);
        const message = detail && detail.error ? detail.error : "Request failed (" + res.status + ").";
        throw new Error(message);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        recordTraffic("in", value.byteLength);
        text += decoder.decode(value, { stream: true });
        setRawResponse(text);
        setPhase("streaming");
      }
      text += decoder.decode();

      if (text.trim() === "") {
        throw new Error("The model returned an empty response.");
      }
      setRawResponse(text);
      setPhase("done");
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      setPhase("error");
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Something went wrong.");
      }
    }
  }

  return (
    <>
      <Header
        egress={egress}
        scrubMs={scrub.elapsedMs}
        trailing={<SettingsMenu settings={settings} onChange={updateSettings} />}
      />
      <main className="grid min-h-[calc(100vh-3.5rem)] grid-cols-1 lg:grid-cols-[3fr_2fr]">
        <div className="min-w-0 bg-surface">
          <section className="px-8 pb-6 pt-7">
            <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <Label>Input</Label>
              <p className="text-[12.5px] text-taupe">
                Try a sample:{" "}
                {PRESETS.map((p, i) => (
                  <span key={p.id}>
                    {i > 0 && <span className="px-1.5 text-line">·</span>}
                    <button
                      type="button"
                      onClick={() => handlePreset(p)}
                      className={`underline-offset-4 transition-colors duration-200 hover:text-forest hover:underline ${
                        activePreset === p.id ? "text-ink underline" : ""
                      }`}
                    >
                      {p.label}
                    </button>
                  </span>
                ))}
              </p>
            </div>

            <Editor
              value={input}
              onChange={handleInput}
              deferredText={deferredInput}
              spans={scrub.spans}
              vault={scrub.vault}
              activeToken={activeToken}
              onActiveToken={setActiveToken}
              onMaskTerm={maskTerm}
              onSubmit={generate}
            />

            <div className="mt-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-4 border-t border-line pt-5">
              <PolicyBar
                active={policies}
                onToggle={togglePolicy}
                customTerms={customTerms}
                onRemoveTerm={unmaskTerm}
              />
              <button
                type="button"
                onClick={generate}
                disabled={busy || input.trim() === ""}
                className="flex items-center gap-2.5 rounded-lg bg-forest px-5 py-2.5 text-[13.5px] font-semibold text-white transition-[background-color,transform,opacity] duration-300 ease-ios hover:bg-forest-deep active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "Generating…" : "Generate Safely"}
                <span className="text-[12px] font-normal text-white/60">⌘↵</span>
              </button>
            </div>
          </section>

          <ResponsePane segments={segments} phase={phase} error={error} via={provider?.label} />
        </div>

        <aside
          aria-label="Wire and vault"
          className="border-t border-line bg-panel lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] lg:border-l lg:border-t-0"
        >
          <Inspector
            payload={payload}
            phase={inspectorPhase}
            via={provider?.label}
            vault={scrub.vault}
            activeToken={activeToken}
            onActiveToken={setActiveToken}
          />
        </aside>
      </main>
    </>
  );
}
