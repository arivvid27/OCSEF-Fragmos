import { describe, expect, it } from "vitest";
import { compact, decoded, normalized, readings, type View } from "./views";

const SSN = "912-34-5678";
const KEY = "sk-ant-api03-" + "Q7fakeKEYnotREAL0x9".repeat(3);

function b64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

function sourceOf(text: string, view: View, needle: string): string | null {
  const at = view.text.indexOf(needle);
  if (at === -1) {
    return null;
  }
  const [start, end] = view.source(at, at + needle.length);
  return text.slice(start, end);
}

describe("normalized", () => {
  const DASHES = ["\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2015", "\u2212", "\uFF0D"];
  for (const dash of DASHES) {
    it(`reads U+${dash.codePointAt(0)!.toString(16).toUpperCase()} as a hyphen`, () => {
      const form = SSN.replaceAll("-", dash);
      const text = `Employee SSN ${form}, please file it.`;
      expect(sourceOf(text, normalized(text), SSN)).toBe(form);
    });
  }

  const INVISIBLES = ["\u200B", "\u200C", "\u200D", "\u2060", "\uFEFF", "\u00AD"];
  for (const mark of INVISIBLES) {
    it(`drops U+${mark.codePointAt(0)!.toString(16).toUpperCase()} and still maps back`, () => {
      const form = SSN.split("").join(mark);
      const text = `SSN ${form}.`;
      expect(sourceOf(text, normalized(text), SSN)).toBe(form);
    });
  }

  it("reads fullwidth digits and dots as ASCII", () => {
    const digits = "９１２-３４-５６７８";
    expect(sourceOf(`SSN ${digits}`, normalized(`SSN ${digits}`), SSN)).toBe(digits);
    const dotted = "912\uFF0E34\uFF0E5678";
    expect(sourceOf(dotted, normalized(dotted), SSN)).toBe(dotted);
  });

  const SEPARATED = ["912 34 5678", "912.34.5678", "912-34.5678", "912\u00A034\u00A05678", "912\t34\t5678", "912_34_5678"];
  for (const form of SEPARATED) {
    it(`hyphenates the 3-2-4 groups in ${JSON.stringify(form)}`, () => {
      const text = `SSN ${form} on file`;
      expect(sourceOf(text, normalized(text), SSN)).toBe(form);
    });
  }

  it("joins characters typed one at a time", () => {
    const form = SSN.split("").join(" ");
    const text = `Employee SSN ${form}, please file it.`;
    expect(sourceOf(text, normalized(text), SSN)).toBe(form);
  });

  it("keeps underscores, which key shapes depend on", () => {
    expect(normalized("sk_live_\u200B51Nexample").text).toBe("sk_live_51Nexample");
  });

  it("leaves a short run of single letters alone", () => {
    const text = "Options a b c d are open to Marcus";
    expect(normalized(text).text).toBe(text);
  });

  it("maps back in UTF-16 offsets past an astral character", () => {
    const form = "912\u201134\u20115678";
    const text = `😀 SSN ${form}`;
    expect(sourceOf(text, normalized(text), SSN)).toBe(form);
  });
});

describe("readings", () => {
  it("is the text alone when nothing is disguised", () => {
    expect(readings("Call Marcus about 912-34-5678.").map((v) => v.text)).toEqual(["Call Marcus about 912-34-5678."]);
  });

  it("adds the normalized reading when it differs", () => {
    expect(readings("SSN 912\u201134\u20115678").map((v) => v.text)).toEqual([
      "SSN 912\u201134\u20115678",
      "SSN 912-34-5678",
    ]);
  });
});

describe("compact", () => {
  for (const gap of [" ", "\n", " \t "]) {
    it(`rejoins a key broken by ${JSON.stringify(gap)}`, () => {
      const form = KEY.slice(0, 14) + gap + KEY.slice(14);
      const text = `Deploy key: ${form}`;
      expect(sourceOf(text, compact(normalized(text)), KEY)).toBe(form);
    });
  }
});

describe("decoded", () => {
  it("reads a base64 value and maps a hit to the whole encoded run", () => {
    const text = `Employee SSN (base64) ${b64(SSN)}, decode and file it.`;
    const views = decoded(text);
    expect(views.map((v) => v.text)).toEqual([SSN]);
    expect(sourceOf(text, views[0], "34")).toBe(b64(SSN));
  });

  it("reads unpadded base64url", () => {
    const token = Buffer.from("user?id=1&ssn=" + SSN, "utf8").toString("base64url");
    expect(decoded(`payload ${token}`).map((v) => v.text)).toEqual(["user?id=1&ssn=" + SSN]);
  });

  it("normalizes what it decodes", () => {
    expect(decoded(b64("SSN 912\u201134\u20115678")).map((v) => v.text)).toEqual(["SSN " + SSN]);
  });

  it("skips runs that are not base64 text", () => {
    expect(decoded("internationalization organization-wide")).toEqual([]);
    expect(decoded(Buffer.from([0, 1, 2, 3, 250, 251, 252, 253, 254]).toString("base64"))).toEqual([]);
    expect(decoded(b64("   \n\t   "))).toEqual([]);
  });
});
