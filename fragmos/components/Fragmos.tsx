"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { Preset } from "@/lib/presets";
import {
  rehydrateSegments,
  scrubText,
  withholdPartialToken,
  type VaultEntry,
} from "@/lib/scrubber";
import { AuditView } from "./AuditView";
import { Header } from "./Header";
import { InputCard } from "./InputCard";
import { OutputCard } from "./OutputCard";
import { PayloadInspector, type Phase } from "./PayloadInspector";
import { VaultPanel } from "./VaultPanel";

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
  const controllerRef = useRef<AbortController | null>(null);

  const deferredInput = useDeferredValue(input);
  const scrub = useMemo(() => scrubText(deferredInput), [deferredInput]);
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

  function handleInput(value: string) {
    setInput(value);
    setActivePreset(null);
  }

  function handlePreset(p: Preset) {
    setInput(p.text);
    setActivePreset(p.id);
  }

  async function generate() {
    if (busy || input.trim() === "") {
      return;
    }

    const fresh = scrubText(input);
    const body = buildPayload(fresh.sanitized);

    for (let i = 0; i < fresh.vault.length; i++) {
      if (fresh.sanitized.includes(fresh.vault[i].original)) {
        setPhase("error");
        setError("Blocked: the outbound payload still contained a sensitive value. Nothing was sent.");
        return;
  }
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
setPhase("sending");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
  <Header />
  <main className="mx-auto grid w-full max-w-[1400px] grid-cols-1 items-start gap-6 px-5 py-8 sm:px-8 lg:grid-cols-12">
    <div className="flex flex-col gap-6 lg:col-span-7">
      <InputCard
        value={input}
        onChange={handleInput}
        activePreset={activePreset}
        onPreset={handlePreset}
        onGenerate={generate}
        busy={busy}
      >
        <AuditView
          text={deferredInput}
          spans={scrub.spans}
          vault={scrub.vault}
          activeToken={activeToken}
          onActiveToken={setActiveToken}
            />
          </InputCard>

        <OutputCard segments={segments} phase={phase} error={error} />
      </div>

      <aside
        aria-label="Live guardrail telemetry"
        className="flex min-h-0 flex-col gap-4 lg:sticky lg:top-24 lg:col-span-5 lg:max-h-[calc(100vh-7.5rem)]"
      >
        <PayloadInspector payload={payload} phase={inspectorPhase} scrubMs={scrub.elapsedMs} />
        <VaultPanel vault={scrub.vault} activeToken={activeToken} onActiveToken={setActiveToken} />
      </aside>
    </main>
    </>
  );
}
