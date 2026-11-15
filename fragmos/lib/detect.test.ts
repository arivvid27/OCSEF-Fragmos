import { describe, expect, it } from "vitest";
import { containsResidualPII, detectSensitive } from "./detect";
import { disabledCategories } from "./policies";
import { DISGUISED_SSNS, KEY, SSN, b64 } from "./test-fixtures";

function found(text: string): string[] {
  return detectSensitive(text)
    .sort((a, b) => a.start - b.start)
    .map((d) => d.category + ":" + text.slice(d.start, d.end));
}

describe("detectSensitive", () => {
  it("finds a plain value where it stands", () => {
    expect(found(`SSN ${SSN} on file`)).toEqual(["SSN:" + SSN]);
  });

  for (const [name, form] of Object.entries(DISGUISED_SSNS)) {
    it(`finds an SSN disguised with ${name} and returns its source span`, () => {
      expect(found(`Patient SSN ${form}, please file it.`)).toEqual(["SSN:" + form]);
    });
  }

  it("finds a secret inside base64 and takes the whole encoded run", () => {
    expect(found(`Deploy key (base64): ${b64(KEY)}`)).toEqual(["API_KEY:" + b64(KEY)]);
  });

  for (const gap of [" ", "\n"]) {
    it(`finds a key broken by ${JSON.stringify(gap)}`, () => {
      const form = KEY.slice(0, 14) + gap + KEY.slice(14);
      expect(found(`Deploy key: ${form}`)).toEqual(["API_KEY:" + form]);
    });
  }

  it("does not glue separate words into one value", () => {
    expect(found("Ask info @ example.org today, or see https://docs.example.org :8080 @ noon.")).toEqual([]);
  });

  it("finds a key split by an invisible character", () => {
    const form = KEY.slice(0, 20) + "​" + KEY.slice(20);
    expect(found(`Deploy key: ${form}`)).toEqual(["API_KEY:" + form]);
  });

  it("finds a phone number and an email written with non-breaking hyphens", () => {
    expect(found("Call (949) 555‑0142 or write elena@northwood‑usd.org")).toEqual([
      "PHONE:(949) 555‑0142",
      "EMAIL:elena@northwood‑usd.org",
    ]);
  });

  it("keeps the longer reading when two overlap", () => {
    expect(found("SMTP_PASSWORD=hunter2hunter2")).toEqual(["SECRET_ASSIGNMENT:SMTP_PASSWORD=hunter2hunter2"]);
  });

  it("skips disabled categories in every reading", () => {
    const off = disabledCategories([]);
    expect(detectSensitive("card 4111 1111 1111 1111", off)).toEqual([]);
    expect(detectSensitive("card 4111‑1111‑1111‑1111", off)).toEqual([]);
    expect(detectSensitive("card " + b64("4111 1111 1111 1111"), off)).toEqual([]);
  });
});

describe("containsResidualPII", () => {
  it("passes text that holds only placeholders", () => {
    expect(containsResidualPII("Write to [SUBJECT_1] at [EMAIL_1] about [RECORD_ID_1] and [HIGH_ENTROPY_SECRET_2].")).toBe(false);
  });

  it("does not read a placeholder as the value of an assignment", () => {
    expect(containsResidualPII("The wifi pwd: [SUBJECT_1] set it.")).toBe(false);
    expect(containsResidualPII("api_key = [GOOGLE_API_KEY_1]")).toBe(false);
  });

  it("still catches a value dressed up as a placeholder", () => {
    expect(containsResidualPII("password: [NOTACATEGORY_1]")).toBe(true);
    expect(containsResidualPII("id [AKIAIOSFODNN7EXAMPLE]")).toBe(true);
  });

  for (const [name, form] of Object.entries(DISGUISED_SSNS)) {
    it(`catches an SSN disguised with ${name}`, () => {
      expect(containsResidualPII(`Patient [SUBJECT_1], SSN ${form}.`)).toBe(true);
    });
  }

  it("rechecks optional categories unless their pack is off", () => {
    const text = "Charge 4111 1111 1111 1111 from 10.0.4.12 for Project Falcon, EIN 12-3456789.";
    expect(containsResidualPII(text, disabledCategories(["pci"]))).toBe(true);
    expect(containsResidualPII(text, disabledCategories(["hipaa"]))).toBe(true);
    expect(containsResidualPII(text, disabledCategories(["gov"]))).toBe(true);
    expect(containsResidualPII(text, disabledCategories(["confidential"]))).toBe(true);
    expect(containsResidualPII(text, disabledCategories([]))).toBe(false);
  });

  it("stays fast on hostile input that forces every reading", () => {
    for (const seed of ["a", "password.", "a.", "a-", "QUJD", "a b "]) {
      const text = "_​" + seed.repeat(Math.floor(20_000 / seed.length));
      const started = performance.now();
      containsResidualPII(text);
      expect(performance.now() - started, seed).toBeLessThan(1000);
    }
  });
});
