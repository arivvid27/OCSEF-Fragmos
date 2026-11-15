import type { Action } from '../api'
import { ACTION_STYLE } from '../theme'

export function ActionChip({ action, count, small }: { action: Action; count?: number; small?: boolean }) {
  const style = ACTION_STYLE[action]
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md font-mono font-semibold tracking-wide ring-1 ring-inset ${style.chip} ${
        small ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs'
      }`}
    >
      <span className={`size-1.5 rounded-full ${style.dot}`} />
      {action}
      {count !== undefined && <span className="tabular-nums text-slate-100">{count}</span>}
    </span>
  )
}

export function EntityPill({ type, count }: { type: string; count?: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-slate-800/80 px-1.5 py-0.5 font-mono text-[10px] text-slate-300 ring-1 ring-inset ring-slate-700">
      {type}
      {count !== undefined && <span className="tabular-nums text-slate-500">×{count}</span>}
    </span>
  )
}
