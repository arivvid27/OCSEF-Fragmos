"use client";

import { useState } from "react";
import { countRestored, type RehydratedSegment } from "@/lib/scrubber";
import type { Phase } from "./Inspector";
import { Label } from "./Label";

interface Props {
  segments: RehydratedSegment[];
  phase: Phase;
  error: string | null;
  via?: string;
}

export function ResponsePane({ segments, phase, error, via }: Props) {
  const [copied, setCopied] = useState(false);

  if (phase === "idle") {
    return null;
  }

  const hasText = segments.length > 0;
  const restored = countRestored(segments);

  async function copy() {
    let all = "";
    for (let i = 0; i < segments.length; i++) {
      all += segments[i].text;
    }
    await navigator.clipboard.writeText(all);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <section className="animate-rise border-t border-line px-8 py-6">
      <div className="mb-4 flex items-baseline justify-between">
        <div className="flex items-baseline gap-3">
          <Label>Response</Label>
          {via && <span className="text-[12px] text-taupe">via {via}</span>}
        </div>
        <div className="flex items-baseline gap-5 text-[12px] text-taupe">
          {hasText && (
            <span className="tabular-nums">
              {restored} {restored === 1 ? "detail" : "details"} restored on this device
            </span>
          )}
          {phase === "done" && hasText && (
            <button type="button" onClick={copy} className="transition-colors duration-300 ease-ios hover:text-ink">
              {copied ? "Copied" : "Copy"}
            </button>
          )}
        </div>
      </div>

      {error ? (
        <p role="alert" className="animate-fade text-[14px] text-terracotta">
          {error}
        </p>
      ) : phase === "sending" ? (
        <div className="space-y-3 py-1" role="status" aria-label="Waiting for the model">
          {[92, 100, 76, 88].map((w, i) => (
            <div key={i} style={{ width: w + "%" }} className="h-2.5 rounded-full bg-panel" />
          ))}
        </div>
      ) : (
        <p className="whitespace-pre-wrap break-words text-[15px] leading-[1.85] text-ink">
          {segments.map((s, i) =>
            s.entry ? (
              <span key={i} title={s.entry.token} className="rounded-[2px] bg-token text-token-ink">
                {s.text}
              </span>
            ) : (
              <span key={i}>{s.text}</span>
            ),
          )}
          {phase === "streaming" && (
            <span className="ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[3px] bg-forest/60" />
          )}
        </p>
      )}
    </section>
  );
}
