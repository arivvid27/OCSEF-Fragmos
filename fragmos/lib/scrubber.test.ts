import { describe, expect, it } from "vitest";
import { containsResidualPII } from "./detect";
import { ALL_POLICY_IDS, disabledCategories } from "./policies";
import { PRESETS } from "./presets";
import {
  countRestored,
  leaksOriginal,
  rehydrateSegments,
  rehydrateTextClientSide,
  scrubText,
  splitTokens,
  withholdPartialToken,
  type ScrubResult,
  type VaultEntry,
} from "./scrubber";
import { adjustSpans } from "./spans";
import { DISGUISED_SSNS, KEY, SSN, b64 } from "./test-fixtures";

const ALL_ON = { disabled: disabledCategories(ALL_POLICY_IDS) };
const ALL_OFF = { disabled: disabledCategories([]) };

function preset(id: string): string {
  return PRESETS.find((p) => p.id === id)!.text;
}

function tokenFor(result: ScrubResult, text: string, phrase: string, from = 0): string | undefined {
  const start = text.indexOf(phrase, from);
  return result.spans.find((s) => s.start === start && s.end === start + phrase.length)?.token;
}

function entry(token: string, original: string): VaultEntry {
  return { token, original, category: "SUBJECT", label: "", regulation: "", whySensitive: "", consequence: "", count: 1 };
}

