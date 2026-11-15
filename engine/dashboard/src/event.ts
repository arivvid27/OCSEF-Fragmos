import type { ApprovalStatus, LeafDiff, Mark, SentinelEvent, Upstream, UpstreamRef } from './api'

const APPROVAL_NOTE: Record<ApprovalStatus, string | null> = {
  pending: null,
  approved: null,
  denied: 'Denied by the reviewer',
  expired: 'No answer within 60 s',
}

export function headlineReason(e: SentinelEvent): string {
  const verdict =
    e.egress.find((v) => v.action === e.headline) ??
    (e.headline === 'BLOCK' ? e.egress.find((v) => v.outcome === 'blocked') : undefined)
  const reason = verdict?.reason ?? e.request?.reason ?? e.error ?? `stage ${e.stage}`
  const note = e.headline === 'BLOCK' && e.approval ? APPROVAL_NOTE[e.approval.status] : null
  return note ? `${note}. ${reason}` : reason
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1'])

/** "local" is a destination class, not a place: the POC's local slot is a cloud model unless its host is loopback. */
export function isOnDevice(u: Upstream): boolean {
  return LOOPBACK.has(u.host)
}

export function upstreamTitle(u: Pick<Upstream, 'trust' | 'simulated'>): string {
  return u.simulated ? 'Simulated attacker' : u.trust === 'cloud' ? 'Cloud model' : 'Local model'
}

export interface Segment {
  text: string
  mark: Mark | null
}

/** Splits real text at the marks. Marks never overlap by construction; a stray overlap is dropped, not merged. */
export function segments(leaf: LeafDiff): Segment[] {
  const out: Segment[] = []
  let at = 0
  for (const mark of [...leaf.marks].sort((a, b) => a.start - b.start)) {
    if (mark.start < at) continue
    if (mark.start > at) out.push({ text: leaf.real.slice(at, mark.start), mark: null })
    out.push({ text: leaf.real.slice(mark.start, mark.end), mark })
    at = mark.end
  }
  if (at < leaf.real.length) out.push({ text: leaf.real.slice(at), mark: null })
  return out
}

export const PLACEHOLDER = /\[[A-Z_]+_\d+\]/g

export function placeholderPairs(leaf: LeafDiff): { real: string; placeholder: string }[] {
  const seen = new Map<string, string>()
  for (const s of segments(leaf)) {
    if (s.mark?.placeholder && !seen.has(s.mark.placeholder)) seen.set(s.mark.placeholder, s.text)
  }
  return [...seen].map(([placeholder, real]) => ({ real, placeholder }))
}

export function unchangedNote(leaf: LeafDiff, upstream: UpstreamRef | null): string {
  if (leaf.direction === 'tool_call') return 'The model wrote real values here, so there was nothing to restore.'
  if (upstream === null) return 'Blocked before forwarding. This text never left SENTINEL.'
  if (upstream.trust === 'local') {
    const who = upstream.simulated
      ? `${upstream.id} (a simulated local-class model)`
      : `the local model (${upstream.model})`
    const kept = upstream.already_local ? ' The agent asked for a local-class model, so REROUTE kept it there.' : ''
    return `Raw text went to ${who}, not the cloud.${kept}`
  }
  return leaf.marks.length
    ? 'Sent to the cloud as written. The marked values are low tier, so policy let them through.'
    : 'Sent to the cloud as written. Nothing sensitive found.'
}

const TOOL_RESULT = /^messages\[(\d+)\]\.content\[\d+\]\.content\[\d+\]$/
const MESSAGE = /^messages\[(\d+)\]\.content\[\d+\]$/

export function leafLabel(leaf: LeafDiff): string {
  const result = TOOL_RESULT.exec(leaf.where)
  if (result) return `tool result, message ${Number(result[1]) + 1}`
  const message = MESSAGE.exec(leaf.where)
  if (message) return `user text, message ${Number(message[1]) + 1}`
  return leaf.where.replace(/^tool_use /, '')
}

export function clock(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString([], { hour12: false })
}
