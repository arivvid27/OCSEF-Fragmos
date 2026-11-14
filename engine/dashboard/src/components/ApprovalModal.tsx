import { useEffect, useState } from 'react'
import { decideApproval, type Approval, type JsonValue } from '../api'
import { EntityPill } from './ActionChip'

const HOLD_SECONDS = 60
const ARG_ORDER = ['to', 'url', 'subject', 'body']
const argRank = (key: string) => (ARG_ORDER.includes(key) ? ARG_ORDER.indexOf(key) : ARG_ORDER.length)

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

function ArgValue({ value }: { value: JsonValue }) {
  return (
    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-slate-100">
      {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
    </pre>
  )
}

function Arguments({ args }: { args: JsonValue }) {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return <ArgValue value={args} />
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
      {Object.entries(args)
        .sort(([a], [b]) => argRank(a) - argRank(b))
        .map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="pt-px font-mono text-[11px] text-slate-500">{key}</dt>
            <dd className="min-w-0">
              <ArgValue value={value} />
            </dd>
          </div>
        ))}
    </dl>
  )
}

export function ApprovalModal({ approval, onResolved }: { approval: Approval; onResolved: (a: Approval) => void }) {
  const now = useNow(200)
  const [sending, setSending] = useState<'approve' | 'deny' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { subject } = approval
  const left = Math.max(0, approval.expires_at - now)
  const urgent = left < 15

  const decide = (decision: 'approve' | 'deny') => {
    setSending(decision)
    setError(null)
    decideApproval(approval.id, decision)
      .then((row) => row && onResolved(row))
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e))
        setSending(null)
      })
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-slate-950/70 p-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-title"
        className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-slate-900 shadow-2xl shadow-amber-500/10 ring-1 ring-amber-400/40"
      >
        <div className="flex items-start gap-4 border-b border-slate-800 bg-amber-500/10 px-6 py-4">
          <div className="flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">HOLD · approval needed</div>
            <h2 id="approval-title" className="mt-1 text-lg font-semibold text-slate-50">
              {subject.kind === 'tool_calls'
                ? `The agent wants to run ${subject.tool_calls.map((c) => c.tool).join(', ')}`
                : 'The agent wants to send a request'}
            </h2>
            <p className="mt-1 text-sm text-slate-300">{subject.reason}</p>
          </div>
          <div className="text-right">
            <div className={`font-mono text-3xl font-semibold tabular-nums ${urgent ? 'text-red-300' : 'text-amber-200'}`}>
              {Math.ceil(left)}s
            </div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400">then it blocks</div>
          </div>
        </div>
        <div className="h-1 bg-slate-800">
          <div
            className={`h-full transition-[width] duration-200 ease-linear ${urgent ? 'bg-red-500' : 'bg-amber-400'}`}
            style={{ width: `${Math.min(100, (left / HOLD_SECONDS) * 100)}%` }}
          />
        </div>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 py-4">
          {subject.tool_calls.map((call) => (
            <div key={call.tool_use_id} className="flex flex-col gap-3 rounded-xl bg-slate-950/60 p-4 ring-1 ring-inset ring-slate-800">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">tool</div>
                  <div className="font-mono text-sm text-slate-100">{call.tool}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">destination</div>
                  <div className="font-mono text-sm text-slate-100">{call.destination ?? 'internal'}</div>
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-500">arguments, real values</div>
                <Arguments args={call.arguments} />
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span>carries</span>
            {subject.entities.map((t) => (
              <EntityPill key={t} type={t} />
            ))}
            <span className="ml-auto font-mono text-[11px] text-slate-500">rule {subject.rule}</span>
          </div>
          {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</p>}
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-800 px-6 py-4">
          <button
            type="button"
            disabled={sending !== null}
            onClick={() => decide('deny')}
            className="rounded-lg bg-red-500/15 px-5 py-2 text-sm font-semibold text-red-200 ring-1 ring-inset ring-red-400/40 transition hover:bg-red-500/25 disabled:opacity-50"
          >
            {sending === 'deny' ? 'Denying…' : 'Deny'}
          </button>
          <button
            type="button"
            disabled={sending !== null}
            onClick={() => decide('approve')}
            className="rounded-lg bg-emerald-500 px-5 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-50"
          >
            {sending === 'approve' ? 'Approving…' : 'Approve'}
          </button>
        </div>
      </div>
    </div>
  )
}
