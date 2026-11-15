import { useEffect, useReducer } from 'react'
import {
  fetchApprovals,
  fetchEvents,
  fetchStats,
  fetchUpstreams,
  parseServerMessage,
  socketUrl,
  type Approval,
  type ApprovalId,
  type EventId,
  type SentinelEvent,
  type ServerMessage,
  type Stats,
  type Upstream,
} from './api'
import { headlineReason } from './event'

export type Link = 'connecting' | 'live' | 'reconnecting'

export interface Toast {
  eventId: EventId
  sessionId: string
  reason: string
}

export interface State {
  events: ReadonlyMap<EventId, SentinelEvent>
  approvals: ReadonlyMap<ApprovalId, Approval>
  toasts: readonly Toast[]
  toasted: ReadonlySet<EventId> // one toast per event id, ever
  stats: Stats | null
  upstreams: readonly Upstream[]
  link: Link
}

export type Msg =
  | { type: 'history'; events: SentinelEvent[]; approvals: Approval[] }
  | { type: 'server'; message: ServerMessage }
  | { type: 'stats'; stats: Stats }
  | { type: 'upstreams'; upstreams: Upstream[] }
  | { type: 'link'; link: Link }
  | { type: 'dismiss'; eventId: EventId }

const initial: State = {
  events: new Map(),
  approvals: new Map(),
  toasts: [],
  toasted: new Set(),
  stats: null,
  upstreams: [],
  link: 'connecting',
}

/** Each event is re-sent at every stage; a stale copy (history fetched before a live update) never wins. */
function upsert<K, V extends { updated_at?: number; resolved_at?: number | null }>(
  map: ReadonlyMap<K, V>,
  key: K,
  value: V,
): Map<K, V> {
  const next = new Map(map)
  const prev = map.get(key)
  const stamp = (v: V) => v.updated_at ?? v.resolved_at ?? 0
  if (!prev || stamp(value) >= stamp(prev)) next.set(key, value)
  return next
}

function reducer(state: State, msg: Msg): State {
  switch (msg.type) {
    case 'history': {
      let events: ReadonlyMap<EventId, SentinelEvent> = state.events
      for (const e of msg.events) events = upsert(events, e.id, e)
      let approvals: ReadonlyMap<ApprovalId, Approval> = state.approvals
      for (const a of msg.approvals) approvals = upsert(approvals, a.id, a)
      const toasted = new Set(state.toasted)
      for (const e of msg.events) if (e.headline === 'BLOCK') toasted.add(e.id)
      return { ...state, events, approvals, toasted }
    }
    case 'server': {
      const { message } = msg
      if (message.kind === 'approval') {
        return { ...state, approvals: upsert(state.approvals, message.data.id, message.data) }
      }
      const e = message.data
      const events = upsert(state.events, e.id, e)
      if (e.headline !== 'BLOCK' || state.toasted.has(e.id)) return { ...state, events }
      const toast = { eventId: e.id, sessionId: e.session_id, reason: headlineReason(e) }
      return { ...state, events, toasts: [...state.toasts, toast], toasted: new Set(state.toasted).add(e.id) }
    }
    case 'stats':
      return { ...state, stats: msg.stats }
    case 'upstreams':
      return { ...state, upstreams: msg.upstreams }
    case 'link':
      return { ...state, link: msg.link }
    case 'dismiss':
      return { ...state, toasts: state.toasts.filter((t) => t.eventId !== msg.eventId) }
    default: {
      const exhaustive: never = msg
      return exhaustive
    }
  }
}

const RETRY_MAX_MS = 5000

export function useSentinel(): [State, (msg: Msg) => void] {
  const [state, dispatch] = useReducer(reducer, initial)

  useEffect(() => {
    let socket: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let statsTimer: ReturnType<typeof setTimeout> | undefined
    let attempt = 0
    let disposed = false

    // Stats are aggregated by the server; one fetch after a burst of stage updates is enough.
    const refreshStats = () => {
      clearTimeout(statsTimer)
      statsTimer = setTimeout(() => {
        fetchStats()
          .then((stats) => dispatch({ type: 'stats', stats }))
          .catch(() => {})
      }, 150)
    }

    const connect = () => {
      const ws = new WebSocket(socketUrl())
      socket = ws
      ws.onopen = () => {
        attempt = 0
        dispatch({ type: 'link', link: 'live' })
        // Loaded after the socket opens so nothing emitted in between is missed; the reducer keeps the newer copy.
        Promise.all([fetchEvents(), fetchApprovals()])
          .then(([events, approvals]) => dispatch({ type: 'history', events, approvals }))
          .catch(() => {})
        fetchUpstreams()
          .then((upstreams) => dispatch({ type: 'upstreams', upstreams }))
          .catch(() => {})
        refreshStats()
      }
      ws.onmessage = ({ data }) => {
        if (typeof data !== 'string') return
        const message = parseServerMessage(data)
        if (message) dispatch({ type: 'server', message })
        refreshStats()
      }
      ws.onclose = () => {
        if (disposed) return
        dispatch({ type: 'link', link: 'reconnecting' })
        retry = setTimeout(connect, Math.min(500 * 2 ** attempt++, RETRY_MAX_MS))
      }
    }

    connect()

    return () => {
      disposed = true
      clearTimeout(retry)
      clearTimeout(statsTimer)
      socket?.close()
    }
  }, [])

  return [state, dispatch]
}
