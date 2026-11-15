import type { ReactNode } from "react";
import { ACTIONS, type LeafDiff, type SentinelEvent, type UpstreamRef } from "@/lib/monitor/api";
import { entityMeta } from "@/lib/monitor/entities";
import {
  clock,
  entityTypes,
  headlineReason,
  leafLabel,
  PLACEHOLDER,
  placeholderPairs,
  segments,
  unchangedNote,
} from "@/lib/monitor/event";
import { ACTION_STYLE, TIER_NAME } from "@/lib/monitor/theme";
import { Label } from "../Label";
import { TokenBadge } from "../TokenBadge";
import { ActionChip, EntityPill } from "./ActionChip";
import { EgressLine } from "./Feed";

function rawMarkClass(upstream: UpstreamRef | null): string {
  return upstream?.trust === "local" ? "bg-[#f1eaf2] text-[#5a3d66]" : "bg-panel text-ink";
}

function RealText({ leaf, upstream }: { leaf: LeafDiff; upstream: UpstreamRef | null }) {
  return (
    <>
      {segments(leaf).map((s, i) =>
        s.mark ? (
          <mark
            key={i}
            title={
              s.mark.placeholder ? `${s.mark.entity_type} → ${s.mark.placeholder}` : `${s.mark.entity_type}, sent as is`
            }
            className={`rounded-[2px] box-decoration-clone px-0.5 ${
              s.mark.placeholder
                ? "bg-risk text-terracotta shadow-[inset_0_-2px_0_var(--color-risk-line)]"
                : rawMarkClass(upstream)
            }`}
          >
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

function MaskedText({ text }: { text: string }) {
  const parts = text.split(new RegExp(`(${PLACEHOLDER.source})`));
  return <>{parts.map((p, i) => (i % 2 === 1 ? <TokenBadge key={i} token={p} /> : <span key={i}>{p}</span>))}</>;
}

function Pane({ label, tone, children }: { label: string; tone: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <div className={`pb-1.5 text-[11.5px] font-medium ${tone}`}>{label}</div>
      <pre className="scroll-warm max-h-64 min-h-0 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-canvas p-3 font-mono text-[12px] leading-relaxed text-ink">
        {children}
      </pre>
    </div>
  );
}

function Leaf({ leaf, upstream }: { leaf: LeafDiff; upstream: UpstreamRef | null }) {
  const same = leaf.real === leaf.masked;
  const pairs = placeholderPairs(leaf);
  const toolCall = leaf.direction === "tool_call";
  const sentTo = upstream ? `the model (${upstream.id})` : "nobody";
  return (
    <div className="animate-fade">
      <div className="mb-2 flex items-center gap-2">
        <span title={leaf.where} className="text-[12px] font-medium text-ink">
          {leafLabel(leaf)}
        </span>
        {leaf.marks.length > 0 && <span className="ml-auto text-[11px] text-taupe">{leaf.marks.length} marked</span>}
      </div>
      {same ? (
        <>
          <Pane label={toolCall ? "Model wrote = agent runs" : `Real text = what ${sentTo} saw`} tone="text-taupe">
            <RealText leaf={leaf} upstream={upstream} />
          </Pane>
          <p
            className={`mt-2 rounded-lg px-3 py-2 text-[12.5px] ${
              !toolCall && upstream?.trust === "local" ? "bg-[#f1eaf2] text-[#5a3d66]" : "bg-panel text-taupe"
            }`}
          >
            {unchangedNote(leaf, upstream)}
          </p>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Pane label={toolCall ? "Agent runs (real values restored)" : "Before: real text"} tone="text-terracotta">
            <RealText leaf={leaf} upstream={upstream} />
          </Pane>
          <Pane label={toolCall ? "Model wrote" : `After: what ${sentTo} saw`} tone="text-forest">
            <MaskedText text={leaf.masked} />
          </Pane>
        </div>
      )}
      {pairs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
          {pairs.map((p) => (
            <span key={p.placeholder} className="inline-flex items-center gap-2 text-[12px]">
              <span className="text-terracotta">{p.real}</span>
              <span className="text-taupe/60" aria-hidden>
                →
              </span>
              <TokenBadge token={p.placeholder} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function LeafGroup({
  title,
  hint,
  leaves,
  upstream,
}: {
  title: string;
  hint: string;
  leaves: LeafDiff[];
  upstream: UpstreamRef | null;
}) {
  if (leaves.length === 0) return null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline gap-3">
        <Label>{title}</Label>
        <span className="text-[12px] text-taupe">{hint}</span>
      </div>
      {leaves.map((leaf) => (
        <Leaf key={`${leaf.direction}:${leaf.where}`} leaf={leaf} upstream={upstream} />
      ))}
    </div>
  );
}

function Explanation({ type, count }: { type: string; count?: number }) {
  const meta = entityMeta(type);
  return (
    <li className="animate-rise rounded-xl border border-line bg-surface p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-serif text-[16px] font-medium text-ink">{meta.label}</span>
        <EntityPill type={type} count={count} />
      </div>
      <p className="mb-2.5 text-[11.5px] text-taupe">{meta.regulation}</p>
      <h4 className="mb-0.5 font-serif text-[14px] font-medium text-ink">Why it is sensitive</h4>
      <p className="mb-2 text-[12.5px] leading-relaxed text-taupe">{meta.whySensitive}</p>
      <h4 className="mb-0.5 font-serif text-[14px] font-medium text-ink">Consequences of exposure</h4>
      <p className="text-[12.5px] leading-relaxed text-taupe">{meta.consequence}</p>
    </li>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-taupe">{label}</div>
      <div className="truncate font-mono text-[12px] text-ink">{children}</div>
    </div>
  );
}

export function EventDetail({ event }: { event: SentinelEvent | null }) {
  if (!event) {
    return (
      <section className="grid min-h-0 flex-1 place-items-center px-6 py-8">
        <div className="flex animate-fade flex-col items-center gap-6 text-center">
          <div>
            <div className="font-serif text-[18px] font-medium text-ink">Select a turn</div>
            <div className="text-[13px] text-taupe">to see the real text beside what the model saw.</div>
          </div>
          <ul className="flex flex-col gap-2 text-left">
            {ACTIONS.map((a) => (
              <li key={a} className="flex items-center gap-3 text-[13px] text-taupe">
                <span className="w-20">
                  <ActionChip action={a} small />
                </span>
                {ACTION_STYLE[a].meaning}
              </li>
            ))}
          </ul>
        </div>
      </section>
    );
  }
  const { request: req, upstream: up } = event;
  const reason = headlineReason(event);
  const requestLeaves = event.diff.filter((d) => d.direction === "request");
  const toolLeaves = event.diff.filter((d) => d.direction === "tool_call");
  const counts = req?.entity_counts ?? {};
  const found = entityTypes(event);
  return (
    <section
      key={event.id}
      className="scroll-warm flex min-h-0 flex-1 animate-fade flex-col gap-6 overflow-y-auto px-6 pb-8 pt-5"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <ActionChip action={event.headline} />
          <span className="font-mono text-[11.5px] text-taupe">{clock(event.created_at)}</span>
          <span className="truncate font-mono text-[11.5px] text-taupe/70">{event.session_id}</span>
          <span className="ml-auto font-mono text-[11px] text-taupe/70">stage {event.stage}</span>
        </div>
        <p className="text-[14px] leading-relaxed text-ink">{reason}</p>
        <div className="grid grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,1.7fr)_minmax(0,0.6fr)] gap-4">
          <Fact label="Request">
            {req ? (
              <span className="inline-flex items-center gap-1.5">
                <ActionChip action={req.action} small />
                {req.rule}
              </span>
            ) : (
              "pending"
            )}
          </Fact>
          <Fact label="Tier">{req ? `${req.tier} ${TIER_NAME[req.tier]}` : "…"}</Fact>
          <Fact label="Upstream">
            {up ? (
              <span className={up.trust === "cloud" ? "" : ACTION_STYLE.REROUTE.text}>
                {up.id}
                {up.model !== up.id && ` · ${up.model}`}
                {up.simulated && <span className="text-terracotta"> (simulated)</span>}
              </span>
            ) : (
              "not forwarded"
            )}
          </Fact>
          <Fact label="Latency">{event.latency_ms.total !== undefined ? `${event.latency_ms.total} ms` : "…"}</Fact>
        </div>
        {event.egress.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-lg bg-canvas p-3">
            {event.egress.map((v) => (
              <div key={v.tool_use_id} className="flex flex-col gap-0.5">
                <EgressLine verdict={v} />
                {!reason.endsWith(v.reason) && <span className="pl-8 text-[11.5px] text-taupe">{v.reason}</span>}
              </div>
            ))}
          </div>
        )}
        {event.error && (
          <p className="rounded-lg bg-risk px-3 py-2 font-mono text-[12px] text-terracotta">{event.error}</p>
        )}
      </div>

      {event.diff.length === 0 ? (
        <p className="text-[13px] text-taupe">
          Nothing sensitive in this turn&apos;s new text, and the model asked for no tool calls.
        </p>
      ) : (
        <>
          <LeafGroup title="Request" hint="New text the agent sent this turn" leaves={requestLeaves} upstream={up} />
          <LeafGroup
            title="Tool calls"
            hint="What the model asked the agent to run"
            leaves={toolLeaves}
            upstream={up}
          />
        </>
      )}

      {found.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline gap-3">
            <Label>What was found</Label>
            <span className="text-[12px] text-taupe">Why each kind of value matters</span>
          </div>
          <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {found.map((type) => (
              <Explanation key={type} type={type} count={counts[type]} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
