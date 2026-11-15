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
    stroke: "#6e6359",
    meaning: "forwarded unchanged",
  },
  REDACT: {
    chip: "bg-token text-token-ink ring-forest/20",
    dot: "bg-forest",
    text: "text-forest",
    stroke: "#2d5a27",
    meaning: "placeholders to the cloud",
  },
  REROUTE: {
    chip: "bg-[#f1eaf2] text-[#5a3d66] ring-[#5a3d66]/20",
    dot: "bg-[#7a5a88]",
    text: "text-[#5a3d66]",
    stroke: "#7a5a88",
    meaning: "kept on the local model",
  },
  HOLD: {
    chip: "bg-[#f6eedd] text-[#7a5a1f] ring-[#a9803a]/30",
    dot: "bg-[#a9803a]",
    text: "text-[#7a5a1f]",
    stroke: "#a9803a",
    meaning: "waited for a human",
  },
  BLOCK: {
    chip: "bg-risk text-terracotta ring-risk-line/30",
    dot: "bg-risk-line",
    text: "text-terracotta",
    stroke: "#b84a39",
    meaning: "refused",
  },
};

export const TIER_NAME = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"] as const;