describe("scrubText on the presets", () => {
  it("masks every identifier in the IEP note", () => {
    const text = preset("ferpa");
    const { sanitized } = scrubText(text, ALL_ON);
    for (const secret of [
      "Marcus", "Vance", "884920", "Northwood", "Irvine Unified", "Rostova", "Elena", "Sarah",
      "elena.rostova@northwood-usd.org", "svance.family@gmail.com", "555-0142", "555-0187",
    ]) {
      expect(sanitized, secret).not.toContain(secret);
    }
    expect(sanitized).toContain("He responds well to chunked instructions and extended time.");
  });

  it("gives a later first name the token of the full name", () => {
    const text = preset("ferpa");
    const result = scrubText(text, ALL_ON);
    const full = tokenFor(result, text, "Marcus Vance");
    expect(full).toMatch(/^\[SUBJECT_\d+\]$/);
    expect(tokenFor(result, text, "Marcus", text.indexOf("Marcus has"))).toBe(full);
    expect(tokenFor(result, text, "Marcus", text.indexOf("Marcus's"))).toBe(full);
    expect(tokenFor(result, text, "Sarah", text.indexOf("Sarah reported"))).toBe(tokenFor(result, text, "Sarah Vance"));
    expect(tokenFor(result, text, "Dr. Rostova", text.indexOf("Dr. Rostova noted"))).toBe(
      tokenFor(result, text, "Dr. Elena Rostova"),
    );
    expect(tokenFor(result, text, "Sarah Vance")).not.toBe(full);
  });

  it("masks every identifier in the clinical intake", () => {
    const text = preset("hipaa");
    const { sanitized, vault } = scrubText(text, ALL_ON);
    for (const secret of [
      "Priya", "Raman", "772913", "531-62-4408", "555-0166", "priya.raman@outlook.com", "Okafor",
      "Orange Coast Family Clinic", "UCI Medical Center",
    ]) {
      expect(sanitized, secret).not.toContain(secret);
    }
    expect(vault.find((v) => v.original === "531-62-4408")?.token).toBe("[SSN_1]");
  });

  it("masks every credential in the leaked config", () => {
    const text = preset("config");
    const { sanitized } = scrubText(text, ALL_ON);
    for (const secret of [
      "AIzaSyD4f7Kq9ExampleOnlyNotReal01234567", "AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      "sk_test_51NexampleFakeKey0099", "S3cretPass99", "hunter2hunter2", "10.0.4.12", "Falcon",
    ]) {
      expect(sanitized, secret).not.toContain(secret);
    }
    expect(rehydrateTextClientSide(sanitized, scrubText(text, ALL_ON).vault)).toBe(text);
  });

  it("leaves optional categories alone when their packs are off", () => {
    const { sanitized } = scrubText(preset("config"), ALL_OFF);
    expect(sanitized).toContain("Project Falcon runs on 10.0.4.12");
    expect(sanitized).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  for (const p of PRESETS) {
    for (const [name, options] of [["on", ALL_ON], ["off", ALL_OFF]] as const) {
      it(`${p.id} with packs ${name} passes its own leak check and the server recheck`, () => {
        const { sanitized, vault } = scrubText(p.text, options);
        expect(leaksOriginal(sanitized, vault)).toBe(false);
        expect(containsResidualPII(sanitized, options.disabled)).toBe(false);
      });
    }
  }
});

describe("scrubText on disguised values", () => {
  for (const [name, form] of Object.entries(DISGUISED_SSNS)) {
    it(`replaces an SSN disguised with ${name} and can put it back`, () => {
      const text = `Patient SSN ${form}, please file it.`;
      const { sanitized, vault } = scrubText(text);
      expect(sanitized).toBe("Patient SSN [SSN_1], please file it.");
      expect(rehydrateTextClientSide(sanitized, vault)).toBe(text);
      expect(leaksOriginal(sanitized, vault)).toBe(false);
      expect(containsResidualPII(sanitized)).toBe(false);
    });
  }

  it("replaces the whole base64 run that hides a key", () => {
    const { sanitized } = scrubText(`Deploy key (base64): ${b64(KEY)} for staging`);
    expect(sanitized).toBe("Deploy key (base64): [API_KEY_1] for staging");
  });

  it("replaces a key broken across a line", () => {
    const { sanitized } = scrubText(`Deploy key: ${KEY.slice(0, 14)}\n${KEY.slice(14)}`);
    expect(sanitized).toBe("Deploy key: [API_KEY_1]");
  });

  it("links a name written with an invisible character to the same token", () => {
    const text = "Marcus Vance called. Later Mar\u00ADcus called again.";
    const result = scrubText(text);
    expect(result.sanitized).toBe("[SUBJECT_1] called. Later [SUBJECT_1] called again.");
  });

  it("masks a custom term in any case and through a disguise", () => {
    const { sanitized } = scrubText("Bluebird ships. bluebird slipped. Blue\u200Bbird is late.", { customTerms: ["bluebird"] });
    expect(sanitized).toBe("[CUSTOM_1] ships. [CUSTOM_1] slipped. [CUSTOM_2] is late.");
  });
});

describe("scrubText options", () => {
  it("masks a card only when it passes Luhn and the pack is on", () => {
    expect(scrubText("card 4111 1111 1111 1111").sanitized).toBe("card [CREDIT_CARD_1]");
    expect(scrubText("card 4111 1111 1111 1112").sanitized).toBe("card 4111 1111 1111 1112");
    expect(scrubText("card 4111 1111 1111 1111", ALL_OFF).sanitized).toBe("card 4111 1111 1111 1111");
  });

  it("reuses one token for a repeated value and counts it", () => {
    const { sanitized, vault } = scrubText(`${SSN} and again ${SSN}`);
    expect(sanitized).toBe("[SSN_1] and again [SSN_1]");
    expect(vault.map((v) => [v.token, v.count])).toEqual([["[SSN_1]", 2]]);
  });

  it("returns spans that point at the masked text", () => {
    const text = "write to elena@northwood.org now";
    const { spans } = scrubText(text);
    expect(spans.map((s) => text.slice(s.start, s.end))).toEqual(["elena@northwood.org"]);
  });

  it("handles empty input", () => {
    expect(scrubText("").sanitized).toBe("");
    expect(scrubText("   ").vault).toEqual([]);
  });
});

describe("leaksOriginal", () => {
  const vault = [entry("[SUBJECT_1]", "Marcus Vance"), entry("[SSN_1]", SSN)];

  it("is false when only placeholders remain", () => {
    expect(leaksOriginal("Write to [SUBJECT_1] about [SSN_1].", vault)).toBe(false);
  });

  it("is true when an original remains, in any case", () => {
    expect(leaksOriginal("Write to marcus  vance about [SSN_1].", vault)).toBe(true);
  });

  it("is true when an original remains in disguise", () => {
    expect(leaksOriginal("SSN 531\u201162\u20114408 for [SUBJECT_1].", vault)).toBe(true);
    expect(leaksOriginal("Ask Mar\u200Bcus Vance.", vault)).toBe(true);
  });

  it("is false when a masked word only matches a placeholder's name", () => {
    const text = "SUBJECT: Marcus Vance needs an EMAIL sent to elena@northwood.org about PROJECT status.";
    const { sanitized, vault: scrubbed } = scrubText(text);
    expect(sanitized).toBe("[ENTITY_1]: [SUBJECT_1] needs an [ENTITY_2] sent to [EMAIL_1] about [ENTITY_3] status.");
    expect(leaksOriginal(sanitized, scrubbed)).toBe(false);
  });

  it("ignores part of a longer word", () => {
    expect(leaksOriginal("The advance was paid.", [entry("[SUBJECT_1]", "Vance")])).toBe(false);
  });
});

describe("rehydrateSegments", () => {
  const vault = [entry("[SUBJECT_1]", "Marcus Vance"), entry("[EMAIL_1]", "elena@northwood.org")];

  it("puts originals back and marks which segments were restored", () => {
    const segments = rehydrateSegments("Dear [SUBJECT_1], write to [EMAIL_1].", vault);
    expect(segments.map((s) => s.text)).toEqual(["Dear ", "Marcus Vance", ", write to ", "elena@northwood.org", "."]);
    expect(segments.map((s) => s.entry?.token)).toEqual([undefined, "[SUBJECT_1]", undefined, "[EMAIL_1]", undefined]);
    expect(countRestored(segments)).toBe(2);
  });

  it("accepts a possessive and stray spaces inside the brackets", () => {
    expect(rehydrateTextClientSide("[SUBJECT_1]'s plan and [ SUBJECT_1 ] again", vault)).toBe(
      "Marcus Vance's plan and Marcus Vance again",
    );
  });

  it("leaves unknown placeholders and ordinary brackets as written", () => {
    const text = "See [SUBJECT_9] and [note 1] and [EMAIL_1";
    expect(rehydrateTextClientSide(text, vault)).toBe(text);
  });
});

describe("withholdPartialToken", () => {
  it("holds back a placeholder that is still arriving", () => {
    expect(withholdPartialToken("Dear [SUBJ")).toBe("Dear ");
    expect(withholdPartialToken("Dear [")).toBe("Dear ");
    expect(withholdPartialToken("Dear [HIGH_ENTROPY_SECRET_1")).toBe("Dear ");
  });

  it("keeps complete placeholders and ordinary text", () => {
    expect(withholdPartialToken("Dear [SUBJECT_1]")).toBe("Dear [SUBJECT_1]");
    expect(withholdPartialToken("Dear [SUBJECT_1], hello")).toBe("Dear [SUBJECT_1], hello");
    expect(withholdPartialToken("a [b] c")).toBe("a [b] c");
  });
});

describe("splitTokens", () => {
  it("separates placeholders from the text around them", () => {
    expect(splitTokens("a [SSN_1] b [x]")).toEqual([
      { text: "a ", isToken: false },
      { text: "[SSN_1]", isToken: true },
      { text: " b [x]", isToken: false },
    ]);
  });
});

describe("adjustSpans", () => {
  const spans = [
    { start: 0, end: 6, token: "[SUBJECT_1]" },
    { start: 14, end: 25, token: "[SSN_1]" },
  ];

  it("shifts spans after an edit and keeps spans before it", () => {
    expect(adjustSpans(spans, "Marcus has SSN 531-62-4408", "Marcus now has SSN 531-62-4408")).toEqual([
      { start: 0, end: 6, token: "[SUBJECT_1]" },
      { start: 18, end: 29, token: "[SSN_1]" },
    ]);
  });

  it("drops a span the edit touched", () => {
    expect(adjustSpans(spans, "Marcus has SSN 531-62-4408", "Marcus has SSN 531-99-4408")).toEqual([
      { start: 0, end: 6, token: "[SUBJECT_1]" },
    ]);
  });
});
