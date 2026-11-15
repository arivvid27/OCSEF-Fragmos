import { describe, expect, it } from "vitest";
import { containsResidualPII, detectSensitive } from "./detect";
import { disabledCategories } from "./policies";
import { STRUCTURED_PATTERNS } from "./patterns";
import { PRESETS } from "./presets";
import { DISGUISED_SSNS, KEY, SSN, b64 } from "./test-fixtures";
import { decoded } from "./views";

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

  for (const gap of [" ", "\n", " \t "]) {
    it(`finds a key broken by ${JSON.stringify(gap)}`, () => {
      const form = KEY.slice(0, 14) + gap + KEY.slice(14);
      expect(found(`Deploy key: ${form}`)).toEqual(["API_KEY:" + form]);
    });
  }

  it("finds a broken key that follows a word", () => {
    expect(found("the key is ASIAIOSFODNN7\nEXAMPLE")).toEqual(["AWS_ACCESS_KEY:ASIAIOSFODNN7\nEXAMPLE"]);
  });

  it("finds a broken key with words after it", () => {
    expect(found("the key is ASIAIOSFODNN7\nEXAMPLE thanks")).toEqual(["AWS_ACCESS_KEY:ASIAIOSFODNN7\nEXAMPLE"]);
  });

  it("finds a key broken inside its prefix", () => {
    expect(found("the key is AS IAIOSFODNN7EXAMPLE")).toEqual(["AWS_ACCESS_KEY:AS IAIOSFODNN7EXAMPLE"]);
  });

  it("finds a token wrapped where its parts begin", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.\neyJzdWIiOiIxMjM0NTY3ODkwIn0.\ndBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(found(`the token is ${jwt}.`)).toEqual(["JWT:" + jwt]);
  });

  it("finds a key split once with words after it", () => {
    const form = "sk-ant-" + "abcdefghijklmn" + " " + "opqrstuvwxyzabcdefghijklmnopqr";
    expect(found(`Deploy: ${form} please.`)).toEqual(["API_KEY:" + form + " please"]);
  });

  it("does not stretch a whole key across a space into the words after it", () => {
    const key = "sk-ant-api03-" + "Q7fakeKEYnotREAL0x9abc";
    expect(found(`Deploy: ${key} please rotate it.`)).toEqual(["API_KEY:" + key]);
  });

  it("fails closed on a word that starts like a key prefix", () => {
    expect(found("We use sk-learn for classification tasks.")).toEqual([
      "API_KEY:sk-learn for classification tasks",
    ]);
  });

  it("finds a key split once by a space before a lowercase chunk", () => {
    const form = "sk-ant-" + "abcdefghijklmn" + " " + "opqrstuvwxyzab";
    expect(found(`Deploy: ${form}.`)).toEqual(["API_KEY:" + form]);
  });

  it("finds a key split by spaces between mixed-case chunks", () => {
    const form = "sk-ant-api03-Q7" + " fakeKEY not " + "REAL0x9";
    expect(found(`Deploy: ${form}.`)).toEqual(["API_KEY:" + form]);
  });

  it("does not join a key shape to the letters of the next word", () => {
    expect(found("the key is ASIAIOSFODNN7\nEXAMPLEthanks")).toEqual([]);
  });

  it("takes the whole key when its first line is a key by itself", () => {
    const form = "sk-ant-" + "a".repeat(25) + "\n" + "b".repeat(10);
    expect(found(`key: ${form}`)).toEqual(["API_KEY:" + form]);
  });

  it("covers both of two shapes that overlap in part", () => {
    const form = "api_key=sk-ant-aaaaaaaaaa\n" + "b".repeat(12);
    expect(found(`set ${form}`)).toEqual(["API_KEY:" + form]);
  });

  it("finds a value in base64 that decodes with a control character", () => {
    expect(found("SSN OTEyLTM0LTU2NzgA")).toEqual(["SSN:OTEyLTM0LTU2NzgA"]);
    const inside = b64("912-34\u0000-5678");
    expect(found(`SSN ${inside}`)).toEqual(["SSN:" + inside]);
  });

  it("finds a value in base64 of UTF-16 text", () => {
    const wide = Buffer.from("SSN 912-34-5678", "utf16le").toString("base64");
    expect(found(`run ${wide}`)).toEqual(["SSN:" + wide]);
  });

  it("finds a key in base64 that a control character separates from a word", () => {
    const framed = b64("user\u0000" + KEY + "\u0000");
    expect(found(`blob ${framed}`)).toEqual(["API_KEY:" + framed]);
  });

  it("finds a value split by a control character", () => {
    expect(found("SSN 531-62\u0001-4408 on file")).toEqual(["SSN:531-62\u0001-4408"]);
  });

  it("finds nothing in base64-looking text that hides no value", () => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let state = 20261115;
    function next(below: number): number {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state % below;
    }
    const runs: string[] = [];
    for (let i = 0; i < 2000; i++) {
      let run = "";
      for (let length = 12 + next(29); run.length < length; ) {
        run += alphabet[next(alphabet.length)];
      }
      runs.push(run);
    }
    for (const p of PRESETS) {
      runs.push(...p.text.split(/\s+/));
    }
    runs.push(..."internationalization organization-wide src/components/monitor/EventDetail node_modules/next/dist".split(" "));

    const decodable = [
      b64("frame\u0000\u0001 header v2\u0000"),
      b64("\u0002meeting notes for Friday\u0003"),
      Buffer.from("hello world", "utf16le").toString("base64"),
    ];
    for (const run of decodable) {
      expect(decoded(run), run).not.toEqual([]);
    }

    for (const run of runs.concat(decodable)) {
      const direct = STRUCTURED_PATTERNS.filter((p) => run.match(p.re)).map((p) => p.category);
      const all = detectSensitive(run).map((d) => d.category).filter((c) => c !== "HIGH_ENTROPY_SECRET");
      expect(direct, run).toEqual(expect.arrayContaining(all));
    }
  });

  it("does not glue separate words into one value", () => {
    expect(found("Ask info @ example.org today, or see https://docs.example.org :8080 @ noon.")).toEqual([]);
  });

  it("finds a key split by an invisible character", () => {
    const form = KEY.slice(0, 20) + "\u200B" + KEY.slice(20);
    expect(found(`Deploy key: ${form}`)).toEqual(["API_KEY:" + form]);
  });

  it("finds keys whose shape has underscores when an invisible character splits them", () => {
    expect(found("STRIPE_KEY=sk_test_\u206051Nexampl\u00ADeFakeKey0099")).toEqual([
      "STRIPE_KEY:sk_test_\u206051Nexampl\u00ADeFakeKey0099",
    ]);
    const assignment = "aws_secret_access_key = wJalrXUtnFEMI/K\uFEFF7MDENG/bP\uFEFFxRfiCYEXAMPLEKEY";
    expect(found(assignment)).toEqual(["AWS_SECRET_KEY:" + assignment]);
  });

  it("finds a phone number and an email written with non-breaking hyphens", () => {
    expect(found("Call (949) 555\u20110142 or write elena@northwood\u2011usd.org")).toEqual([
      "PHONE:(949) 555\u20110142",
      "EMAIL:elena@northwood\u2011usd.org",
    ]);
  });

  it("keeps the longer reading when two overlap", () => {
    expect(found("SMTP_PASSWORD=hunter2hunter2")).toEqual(["SECRET_ASSIGNMENT:SMTP_PASSWORD=hunter2hunter2"]);
  });

  it("skips disabled categories in every reading", () => {
    const off = disabledCategories([]);
    expect(detectSensitive("card 4111 1111 1111 1111", off)).toEqual([]);
    expect(detectSensitive("card 4111\u20111111\u20111111\u20111111", off)).toEqual([]);
    expect(detectSensitive("card " + b64("4111 1111 1111 1111"), off)).toEqual([]);
  });
});

