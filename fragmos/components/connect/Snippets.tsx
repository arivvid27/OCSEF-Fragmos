"use client";

import { useState } from "react";
import type { Gateway } from "@/lib/connect/api";
import { CHAT_APP_URL, KEY_PLACEHOLDER, snippets, type SnippetId } from "@/lib/connect/view";
import { Label } from "../Label";
import { CopyButton } from "./CopyButton";

function WithKey({ text, apiKey }: { text: string; apiKey: string }) {
  const tone = apiKey === KEY_PLACEHOLDER ? "bg-hold text-hold-ink" : "bg-token text-token-ink";
  const parts = text.split(apiKey);
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && <mark className={`rounded-[2px] px-0.5 ${tone}`}>{apiKey}</mark>}
          {part}
        </span>
      ))}
    </>
  );
}

export function Snippets({ gateway, apiKey }: { gateway: Gateway; apiKey: string | null }) {
  const [tab, setTab] = useState<SnippetId>("curl");
  const all = snippets(gateway, apiKey);
  const shown = all.find((s) => s.id === tab) ?? all[0];
  const key = apiKey ?? KEY_PLACEHOLDER;

  return (
    <section className="animate-rise rounded-2xl border border-line bg-surface p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Label>Paste into your client</Label>
        <span className="text-[12px] text-taupe">
          {apiKey ? "Filled in with the key you just created." : `Create a key above, or swap in your own for ${KEY_PLACEHOLDER}.`}
        </span>
      </div>

      <div role="tablist" aria-label="Client" className="mb-4 flex flex-wrap gap-1 rounded-lg bg-panel/70 p-0.5 text-[12.5px]">
        {all.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            id={`tab-${s.id}`}
            aria-selected={s.id === shown.id}
            aria-controls="snippet-panel"
            onClick={() => setTab(s.id)}
            className={`rounded-md px-3 py-1 transition-colors duration-300 ease-ios ${
              s.id === shown.id ? "bg-surface text-ink shadow-sm" : "text-taupe hover:text-ink"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div id="snippet-panel" role="tabpanel" aria-labelledby={`tab-${shown.id}`} key={shown.id} className="animate-fade">
        <p className="mb-3 text-[12.5px] text-taupe">{shown.hint}</p>
        {shown.kind === "code" ? (
          <div className="relative">
            <pre className="scroll-warm overflow-x-auto rounded-xl bg-canvas p-4 pr-20 font-mono text-[12.5px] leading-relaxed text-ink">
              <WithKey text={shown.code} apiKey={key} />
            </pre>
            <div className="absolute right-3 top-3">
              <CopyButton text={shown.code} what={`${shown.label} snippet`} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {shown.fields.map((f) => (
              <div key={f.label} className="flex items-center gap-4 rounded-xl bg-canvas px-4 py-3">
                <span className="w-28 shrink-0 text-[12px] text-taupe">{f.label}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">
                  <WithKey text={f.value} apiKey={key} />
                </span>
                <CopyButton text={f.value} what={f.label} />
              </div>
            ))}
            <a
              href={CHAT_APP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-2 self-start rounded-lg bg-forest px-4 py-2 text-[13px] font-semibold text-white transition-[background-color,transform] duration-300 ease-ios hover:bg-forest-deep active:scale-[0.98]"
            >
              Open the chat app
              <span className="font-mono text-[11.5px] font-normal text-white/70">{CHAT_APP_URL.replace("http://", "")}</span>
            </a>
          </div>
        )}
      </div>
    </section>
  );
}
