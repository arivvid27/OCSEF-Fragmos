import { ACTIONS, type EventId, type Hop, type HopState, type SentinelEvent, type Upstream } from "./api";

export type NodeKind = "agent" | "sentinel" | "model" | "tool" | "domain";

export interface Slot {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Lit {
  hop: Hop;
  pulse: string; // changes only when what the edge shows changes, so stage updates do not replay the pulse
}

export interface Graph {
  slots: Slot[];
  edges: { id: string; src: string; dst: string }[];
  lit: ReadonlyMap<string, Lit>; // edge id -> what the shown turn did on it
  shown: SentinelEvent | null; // the selected turn, or the newest when nothing selected is present
  bounds: { x: number; y: number; width: number; height: number };
}

const COL = { agent: 0, sentinel: 180, right: 430, domain: 660 };
const SIZE: Record<NodeKind, { width: number; height: number }> = {
  agent: { width: 120, height: 48 },
  sentinel: { width: 160, height: 64 },
  model: { width: 196, height: 40 },
  tool: { width: 136, height: 32 },
  domain: { width: 196, height: 32 },
};
const MODEL_PITCH = 44;
const TOOL_PITCH = 38;
const LANE_GAP = 30;
const MIN_MODELS = 3;
const MIN_TOOLS = 4;
const ALWAYS_SHOWN = ["model:cloud", "model:local"];

export const edgeId = (src: string, dst: string) => `${src}->${dst}`;

export function kindOf(node: string): NodeKind {
  if (node === "agent" || node === "sentinel") return node;
  return node.slice(0, node.indexOf(":")) as NodeKind;
}

export const nameOf = (node: string) => node.slice(node.indexOf(":") + 1);

const STATE_RANK: Record<HopState, number> = { done: 0, active: 1, pending: 2, blocked: 3 };

function worse(a: Hop, b: Hop): Hop {
  const rank = (h: Hop) => STATE_RANK[h.state] * 10 + ACTIONS.indexOf(h.action);
  return rank(b) > rank(a) ? b : a;
}

/** Positions depend only on the order nodes were first seen, so a new event adds nodes and never moves one. */
export function layout(
  events: Iterable<SentinelEvent>,
  upstreams: readonly Upstream[],
  selectedId: EventId | null = null,
): Graph {
  const ordered = [...events].sort((a, b) => a.created_at - b.created_at);
  const seen = new Set<string>(ALWAYS_SHOWN);
  const edges = new Map<string, { id: string; src: string; dst: string }>();
  const firstTool = new Map<string, string>(); // domain -> the first tool seen reaching it
  const link = (src: string, dst: string) => {
    const id = edgeId(src, dst);
    if (!edges.has(id)) edges.set(id, { id, src, dst });
  };
  link("agent", "sentinel");
  for (const node of ALWAYS_SHOWN) link("sentinel", node);
  for (const e of ordered) {
    for (const h of e.hops) {
      seen.add(h.src).add(h.dst);
      link(h.src, h.dst);
      if (kindOf(h.dst) === "domain" && !firstTool.has(h.dst)) firstTool.set(h.dst, h.src);
    }
  }

  const models = ["cloud", "local", ...upstreams.map((u) => u.id).filter((id) => id !== "cloud" && id !== "local")];
  for (const node of seen) if (kindOf(node) === "model" && !models.includes(nameOf(node))) models.push(nameOf(node));
  const tools = [...seen].filter((n) => kindOf(n) === "tool");
  const modelRows = Math.max(MIN_MODELS, models.length);
  const toolY0 = modelRows * MODEL_PITCH - (MODEL_PITCH - SIZE.model.height) + LANE_GAP;
  const toolRow = new Map(tools.map((t, i) => [t, i]));
  const taken = new Set<number>();
  const domainRow = new Map<string, number>();
  for (const d of [...seen].filter((n) => kindOf(n) === "domain")) {
    let row = toolRow.get(firstTool.get(d) ?? "") ?? 0;
    while (taken.has(row)) row++;
    taken.add(row);
    domainRow.set(d, row);
  }
  const toolRows = Math.max(MIN_TOOLS, tools.length, ...[...taken].map((r) => r + 1));
  const height = toolY0 + (toolRows - 1) * TOOL_PITCH + SIZE.tool.height;
  const center = (kind: NodeKind) => (height - SIZE[kind].height) / 2;

  const slot = (id: string, kind: NodeKind, x: number, y: number): Slot => ({ id, kind, x, y, ...SIZE[kind] });
  const slots: Slot[] = [
    slot("agent", "agent", COL.agent, center("agent")),
    slot("sentinel", "sentinel", COL.sentinel, center("sentinel")),
  ];
  models.forEach((m, i) => {
    if (seen.has(`model:${m}`)) slots.push(slot(`model:${m}`, "model", COL.right, i * MODEL_PITCH));
  });
  for (const [t, i] of toolRow) slots.push(slot(t, "tool", COL.right, toolY0 + i * TOOL_PITCH));
  for (const [d, i] of domainRow) slots.push(slot(d, "domain", COL.domain, toolY0 + i * TOOL_PITCH));

  const shown =
    ordered.find((e) => e.id === selectedId) ??
    ordered.reduce<SentinelEvent | null>((a, e) => (!a || e.updated_at >= a.updated_at ? e : a), null);
  const lit = new Map<string, Lit>();
  for (const h of shown?.hops ?? []) {
    const id = edgeId(h.src, h.dst);
    const prev = lit.get(id);
    const hop = prev ? worse(prev.hop, h) : h;
    const settled = hop.state === "active" ? "done" : hop.state;
    lit.set(id, { hop, pulse: `${shown?.id}:${hop.action}:${settled}` });
  }

  return {
    slots,
    edges: [...edges.values()],
    lit,
    shown,
    bounds: { x: COL.agent, y: 0, width: COL.domain + SIZE.domain.width, height },
  };
}

/** The newest event whose hops touch the node, or cross the edge. */
export function latestTouching(events: Iterable<SentinelEvent>, match: (h: Hop) => boolean): EventId | null {
  let best: SentinelEvent | null = null;
  for (const e of events) if (e.hops.some(match) && (!best || e.created_at > best.created_at)) best = e;
  return best?.id ?? null;
}
