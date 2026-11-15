import type { ReactNode } from 'react'
import { ACTIONS, type LeafDiff, type SentinelEvent, type UpstreamRef } from '../api'
import { clock, headlineReason, leafLabel, PLACEHOLDER, placeholderPairs, segments, unchangedNote } from '../event'
import { ACTION_STYLE, TIER_NAME } from '../theme'
import { ActionChip } from './ActionChip'
import { EgressLine } from './Feed'

function rawMarkClass(upstream: UpstreamRef | null): string {
  return upstream?.trust === 'local'
    ? 'bg-violet-500/25 text-violet-100 ring-violet-400/40'
    : 'bg-slate-600/40 text-slate-100 ring-slate-500/50'
}

function RealText({ leaf, upstream }: { leaf: LeafDiff; upstream: UpstreamRef | null }) {
  return (
    <>
      {segments(leaf).map((s, i) =>
        s.mark ? (
          <mark
            key={i}
            title={s.mark.placeholder ? `${s.mark.entity_type} → ${s.mark.placeholder}` : `${s.mark.entity_type}, sent as is`}
            className={`rounded box-decoration-clone px-0.5 ring-1 ring-inset ${
              s.mark.placeholder ? 'bg-sky-500/25 text-sky-100 ring-sky-400/40' : rawMarkClass(upstream)
            }`}
          >
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  )
}

function MaskedText({ text }: { text: string }) {
  const parts = text.split(new RegExp(`(${PLACEHOLDER.source})`))
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded box-decoration-clone bg-sky-500/25 px-0.5 font-semibold text-sky-200 ring-1 ring-inset ring-sky-400/40">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}

function Pane({ label, tone, children }: { label: string; tone: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <div className={`px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider ${tone}`}>{label}</div>
      <pre className="max-h-64 min-h-0 overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-950/70 p-3 font-mono text-xs leading-relaxed text-slate-300 ring-1 ring-inset ring-slate-800">
        {children}
      </pre>
    </div>
  )
}

function Leaf({ leaf, upstream }: { leaf: LeafDiff; upstream: UpstreamRef | null }) {
  const same = leaf.real === leaf.masked
  const pairs = placeholderPairs(leaf)
  const toolCall = leaf.direction === 'tool_call'
  const sentTo = upstream ? `the model (${upstream.id})` : 'nobody'
  return (
    <div className="rounded-lg bg-slate-900/60 p-3 ring-1 ring-inset ring-slate-800">
      <div className="mb-2 flex items-center gap-2">
        <span title={leaf.where} className="text-[11px] font-medium text-slate-300">
          {leafLabel(leaf)}
        </span>
        {leaf.marks.length > 0 && <span className="ml-auto text-[10px] text-slate-500">{leaf.marks.length} marked</span>}
      </div>
      {same ? (
        <>
          <Pane label={toolCall ? 'Model wrote = agent runs' : `Real text = what ${sentTo} saw`} tone="text-slate-400">
            <RealText leaf={leaf} upstream={upstream} />
          </Pane>
          <p
            className={`mt-2 rounded-md px-3 py-2 text-xs ${
              !toolCall && upstream?.trust === 'local' ? 'bg-violet-500/10 text-violet-200' : 'bg-slate-800/60 text-slate-300'
            }`}
          >
            {unchangedNote(leaf, upstream)}
          </p>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Pane label={toolCall ? 'Agent runs (real values restored)' : 'Real text'} tone="text-slate-400">
            <RealText leaf={leaf} upstream={upstream} />
          </Pane>
          <Pane label={toolCall ? 'Model wrote' : `What ${sentTo} saw`} tone="text-sky-300">
            <MaskedText text={leaf.masked} />
          </Pane>
        </div>
      )}
      {pairs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {pairs.map((p) => (
            <span key={p.placeholder} className="inline-flex items-center gap-1.5 rounded bg-slate-950/70 px-2 py-0.5 font-mono text-[11px] ring-1 ring-inset ring-slate-800">
              <span className="text-slate-200">{p.real}</span>
              <span className="text-slate-600">→</span>
              <span className="text-sky-300">{p.placeholder}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function LeafGroup({ title, hint, leaves, upstream }: { title: string; hint: string; leaves: LeafDiff[]; upstream: UpstreamRef | null }) {
  if (leaves.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">{title}</h3>
        <span className="text-[11px] text-slate-500">{hint}</span>
      </div>
      {leaves.map((leaf) => (
        <Leaf key={`${leaf.direction}:${leaf.where}`} leaf={leaf} upstream={upstream} />
      ))}
    </div>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="truncate font-mono text-xs text-slate-200">{children}</div>
    </div>
  )
}

export function EventDetail({ event }: { event: SentinelEvent | null }) {
  if (!event) {
    return (
      <section className="grid min-h-0 flex-1 place-items-center rounded-xl border border-dashed border-slate-800 p-6">
        <div className="flex flex-col items-center gap-5 text-center">
          <div>
            <div className="text-slate-200">Select an event</div>
            <div className="text-sm text-slate-500">to see the real text beside what the model saw.</div>
          </div>
          <ul className="flex flex-col gap-2 text-left">
            {ACTIONS.map((a) => (
              <li key={a} className="flex items-center gap-3 text-sm text-slate-400">
                <span className="w-20">
                  <ActionChip action={a} small />
                </span>
                {ACTION_STYLE[a].meaning}
              </li>
            ))}
          </ul>
        </div>
      </section>
    )
  }
  const { request: req, upstream: up } = event
  const reason = headlineReason(event)
  const requestLeaves = event.diff.filter((d) => d.direction === 'request')
  const toolLeaves = event.diff.filter((d) => d.direction === 'tool_call')
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-xl bg-slate-900/40 p-4 ring-1 ring-inset ring-slate-800">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <ActionChip action={event.headline} />
          <span className="font-mono text-xs text-slate-400">{clock(event.created_at)}</span>
          <span className="truncate font-mono text-xs text-slate-500">{event.session_id}</span>
          <span className="ml-auto font-mono text-[11px] text-slate-500">stage {event.stage}</span>
        </div>
        <p className="text-sm text-slate-100">{reason}</p>
        <div className="grid grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,1.7fr)_minmax(0,0.6fr)] gap-3">
          <Fact label="request">
            {req ? (
              <span className="inline-flex items-center gap-1.5">
                <ActionChip action={req.action} small />
                {req.rule}
              </span>
            ) : (
              'pending'
            )}
          </Fact>
          <Fact label="tier">{req ? `${req.tier} ${TIER_NAME[req.tier]}` : '…'}</Fact>
          <Fact label="upstream">
            {up ? (
              <span className={up.trust === 'cloud' ? '' : 'text-violet-300'}>
                {up.id}
                {up.model !== up.id && ` · ${up.model}`}
                {up.simulated && <span className="text-red-300"> (simulated)</span>}
              </span>
            ) : (
              'not forwarded'
            )}
          </Fact>
          <Fact label="latency">{event.latency_ms.total !== undefined ? `${event.latency_ms.total} ms` : '…'}</Fact>
        </div>
        {event.egress.length > 0 && (
          <div className="flex flex-col gap-1 rounded-lg bg-slate-950/50 p-2.5 ring-1 ring-inset ring-slate-800">
            {event.egress.map((v) => (
              <div key={v.tool_use_id} className="flex flex-col gap-0.5">
                <EgressLine verdict={v} />
                {!reason.endsWith(v.reason) && <span className="pl-8 text-[11px] text-slate-400">{v.reason}</span>}
              </div>
            ))}
          </div>
        )}
        {event.error && <p className="rounded-md bg-red-500/10 px-3 py-2 font-mono text-xs text-red-200">{event.error}</p>}
      </div>

      {event.diff.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing sensitive in this turn's new text, and the model asked for no tool calls.</p>
      ) : (
        <>
          <LeafGroup title="Request" hint="new text the agent sent this turn" leaves={requestLeaves} upstream={up} />
          <LeafGroup title="Tool calls" hint="what the model asked the agent to run" leaves={toolLeaves} upstream={up} />
        </>
      )}
    </section>
  )
}