describe("containsResidualPII", () => {
  it("passes text that holds only placeholders", () => {
    expect(containsResidualPII("Write to [SUBJECT_1] at [EMAIL_1] about [RECORD_ID_1] and [HIGH_ENTROPY_SECRET_2].")).toBe(false);
  });

  it("does not read a placeholder as the value of an assignment", () => {
    expect(containsResidualPII("The wifi pwd: [SUBJECT_1] changed it.")).toBe(false);
    expect(containsResidualPII("api_key = [GOOGLE_API_KEY_1]")).toBe(false);
  });

  it("does not read past a placeholder to the words after it", () => {
    expect(containsResidualPII("GEMINI_API_KEY=[GOOGLE_API_KEY_1]\nNEXT_SETTING=enabled")).toBe(false);
    expect(containsResidualPII("Authorization: Bearer [API_KEY_1] internationalization")).toBe(false);
    expect(containsResidualPII("Project [SUBJECT_1] Falcon")).toBe(false);
  });

  it("still catches a value with a placeholder attached to it", () => {
    expect(containsResidualPII("password=hunter2hunter2[SUBJECT_1]")).toBe(true);
    expect(containsResidualPII("[SUBJECT_1]531-62-4408[SUBJECT_2]")).toBe(true);
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
    for (const seed of ["a", "password.", "a.", "a-", "QUJD", "a b ", "sk- ", "AKIA ", "eyJaaaaaaaa ", "\u0001a"]) {
      const text = "_\u200B" + seed.repeat(Math.floor(20_000 / seed.length));
      const started = performance.now();
      containsResidualPII(text);
      expect(performance.now() - started, seed).toBeLessThan(1000);
    }
  });
});
