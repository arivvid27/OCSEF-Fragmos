"use client";

import { useState } from "react";
import type { VaultEntry } from "@/lib/scrubber";
import { splitTokens } from "@/lib/scrubber";
import { Label } from "./Label";
import { TokenBadge } from "./TokenBadge";

export type Phase = "idle" | "sending" | "streaming" | "done" | "error";

const STATUS: Record<Phase, { text: string; tone: string }> = {
  idle: { text: "Preview, not sent", tone: "text-taupe" },
  sending: { text: "Sending", tone: "text-forest" },
  streaming: { text: "Receiving", tone: "text-forest" },
  done: { text: "Delivered", tone: "text-forest" },
  error: { text: "Failed", tone: "text-terracotta" },
};

interface Props {
  payload: string;
  phase: Phase;
  via?: string;
  vault: VaultEntry[];
  activeToken: string | null;
  onActiveToken: (token: string | null) => void;
}

function readablePrompt(payload: string) {
  try {
    const parsed = JSON.parse(payload);
    return typeof parsed.sanitizedPrompt === "string" ? parsed.sanitizedPrompt : payload;
  } catch {
    return payload;
  }
}

export function Inspector({ payload, phase, via, vault, activeToken, onActiveToken }: Props) {
  const [view, setView] = useState<"raw" | "readable">("raw");
  const status = STATUS[phase];
  const bytes = new TextEncoder().encode(payload).length;
  const shown = view === "raw" ? payload : readablePrompt(payload);
  const pieces = splitTokens(shown);

  const badges = pieces.map((piece, i) =>
    piece.isToken ? <TokenBadge key={i} token={piece.text} /> : <span key={i}>{piece.text}</span>,
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <section className="px-6 pb-5 pt-6">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <Label>Wire</Label>
          <div className="flex items-baseline gap-4 text-[12px]">
            <div className="flex items-baseline gap-1 rounded-lg bg-canvas/70 p-0.5" role="group" aria-label="Wire view">
              {(["raw", "readable"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className={`rounded-md px-2.5 py-0.5 transition-colors duration-300 ease-ios ${
                    view === v ? "bg-surface text-ink shadow-sm" : "text-taupe hover:text-ink"
                  }`}
                >
                  {v === "raw" ? "Raw" : "Readable"}
                </button>
              ))}
            </div>
            <span className={`transition-colors duration-500 ease-ios ${status.tone}`}>{status.text}</span>
          </div>
        </div>
        {view === "raw" ? (
          <pre
            key="raw"
            className="scroll-warm max-h-[38vh] min-h-20 animate-fade overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-ink"
          >
            {badges}
          </pre>
        ) : (
          <div
            key="readable"
            className="scroll-warm max-h-[38vh] min-h-20 animate-fade overflow-auto whitespace-pre-wrap break-words text-[13.5px] leading-[1.75] text-ink"
          >
            {badges}
          </div>
        )}
        <p className="mt-3 text-[12px] text-taupe tabular-nums">
          {via ? "To " + via + " via /api/chat" : "To /api/chat"} · {bytes.toLocaleString()} B
        </p>
      </section>

      <hr className="border-line" />

      <section className="flex min-h-0 flex-1 flex-col px-6 pb-4 pt-5">
        <div className="mb-3 flex items-baseline justify-between">
          <Label>Vault</Label>
          <span className="text-[12px] text-taupe tabular-nums">
            {vault.length} {vault.length === 1 ? "entry" : "entries"}, memory only
          </span>
        </div>
        <ul className="scroll-warm -mx-2 min-h-0 flex-1 overflow-y-auto">
          {vault.map((e) => (
            <li
              key={e.token}
              onMouseEnter={() => onActiveToken(e.token)}
              onMouseLeave={() => onActiveToken(null)}
              className={`flex animate-rise items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] transition-colors duration-300 ease-ios ${
                activeToken === e.token ? "bg-forest/10" : ""
              }`}
            >
              <TokenBadge token={e.token} />
              <span className="text-taupe/60" aria-hidden>
                →
              </span>
              <span className="min-w-0 flex-1 break-words text-terracotta">{e.original}</span>
              <span className="shrink-0 tabular-nums text-taupe">×{e.count}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
