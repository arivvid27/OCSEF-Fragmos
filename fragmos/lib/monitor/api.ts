// Mirrors sentinel/wire.py: event_to_json, ApprovalDesk rows, Store.stats, and /api/upstreams.

export const ACTIONS = ["ALLOW", "REDACT", "REROUTE", "HOLD", "BLOCK"] as const;
export type Action = (typeof ACTIONS)[number];

export type EventId = string & { readonly __brand: "EventId" };
export type ApprovalId = string & { readonly __brand: "ApprovalId" };

export type Stage =
  | "received"
  | "detected"
  | "decided"
  | "held"
  | "forwarded"
  | "rehydrated"
  | "egress_checked"
  | "tool_held"
  | "blocked"
  | "failed"
  | "returned";

export type Trust = "cloud" | "local";
export type Tier = 0 | 1 | 2 | 3;

export interface RequestSummary {
  action: Action;
  rule: string;
  reason: string;
  tier: Tier;
  entity_counts: Record<string, number>;
}

export interface UpstreamRef {
  id: string;
  trust: Trust;
  model: string;
  simulated: boolean;
  already_local: boolean;
}

export interface EgressVerdict {
  tool_use_id: string;
  tool: string;
  destination: string | null;
  entities: string[];
  action: Extract<Action, "ALLOW" | "HOLD" | "BLOCK">;
  rule: string;
  reason: string;
  outcome: "forwarded" | "blocked" | "pending";
}

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";

export interface ApprovalRef {
  id: ApprovalId;
  status: ApprovalStatus;
  created_at: number;
  expires_at: number;
}

export interface Mark {
  start: number; // offsets into LeafDiff.real
  end: number;
  entity_type: string;
  placeholder: string | null; // null when the value went upstream raw
}

export interface LeafDiff {
  where: string;
  direction: "request" | "tool_call";
  real: string;
  masked: string;
  marks: Mark[];
}

export type HopState = "active" | "done" | "pending" | "blocked";

/** Node ids describe themselves: agent, sentinel, model:<upstream id>, tool:<name>, domain:<host>. */
export interface Hop {
  src: string;
  dst: string;
  action: Action;
  state: HopState;
}

export interface SentinelEvent {
  id: EventId;
  session_id: string;
  created_at: number; // unix seconds
  updated_at: number;
  stage: Stage;
  headline: Action;
  request: RequestSummary | null;
  upstream: UpstreamRef | null;
  egress: EgressVerdict[];
  approval: ApprovalRef | null;
  diff: LeafDiff[];
  hops: Hop[];
  stop_reason: string | null;
  latency_ms: Record<string, number>;
  error: string | null;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface HeldCall {
  tool_use_id: string;
  tool: string;
  destination: string | null;
  arguments: JsonValue; // rehydrated: the reviewer approves the real values
  entities: string[];
  rule: string;
  reason: string;
}

export interface HoldSubject {
  event_id: EventId;
  kind: "request" | "tool_calls";
  rule: string;
  reason: string;
  entities: string[];
  tool_calls: HeldCall[];
  expires_at: number;
}

export interface Approval {
  id: ApprovalId;
  event_id: EventId;
  status: ApprovalStatus;
  created_at: number;
  expires_at: number;
  resolved_at: number | null;
  subject: HoldSubject;
}

export interface Stats {
  by_action: Partial<Record<Action, number>>;
  by_entity: Record<string, number>;
  by_destination: Record<string, number>;
}

export interface Upstream {
  id: string;
  trust: Trust;
  model: string;
  simulated: boolean;
  host: string;
}

export type ServerMessage = { kind: "event"; data: SentinelEvent } | { kind: "approval"; data: Approval };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAction(value: unknown): value is Action {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value);
}

// The rest of each shape is trusted: it is our own proxy's wire contract, checked by its tests.
function parseEvent(raw: unknown): SentinelEvent | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || !isAction(raw.headline)) return null;
  if (!Array.isArray(raw.diff) || !Array.isArray(raw.egress) || !Array.isArray(raw.hops)) return null;
  return raw as unknown as SentinelEvent;
}

function parseApproval(raw: unknown): Approval | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.status !== "string") return null;
  if (!isRecord(raw.subject) || typeof raw.expires_at !== "number") return null;
  return raw as unknown as Approval;
}

function parseList<T>(raw: unknown, parse: (item: unknown) => T | null): T[] {
  if (!Array.isArray(raw)) throw new Error("expected a JSON list");
  return raw.flatMap((item) => parse(item) ?? []);
}

export function parseServerMessage(text: string): ServerMessage | null {
  const raw: unknown = JSON.parse(text);
  if (!isRecord(raw)) return null;
  if (raw.kind === "event") {
    const data = parseEvent(raw.data);
    return data && { kind: "event", data };
  }
  if (raw.kind === "approval") {
    const data = parseApproval(raw.data);
    return data && { kind: "approval", data };
  }
  return null;
}

// next.config.ts rewrites /engine/* to the SENTINEL engine, the WebSocket included.
const ENGINE = "/engine";

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(`${ENGINE}${path}`);
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return res.json();
}

export async function fetchEvents(): Promise<SentinelEvent[]> {
  return parseList(await getJson("/api/events?limit=200"), parseEvent);
}

export async function fetchApprovals(): Promise<Approval[]> {
  return parseList(await getJson("/api/approvals"), parseApproval);
}

export async function fetchStats(): Promise<Stats> {
  const raw = await getJson("/api/stats");
  if (!isRecord(raw) || !isRecord(raw.by_action) || !isRecord(raw.by_destination)) {
    throw new Error("/api/stats has an unexpected shape");
  }
  return raw as unknown as Stats;
}

export async function fetchUpstreams(): Promise<Upstream[]> {
  return parseList(await getJson("/api/upstreams"), (item) =>
    isRecord(item) && typeof item.id === "string" && typeof item.model === "string"
      ? (item as unknown as Upstream)
      : null,
  );
}

/** The stored row comes back on success (200) and when another source resolved it first (409). */
export async function decideApproval(id: ApprovalId, decision: "approve" | "deny"): Promise<Approval | null> {
  const res = await fetch(`${ENGINE}/api/approvals/${id}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision }),
  });
  if (res.status !== 200 && res.status !== 409) throw new Error(`approval ${id} answered ${res.status}`);
  return parseApproval(await res.json());
}

export function socketUrl(): string {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${ENGINE}/ws`;
}
