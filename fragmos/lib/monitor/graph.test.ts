import { describe, expect, it } from "vitest";
import type { EventId, Hop, SentinelEvent } from "./api";
import { edgeId, layout } from "./graph";

function event(id: string, created: number, updated: number, hops: Hop[]): SentinelEvent {
  return {
    id: id as EventId,
    session_id: "s",
    created_at: created,
    updated_at: updated,
    stage: "returned",
    headline: hops[hops.length - 1].action,
    request: null,
    upstream: null,
    egress: [],
    approval: null,
    diff: [],
    hops,
    stop_reason: null,
    latency_ms: {},
    error: null,
  };
}

// `older` was created first but updated last, as when a held turn resolves after a newer one returns.
const older = event("older", 1, 5, [
  { src: "agent", dst: "sentinel", action: "ALLOW", state: "done" },
  { src: "sentinel", dst: "model:cloud", action: "REDACT", state: "done" },
]);
const newer = event("newer", 2, 3, [
  { src: "agent", dst: "sentinel", action: "ALLOW", state: "done" },
  { src: "sentinel", dst: "model:local", action: "REROUTE", state: "done" },
]);
const events = [older, newer];

describe("layout", () => {
  it("lights the selected turn", () => {
    const graph = layout(events, [], newer.id);
    expect(graph.shown?.id).toBe("newer");
    expect([...graph.lit.keys()]).toEqual([edgeId("agent", "sentinel"), edgeId("sentinel", "model:local")]);
    expect(graph.lit.get(edgeId("sentinel", "model:local"))?.pulse).toBe("newer:REROUTE:done");
  });

  it("falls back to the last updated turn when nothing is selected or the selection is gone", () => {
    for (const selected of [null, "gone" as EventId]) {
      const graph = layout(events, [], selected);
      expect(graph.shown?.id).toBe("older");
      expect([...graph.lit.keys()]).toEqual([edgeId("agent", "sentinel"), edgeId("sentinel", "model:cloud")]);
      expect(graph.lit.get(edgeId("sentinel", "model:cloud"))?.pulse).toBe("older:REDACT:done");
    }
  });

  it("never moves a node when the selection changes", () => {
    expect(layout(events, [], newer.id).slots).toEqual(layout(events, [], null).slots);
  });
});
