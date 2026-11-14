import { ACTIONS, type Stats, type Upstream } from '../api'
import { isOnDevice, upstreamTitle } from '../event'
import type { Link } from '../store'
import { ActionChip } from './ActionChip'

const LINK_LABEL: Record<Link, { text: string; dot: string }> = {
  connecting: { text: 'connecting', dot: 'bg-slate-500' },
  live: { text: 'live', dot: 'bg-emerald-400 animate-pulse' },
  reconnecting: { text: 'reconnecting', dot: 'bg-amber-400 animate-pulse' },
}

function UpstreamCard({ upstream, count }: { upstream: Upstream; count: number }) {
  const cloud = upstream.trust === 'cloud'
  const title = upstreamTitle(upstream)
  const note = upstream.simulated
    ? 'scripted stand-in that obeys injected text'
    : cloud
      ? 'leaves the laptop'
      : isOnDevice(upstream)
        ? 'on this device'
        : 'POC: a cheap cloud model fills the local slot, by config'
  return (
    <div
      className={`flex min-w-0 items-center gap-3 rounded-lg px-3 py-2 ring-1 ring-inset ${
        upstream.simulated ? 'bg-red-500/5 ring-red-400/25' : cloud ? 'bg-slate-900 ring-slate-700/70' : 'bg-violet-500/5 ring-violet-400/25'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-400">
          {title}
          {upstream.simulated && (
            <span className="rounded bg-red-500/15 px-1 py-px text-[9px] font-semibold text-red-300">simulated</span>
          )}
        </div>
        <div className="truncate font-mono text-[13px] text-slate-100">
          {upstream.model !== upstream.id && <span className="text-slate-500">{upstream.id} · </span>}
          {upstream.model}
        </div>
        <div className="truncate text-[11px] text-slate-500">{note}</div>
      </div>
      <div className="text-right">
        <div className="font-mono text-lg font-semibold tabular-nums leading-none text-slate-100">{count}</div>
        <div className="text-[9px] uppercase tracking-wider text-slate-500">req</div>
      </div>
    </div>
  )
}

export function Header({ stats, upstreams, link }: { stats: Stats | null; upstreams: readonly Upstream[]; link: Link }) {
  const byAction = stats?.by_action ?? {}
  const total = ACTIONS.reduce((sum, a) => sum + (byAction[a] ?? 0), 0)
  const byDestination = stats?.by_destination ?? {}
  const shown = upstreams.filter((u) => !u.simulated || (byDestination[u.id] ?? 0) > 0)
  const status = LINK_LABEL[link]

  return (
    <header className="flex flex-col gap-3 border-b border-slate-800 bg-slate-950/80 px-6 py-4 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-9" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-[0.2em] text-slate-50">SENTINEL</h1>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-800/80 px-2 py-0.5 text-[10px] text-slate-300">
                <span className={`size-1.5 rounded-full ${status.dot}`} />
                {status.text}
              </span>
            </div>
            <p className="text-sm text-slate-400">
              Firewalls protect networks from people. <span className="text-slate-200">Sentinel protects people from their own AI.</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="font-mono text-3xl font-semibold tabular-nums leading-none text-slate-50">{total}</div>
            <div className="text-[11px] uppercase tracking-wider text-slate-500">requests</div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ACTIONS.map((a) => (
              <ActionChip key={a} action={a} count={byAction[a] ?? 0} />
            ))}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] gap-2">
        {shown.map((u) => (
          <UpstreamCard key={u.id} upstream={u} count={byDestination[u.id] ?? 0} />
        ))}
      </div>
    </header>
  )
}
