import { describe, expect, it } from "vitest";
import { KEY_PLACEHOLDER, since, snippets, type Snippet } from "./view";

const gateway = {
  openai_base_url: "http://127.0.0.1:8787/v1",
  anthropic_base_url: "http://127.0.0.1:8787",
  models: ["cloud", "local"],
};

function text(s: Snippet): string {
  return s.kind === "code" ? s.code : s.fields.map((f) => f.value).join("\n");
}

describe("snippets", () => {
  it("fills in the key on screen", () => {
    for (const s of snippets(gateway, "fm_live_key")) {
      expect(text(s), s.id).toContain("fm_live_key");
      expect(text(s), s.id).not.toContain(KEY_PLACEHOLDER);
    }
  });

  it("puts the key where each client reads its credential", () => {
    const byId = Object.fromEntries(snippets(gateway, "fm_live_key").map((s) => [s.id, s]));
    const code = (id: string) => (byId[id].kind === "code" ? byId[id].code : "");
    expect(code("curl")).toContain('-H "Authorization: Bearer fm_live_key"');
    expect(code("openai")).toMatch(/OpenAI\([^)]*api_key="fm_live_key"/);
    expect(code("anthropic")).toMatch(/Anthropic\([^)]*api_key="fm_live_key"/);
    const webui = byId.openwebui;
    expect(webui.kind === "fields" && webui.fields.find((f) => f.label === "API Key")?.value).toBe("fm_live_key");
  });

  it("uses a placeholder when no key is on screen", () => {
    for (const s of snippets(gateway, null)) expect(text(s), s.id).toContain(KEY_PLACEHOLDER);
  });

  it("points each client at its own base URL", () => {
    const byId = Object.fromEntries(snippets(gateway, null).map((s) => [s.id, text(s)]));
    expect(byId.curl).toContain("http://127.0.0.1:8787/v1/chat/completions");
    expect(byId.curl).toContain('"model": "cloud"');
    expect(byId.openai).toContain('base_url="http://127.0.0.1:8787/v1"');
    expect(byId.anthropic).toContain('base_url="http://127.0.0.1:8787"');
    expect(byId.openwebui).toContain("http://127.0.0.1:8787/v1");
  });

  it("gives Open WebUI two fields to paste, not one block", () => {
    const webui = snippets(gateway, "k").find((s) => s.id === "openwebui");
    expect(webui?.kind === "fields" && webui.fields.map((f) => f.label)).toEqual(["API Base URL", "API Key"]);
  });
});

describe("since", () => {
  const now = 1_700_000_000;
  it.each([
    [null, "never"],
    [now - 5, "just now"],
    [now + 3, "just now"],
    [now - 4 * 60, "4 min ago"],
    [now - 3 * 3600, "3 h ago"],
    [now - 2 * 86400, "2 d ago"],
  ])("%s reads as %s", (at, expected) => {
    expect(since(at, now)).toBe(expected);
  });
});
