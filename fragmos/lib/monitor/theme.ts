import type { Action } from "./api";

interface ActionStyle {
  chip: string;
  dot: string;
  text: string;
  stroke: string;
  meaning: string;
}

export const ACTION_STYLE: Record<Action, ActionStyle> = {
  ALLOW: {
    chip: "bg-panel text-taupe ring-line",
    dot: "bg-taupe",
    text: "text-taupe",
    stroke: "var(--color-taupe)",
    meaning: "forwarded unchanged",
  },
  REDACT: {
    chip: "bg-token text-token-ink ring-forest/20",
    dot: "bg-forest",
    text: "text-forest",
    stroke: "var(--color-forest)",
    meaning: "placeholders to the cloud",
  },
  REROUTE: {
    chip: "bg-local text-local-ink ring-local-ink/20",
    dot: "bg-local-line",
    text: "text-local-ink",
    stroke: "var(--color-local-line)",
    meaning: "kept on the local model",
  },
  HOLD: {
    chip: "bg-hold text-hold-ink ring-hold-line/30",
    dot: "bg-hold-line",
    text: "text-hold-ink",
    stroke: "var(--color-hold-line)",
    meaning: "waited for a human",
  },
  BLOCK: {
    chip: "bg-risk text-terracotta ring-risk-line/30",
    dot: "bg-risk-line",
    text: "text-terracotta",
    stroke: "var(--color-risk-line)",
    meaning: "refused",
  },
};

export const TIER_NAME = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"] as const;
