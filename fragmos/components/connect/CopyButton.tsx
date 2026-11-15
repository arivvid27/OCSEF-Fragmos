"use client";

import { useEffect, useState } from "react";

type CopyState = "idle" | "copied" | "failed";

const LABEL: Record<CopyState, string> = { idle: "Copy", copied: "Copied", failed: "Select to copy" };

export function CopyButton({ text, what }: { text: string; what: string }) {
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 1600);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${what}`}
      className={`shrink-0 rounded-md bg-surface px-2.5 py-1 text-[12px] font-medium ring-1 ring-inset transition-[color,box-shadow,transform] duration-300 ease-ios active:scale-[0.97] ${
        state === "copied" ? "text-forest ring-forest/30" : "text-taupe ring-line hover:text-ink hover:ring-taupe/30"
      }`}
    >
      <span aria-live="polite">{LABEL[state]}</span>
    </button>
  );
}
