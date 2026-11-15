import type { EgressVerdict, EventId, SentinelEvent } from '../api'
import { clock, headlineReason } from '../event'
import { ACTION_STYLE } from '../theme'
import { ActionChip, EntityPill } from './ActionChip'

const OUTCOME_STYLE: Record<EgressVerdict['outcome'], string> = {
  forwarded: 'text-emerald-300',
  blocked: 'text-red-300',
  pending: 'text-amber-300',
}

export function EgressLine({ verdict }: { verdict: EgressVerdict }) {
  return (
    <div className="flex min-w-0 items-center gap-2 font-mono text-[11px]">
      <span className="text-slate-500">tool</span>
      <span className="text-slate-200">{verdict.tool}</span>
      {verdict.destination && (
        <>
          <span className="text-slate-600">→</span>
          <span className="truncate text-slate-300">{verdict.destination}</span>
        </>
      )}
      <ActionChip action={verdict.action} small />
      <span className={OUTCOME_STYLE[verdict.outcome]}>{verdict.outcome}</span>
    </div>
  )
}

function Row({ event, selected, onSelect }: { event: SentinelEvent; selected: boolean; onSelect: () => void }) {
  const counts = Object.entries(event.request?.entity_counts ?? {}).sort((a, b) => b[1] - a[1])
  const up = event.upstream
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`group relative flex w-full flex-col gap-1.5 overflow-hidden rounded-lg py-2.5 pl-4 pr-3 text-left ring-1 ring-inset transition ${
          selected ? 'bg-slate-800/70 ring-slate-500' : 'bg-slate-900/60 ring-slate-800 hover:bg-slate-900 hover:ring-slate-700'
        }`}
      >
        <span className={`absolute inset-y-0 left-0 w-1 ${ACTION_STYLE[event.headline].bar}`} />
        <div className="flex items-center gap-2">
          <ActionChip action={event.headline} />
          <span className="font-mono text-xs tabular-nums text-slate-400">{clock(event.created_at)}</span>
          <span className="truncate font-mono text-xs text-slate-500">{event.session_id}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-slate-400">
            {up ? (
              <>
                <span className="text-slate-600">→</span>
                <span className={up.trust === 'cloud' ? 'text-slate-200' : 'text-violet-300'}>{up.id}</span>
                {up.simulated && (
                  <span className="rounded bg-red-500/15 px-1 py-px text-[9px] font-semibold uppercase text-red-300">
                    simulated
                  </span>
                )}
              </>
            ) : (
              event.headline === 'BLOCK' && <span className="text-red-300">not forwarded</span>
            )}
          </span>
        </div>
        <p className="line-clamp-2 text-[13px] leading-snug text-slate-200">{headlineReason(event)}</p>
        {(counts.length > 0 || event.egress.length > 0) && (
          <div className="flex flex-col gap-1">
            {counts.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {counts.map(([type, n]) => (
                  <EntityPill key={type} type={type} count={n} />
                ))}
              </div>
            )}
            {event.egress.map((v) => (
              <EgressLine key={v.tool_use_id} verdict={v} />
            ))}
          </div>
        )}
      </button>
    </li>
  )
}

export function Feed({
  events,
  selectedId,
  onSelect,
}: {
  events: SentinelEvent[]
  selectedId: EventId | null
  onSelect: (id: EventId) => void
}) {
  return (
    <section className="flex min-h-0 flex-col">
      <div className="flex items-baseline justify-between px-1 pb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Event feed</h2>
        <span className="text-[11px] text-slate-500">newest first · click a row for the diff</span>
      </div>
      {events.length === 0 ? (
        <div className="grid flex-1 place-items-center rounded-lg border border-dashed border-slate-800 text-sm text-slate-500">
          Waiting for the agent's first request.
        </div>
      ) : (
        <ol className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
          {events.map((e) => (
            <Row key={e.id} event={e} selected={e.id === selectedId} onSelect={() => onSelect(e.id)} />
          ))}
        </ol>
      )}
    </section>
  )
}
