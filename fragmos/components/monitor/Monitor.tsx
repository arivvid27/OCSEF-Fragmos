"use client";

import { useCallback, useMemo, useState } from "react";
import type { EventId } from "@/lib/monitor/api";
import { useSentinel } from "@/lib/monitor/store";
import { Header } from "../Header";
import { ApprovalModal } from "./ApprovalModal";
import { EventDetail } from "./EventDetail";
import { Feed } from "./Feed";
import { FlowGraph } from "./FlowGraph";
import { LinkStatus, Stats } from "./Stats";
import { Toasts } from "./Toasts";

function EngineDown() {
  return (
    <main className="grid flex-1 place-items-center px-6">
      <div className="max-w-md animate-rise text-center">
        <div className="font-serif text-[28px] font-medium tracking-tight text-ink">The engine is not running</div>
        <p className="mt-3 text-[14px] leading-relaxed text-taupe">
          Monitor shows what the Sentinel engine sees, and it cannot reach it. Start the whole product from the
          repository root, and this page connects on its own.
        </p>
        <pre className="mt-5 inline-block rounded-lg bg-panel px-4 py-2 font-mono text-[13px] text-ink">make demo</pre>
        <p className="mt-4 text-[12px] text-taupe">Retrying in the background.</p>
      </div>
    </main>
  );
}

export function Monitor() {
  const [state, dispatch] = useSentinel();
  const [selectedId, setSelectedId] = useState<EventId | null>(null);

  const events = useMemo(() => [...state.events.values()].sort((a, b) => b.created_at - a.created_at), [state.events]);
  const pending = useMemo(
    () =>
      [...state.approvals.values()]
        .filter((a) => a.status === "pending")
        .sort((a, b) => a.created_at - b.created_at)[0],
    [state.approvals],
  );
  const dismiss = useCallback((eventId: EventId) => dispatch({ type: "dismiss", eventId }), [dispatch]);
  const selected = selectedId ? (state.events.get(selectedId) ?? null) : null;

  return (
    <div className="flex h-screen flex-col">
      <Header trailing={<LinkStatus link={state.link} />} />
      {state.link === "reconnecting" ? (
        <EngineDown />
      ) : (
        <>
          <Stats stats={state.stats} upstreams={state.upstreams} />
          <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(24rem,2fr)_minmax(0,3fr)]">
            <div className="flex min-h-0 flex-col border-r border-line bg-surface">
              <Feed events={events} selectedId={selectedId} onSelect={setSelectedId} />
            </div>
            <div className="flex min-h-0 flex-col">
              <FlowGraph
                events={state.events}
                upstreams={state.upstreams}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
              <hr className="border-line" />
              <EventDetail event={selected} />
            </div>
          </main>
        </>
      )}
      {pending && (
        <ApprovalModal
          key={pending.id}
          approval={pending}
          onResolved={(approval) => dispatch({ type: "server", message: { kind: "approval", data: approval } })}
        />
      )}
      <Toasts toasts={state.toasts} onDismiss={dismiss} onOpen={setSelectedId} />
    </div>
  );
}
