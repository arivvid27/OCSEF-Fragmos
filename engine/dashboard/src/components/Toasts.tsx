import { useEffect } from 'react'
import type { EventId } from '../api'
import type { Toast } from '../store'

const TOAST_MS = 10_000

function BlockToast({
  toast,
  onDismiss,
  onOpen,
}: {
  toast: Toast
  onDismiss: (id: EventId) => void
  onOpen: (id: EventId) => void
}) {
  const { eventId } = toast
  useEffect(() => {
    const id = setTimeout(() => onDismiss(eventId), TOAST_MS)
    return () => clearTimeout(id)
  }, [eventId, onDismiss])

  return (
    <div
      role="alert"
      className="pointer-events-auto flex w-[26rem] gap-3 rounded-xl bg-red-950/95 p-4 shadow-2xl shadow-red-900/40 ring-1 ring-red-500/60 backdrop-blur"
    >
      <div className="grid size-8 shrink-0 place-items-center rounded-full bg-red-500 font-bold text-red-950">✕</div>
      <button type="button" onClick={() => onOpen(eventId)} className="min-w-0 flex-1 text-left">
        <div className="text-sm font-semibold text-red-100">SENTINEL blocked it</div>
        <p className="mt-0.5 text-[13px] leading-snug text-red-200">{toast.reason}</p>
        <div className="mt-1 font-mono text-[10px] text-red-300/70">{toast.sessionId}</div>
      </button>
      <button type="button" onClick={() => onDismiss(eventId)} aria-label="Dismiss" className="self-start text-red-300/70 hover:text-red-100">
        ×
      </button>
    </div>
  )
}

/** onDismiss must be stable, or every render restarts the auto-dismiss timers. */
export function Toasts({
  toasts,
  onDismiss,
  onOpen,
}: {
  toasts: readonly Toast[]
  onDismiss: (id: EventId) => void
  onOpen: (id: EventId) => void
}) {
  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex flex-col gap-3">
      {toasts.map((t) => (
        <BlockToast key={t.eventId} toast={t} onDismiss={onDismiss} onOpen={onOpen} />
      ))}
    </div>
  )
}
