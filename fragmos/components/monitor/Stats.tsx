import { ACTIONS, type Stats as EngineStats, type Upstream } from "@/lib/monitor/api";
import { isOnDevice, upstreamTitle } from "@/lib/monitor/event";
import type { Link } from "@/lib/monitor/store";
import { ACTION_STYLE } from "@/lib/monitor/theme";
import { ActionChip } from "./ActionChip";

const LINK_LABEL: Record<Link, { text: string; dot: string }> = {
  connecting: { text: "Connecting to the engine", dot: "bg-taupe/50" },
  live: { text: "Live", dot: "bg-forest animate-pulse" },
  reconnecting: { text: "Engine offline", dot: "bg-risk-line" },
};

export function LinkStatus({ link }: { link: Link }) {
  const status = LINK_LABEL[link];
  return (
    <span className="flex items-center gap-2 text-[12px] text-taupe" role="status">
      <span className={`size-1.5 rounded-full transition-colors duration-500 ease-ios ${status.dot}`} />
      {status.text}
    </span>
  );
}

function UpstreamCard({ upstream, count }: { upstream: Upstream; count: number }) {
  const cloud = upstream.trust === "cloud";
  const note = upstream.simulated
    ? "Scripted stand-in that obeys injected text"
    : cloud
      ? "Leaves the laptop"
      : isOnDevice(upstream)
        ? "On this device"
        : "POC: a cheap cloud model fills the local slot, by config";
  return (
    <div
      className={`flex min-w-0 items-center gap-3 rounded-xl px-3.5 py-2.5 ring-1 ring-inset ${
        upstream.simulated
          ? "bg-risk/50 ring-risk-line/20"
          : cloud
            ? "bg-surface ring-line"
            : "bg-[#f1eaf2]/60 ring-[#5a3d66]/15"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className={`flex items-center gap-2 text-[11.5px] ${cloud ? "text-taupe" : ACTION_STYLE.REROUTE.text}`}>
          {upstreamTitle(upstream)}
          {upstream.simulated && (
            <span className="rounded-[3px] bg-risk px-1 py-px text-[9.5px] font-medium uppercase text-terracotta">
              simulated
            </span>
          )}
        </div>
        <div className="truncate font-mono text-[12.5px] text-ink">
          {upstream.model !== upstream.id && <span className="text-taupe">{upstream.id} · </span>}
          {upstream.model}
        </div>
        <div className="truncate text-[11.5px] text-taupe">{note}</div>
      </div>
      <div className="text-right">
        <div className="font-serif text-[22px] font-medium tabular-nums leading-none text-ink">{count}</div>
        <div className="text-[10.5px] text-taupe">requests</div>
      </div>
    </div>
  );
}

export function Stats({ stats, upstreams }: { stats: EngineStats | null; upstreams: readonly Upstream[] }) {
  const byAction = stats?.by_action ?? {};
  const total = ACTIONS.reduce((sum, a) => sum + (byAction[a] ?? 0), 0);
  const byDestination = stats?.by_destination ?? {};
  const shown = upstreams.filter((u) => !u.simulated || (byDestination[u.id] ?? 0) > 0);

  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-line px-6 py-4 lg:px-8">
      <div className="flex items-baseline gap-2.5">
        <span className="font-serif text-[34px] font-medium tabular-nums leading-none text-ink">{total}</span>
        <span className="text-[12.5px] text-taupe">requests</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ACTIONS.map((a) => (
          <ActionChip key={a} action={a} count={byAction[a] ?? 0} />
        ))}
      </div>
      <div className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-2">
        {shown.map((u) => (
          <UpstreamCard key={u.id} upstream={u} count={byDestination[u.id] ?? 0} />
        ))}
      </div>
    </div>
  );
}
