import { describe, expect, it } from "vitest";
import { parseServerMessage } from "./api";

const event = { id: "e1", headline: "REDACT", diff: [], egress: [], hops: [] };
const approval = { id: "a1", status: "pending", subject: {}, expires_at: 100 };

describe("parseServerMessage", () => {
  it("accepts an event and an approval", () => {
    expect(parseServerMessage(JSON.stringify({ kind: "event", data: event }))?.kind).toBe("event");
    expect(parseServerMessage(JSON.stringify({ kind: "approval", data: approval }))?.kind).toBe("approval");
  });

  it("drops a message whose shape is not one the engine sends", () => {
    expect(parseServerMessage(JSON.stringify({ kind: "event", data: { ...event, headline: "PANIC" } }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ kind: "approval", data: { id: "a1" } }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ kind: "stats", data: {} }))).toBeNull();
    expect(parseServerMessage("[]")).toBeNull();
  });
});
