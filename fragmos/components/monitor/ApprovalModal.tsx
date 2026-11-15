"use client";

import { useEffect, useState } from "react";
import { decideApproval, type Approval, type JsonValue } from "@/lib/monitor/api";
import { EntityPill } from "./ActionChip";

const HOLD_SECONDS = 60;
const ARG_ORDER = ["to", "url", "subject", "body"];
const argRank = (key: string) => (ARG_ORDER.includes(key) ? ARG_ORDER.indexOf(key) : ARG_ORDER.length);

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function ArgValue({ value }: { value: JsonValue }) {
  return (
    <pre className="scroll-warm max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-ink">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

function Arguments({ args }: { args: JsonValue }) {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return <ArgValue value={args} />;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
      {Object.entries(args)
        .sort(([a], [b]) => argRank(a) - argRank(b))
        .map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="pt-px font-mono text-[11.5px] text-taupe">{key}</dt>
            <dd className="min-w-0">
              <ArgValue value={value} />
            </dd>
          </div>
        ))}
    </dl>
  );
}

export function ApprovalModal({ approval, onResolved }: { approval: Approval; onResolved: (a: Approval) => void }) {
  const now = useNow(200);
  const [sending, setSending] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { subject } = approval;
  const left = Math.max(0, approval.expires_at - now);
  const urgent = left < 15;

  const decide = (decision: "approve" | "deny") => {
    setSending(decision);
    setError(null);
    decideApproval(approval.id, decision)
      .then((row) => row && onResolved(row))
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setSending(null);
      });
  };

  return (
    <div className="fixed inset-0 z-40 grid animate-fade place-items-center bg-ink/25 p-6 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-title"
        className="flex max-h-full w-full max-w-2xl animate-pop flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_24px_70px_-16px_rgba(44,36,30,0.35)]"
      >
        <div className="flex items-start gap-6 px-7 pb-5 pt-6">
          <div className="flex-1">
            <div className="text-[12px] font-medium text-[#7a5a1f]">Held for your approval</div>
            <h2
              id="approval-title"
              className="mt-1 font-serif text-[24px] font-medium leading-tight tracking-tight text-ink"
            >
              {subject.kind === "tool_calls"
                ? `The agent wants to run ${subject.tool_calls.map((c) => c.tool).join(", ")}`
                : "The agent wants to send a request"}
            </h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-taupe">{subject.reason}</p>
          </div>
          <div className="text-right">
            <div
              className={`font-mono text-[30px] font-medium tabular-nums leading-none transition-colors duration-500 ease-ios ${
                urgent ? "text-terracotta" : "text-ink"
              }`}
            >
              {Math.ceil(left)}s
            </div>
            <div className="mt-1 text-[11.5px] text-taupe">then it blocks</div>
          </div>
        </div>
        <div className="h-[3px] bg-panel">
          <div
            className={`h-full transition-[width,background-color] duration-200 ease-linear ${
              urgent ? "bg-risk-line" : "bg-[#a9803a]"
            }`}
            style={{ width: `${Math.min(100, (left / HOLD_SECONDS) * 100)}%` }}
          />
        </div>

        <div className="scroll-warm flex min-h-0 flex-col gap-4 overflow-y-auto px-7 py-5">
          {subject.tool_calls.map((call) => (
            <div key={call.tool_use_id} className="flex flex-col gap-4 rounded-xl bg-canvas p-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[11.5px] text-taupe">Tool</div>
                  <div className="font-mono text-[13px] text-ink">{call.tool}</div>
                </div>
                <div>
                  <div className="text-[11.5px] text-taupe">Destination</div>
                  <div className="font-mono text-[13px] text-ink">{call.destination ?? "internal"}</div>
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-[11.5px] text-taupe">Arguments, with real values</div>
                <Arguments args={call.arguments} />
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-taupe">
            <span>Carries</span>
            {subject.entities.map((t) => (
              <EntityPill key={t} type={t} />
            ))}
            <span className="ml-auto font-mono text-[11.5px] text-taupe/70">rule {subject.rule}</span>
          </div>
          {error && (
            <p role="alert" className="rounded-lg bg-risk px-3 py-2 text-[12.5px] text-terracotta">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-line px-7 py-4">
          <button
            type="button"
            disabled={sending !== null}
            onClick={() => decide("deny")}
            className="rounded-lg px-5 py-2.5 text-[13.5px] font-semibold text-terracotta ring-1 ring-inset ring-risk-line/40 transition-[background-color,transform,opacity] duration-300 ease-ios hover:bg-risk active:scale-[0.98] disabled:opacity-40"
          >
            {sending === "deny" ? "Denying…" : "Deny"}
          </button>
          <button
            type="button"
            disabled={sending !== null}
            onClick={() => decide("approve")}
            className="rounded-lg bg-forest px-5 py-2.5 text-[13.5px] font-semibold text-white transition-[background-color,transform,opacity] duration-300 ease-ios hover:bg-forest-deep active:scale-[0.98] disabled:opacity-40"
          >
            {sending === "approve" ? "Approving…" : "Approve"}
          </button>
        </div>
      </div>
    </div>
  );
}
