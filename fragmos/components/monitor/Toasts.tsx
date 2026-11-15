"use client";

import { useEffect } from "react";
import type { EventId } from "@/lib/monitor/api";
import type { Toast } from "@/lib/monitor/store";

const TOAST_MS = 10_000;

function BlockToast({
  toast,
  onDismiss,
  onOpen,
}: {
  toast: Toast;
  onDismiss: (id: EventId) => void;
  onOpen: (id: EventId) => void;
}) {
  const { eventId } = toast;
  useEffect(() => {
    const id = setTimeout(() => onDismiss(eventId), TOAST_MS);
    return () => clearTimeout(id);
  }, [eventId, onDismiss]);

  return (
    <div
      role="alert"
      className="pointer-events-auto flex w-[26rem] animate-pop gap-3.5 rounded-xl border border-risk-line/30 bg-surface p-4 shadow-[0_18px_50px_-12px_rgba(143,53,39,0.35)]"
    >
      <div className="grid size-8 shrink-0 place-items-center rounded-full bg-risk text-[15px] font-semibold text-terracotta">
        ✕
      </div>
      <button type="button" onClick={() => onOpen(eventId)} className="min-w-0 flex-1 text-left">
        <div className="font-serif text-[17px] font-medium text-terracotta">Blocked before it left</div>
        <p className="mt-0.5 text-[13px] leading-snug text-ink">{toast.reason}</p>
        <div className="mt-1 font-mono text-[10.5px] text-taupe">{toast.sessionId}</div>
      </button>
      <button
        type="button"
        onClick={() => onDismiss(eventId)}
        aria-label="Dismiss"
        className="self-start text-[16px] leading-none text-taupe transition-colors duration-300 ease-ios hover:text-ink"
      >
        ×
      </button>
    </div>
  );
}

/** onDismiss must be stable, or every render restarts the auto-dismiss timers. */
export function Toasts({
  toasts,
  onDismiss,
  onOpen,
}: {
  toasts: readonly Toast[];
  onDismiss: (id: EventId) => void;
  onOpen: (id: EventId) => void;
}) {
  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex flex-col gap-3">
      {toasts.map((t) => (
        <BlockToast key={t.eventId} toast={t} onDismiss={onDismiss} onOpen={onOpen} />
      ))}
    </div>
  );
}
