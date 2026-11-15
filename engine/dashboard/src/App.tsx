import { useCallback, useMemo, useState } from 'react'
import type { EventId } from './api'
import { ApprovalModal } from './components/ApprovalModal'
import { EventDetail } from './components/EventDetail'
import { Feed } from './components/Feed'
import { FlowGraph } from './components/FlowGraph'
import { Header } from './components/Header'
import { Toasts } from './components/Toasts'
import { useSentinel } from './store'

export default function App() {
  const [state, dispatch] = useSentinel()
  const [selectedId, setSelectedId] = useState<EventId | null>(null)

  const events = useMemo(() => [...state.events.values()].sort((a, b) => b.created_at - a.created_at), [state.events])
  const pending = useMemo(
    () => [...state.approvals.values()].filter((a) => a.status === 'pending').sort((a, b) => a.created_at - b.created_at)[0],
    [state.approvals],
  )
  const dismiss = useCallback((eventId: EventId) => dispatch({ type: 'dismiss', eventId }), [dispatch])
  const selected = selectedId ? (state.events.get(selectedId) ?? null) : null

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      <Header stats={state.stats} upstreams={state.upstreams} link={state.link} />
      <main className="grid min-h-0 flex-1 grid-cols-[minmax(26rem,5fr)_minmax(0,7fr)] gap-4 p-4">
        <Feed events={events} selectedId={selectedId} onSelect={setSelectedId} />
        <div className="flex min-h-0 flex-col gap-4">
          <FlowGraph events={state.events} upstreams={state.upstreams} onSelect={setSelectedId} />
          <EventDetail event={selected} />
        </div>
      </main>
      {pending && (
        <ApprovalModal
          key={pending.id}
          approval={pending}
          onResolved={(approval) => dispatch({ type: 'server', message: { kind: 'approval', data: approval } })}
        />
      )}
      <Toasts toasts={state.toasts} onDismiss={dismiss} onOpen={setSelectedId} />
    </div>
  )
}
