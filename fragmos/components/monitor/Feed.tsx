import type { EgressVerdict, EventId, SentinelEvent } from "@/lib/monitor/api";
import { clock, headlineReason } from "@/lib/monitor/event";
import { ACTION_STYLE } from "@/lib/monitor/theme";
import { Label } from "../Label";
import { ActionChip, EntityPill } from "./ActionChip";

const OUTCOME_STYLE: Record<EgressVerdict["outcome"], string> = {
  forwarded: "text-forest",
  blocked: "text-terracotta",
  pending: "text-hold-ink",
};

export function EgressLine({ verdict }: { verdict: EgressVerdict }) {
  return (
    <div className="flex min-w-0 items-center gap-2 font-mono text-[11px]">
      <span className="text-taupe/70">tool</span>
      <span className="text-ink">{verdict.tool}</span>
      {verdict.destination && (
        <>
          <span className="text-taupe/50">→</span>
          <span className="truncate text-taupe">{verdict.destination}</span>
        </>
      )}
      <ActionChip action={verdict.action} small />
      <span className={OUTCOME_STYLE[verdict.outcome]}>{verdict.outcome}</span>
    </div>
  );
}

function Row({ event, selected, onSelect }: { event: SentinelEvent; selected: boolean; onSelect: () => void }) {
  const counts = Object.entries(event.request?.entity_counts ?? {}).sort((a, b) => b[1] - a[1]);
  const up = event.upstream;
  return (
    <li className="animate-rise">
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`flex w-full flex-col gap-1.5 rounded-lg px-3 py-2.5 text-left transition-colors duration-300 ease-ios ${
          selected ? "bg-forest/10" : "hover:bg-panel/70"
        }`}
      >
        <div className="flex items-center gap-2">
          <ActionChip action={event.headline} />
          <span className="font-mono text-[11.5px] tabular-nums text-taupe">{clock(event.created_at)}</span>
          <span className="truncate font-mono text-[11.5px] text-taupe/70">{event.session_id}</span>
          {event.client && (
            <span className="max-w-[8rem] shrink-0 truncate rounded-[3px] bg-panel px-1 py-px text-[10.5px] text-taupe">
              {event.client}
            </span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-taupe">
            {up ? (
              <>
                <span className="text-taupe/50">→</span>
                <span className={up.trust === "cloud" ? "text-ink" : ACTION_STYLE.REROUTE.text}>{up.id}</span>
                {up.simulated && (
                  <span className="rounded-[3px] bg-risk px-1 py-px text-[9.5px] font-medium uppercase text-terracotta">
                    simulated
                  </span>
                )}
              </>
            ) : (
              event.headline === "BLOCK" && <span className="text-terracotta">not forwarded</span>
            )}
          </span>
        </div>
        <p className="line-clamp-2 text-[13px] leading-snug text-ink">{headlineReason(event)}</p>
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
  );
}

export function Feed({
  events,
  selectedId,
  onSelect,
}: {
  events: SentinelEvent[];
  selectedId: EventId | null;
  onSelect: (id: EventId) => void;
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col px-5 pb-4 pt-6">
      <div className="mb-3 flex items-baseline justify-between gap-4 px-1">
        <Label>Feed</Label>
        <span className="text-[12px] text-taupe">Newest first. Select a turn to see what left.</span>
      </div>
      {events.length === 0 ? (
        <div className="grid flex-1 place-items-center text-[13px] text-taupe">
          Waiting for the agent&apos;s first request.
        </div>
      ) : (
        <ol className="scroll-warm -mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          {events.map((e) => (
            <Row key={e.id} event={e} selected={e.id === selectedId} onSelect={() => onSelect(e.id)} />
          ))}
        </ol>
      )}
    </section>
  );
}
