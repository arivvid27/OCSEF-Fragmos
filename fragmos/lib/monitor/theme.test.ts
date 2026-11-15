import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ACTION_STYLE } from "./theme";

function read(path: string): string {
  return readFileSync(fileURLToPath(new URL("../../" + path, import.meta.url)), "utf8");
}

const themeBlock = read("app/globals.css").match(/@theme \{[\s\S]*?\n\}/)![0];
const tokens = new Set(Array.from(themeBlock.matchAll(/--color-([a-z-]+):/g), (m) => m[1]));

describe("ACTION_STYLE", () => {
  for (const [action, style] of Object.entries(ACTION_STYLE)) {
    it(`${action} uses only colours that globals.css defines`, () => {
      const { meaning, stroke, ...classes } = style;
      const named = Array.from(Object.values(classes).join(" ").matchAll(/(?:bg|text|ring)-([a-z-]+)/g), (m) => m[1]);
      expect(named.length).toBeGreaterThan(0);
      expect(named.filter((name) => !tokens.has(name))).toEqual([]);
      expect(stroke).toMatch(/^var\(--color-[a-z-]+\)$/);
      expect(tokens.has(stroke.slice("var(--color-".length, -1)), stroke).toBe(true);
      expect(meaning).not.toBe("");
    });
  }
});

describe("reroute and hold colours", () => {
  const sources = ["lib/monitor/theme.ts", "components/Telemetry.tsx"].concat(
    readdirSync(fileURLToPath(new URL("../../components/monitor", import.meta.url))).map((name) => "components/monitor/" + name),
  );

  it("are defined once, in the theme", () => {
    for (const hex of ["#f1eaf2", "#5a3d66", "#7a5a88", "#f6eedd", "#7a5a1f", "#a9803a"]) {
      expect(themeBlock.toLowerCase().split(hex).length - 1, hex).toBe(1);
      for (const path of sources) {
        expect(read(path).toLowerCase(), path).not.toContain(hex);
      }
    }
  });
});
