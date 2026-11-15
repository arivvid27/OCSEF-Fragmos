import { describe, expect, it } from "vitest";
import { findHighEntropySecrets, shannonEntropy } from "./entropy";

function secretsIn(text: string): string[] {
  return findHighEntropySecrets(text).map((s) => text.slice(s.start, s.end));
}

describe("shannonEntropy", () => {
  it("is zero for one repeated character", () => {
    expect(shannonEntropy("aaaaaaaa")).toBe(0);
  });

  it("is one bit for two equally likely characters", () => {
    expect(shannonEntropy("abababab")).toBe(1);
  });

  it("is log2 of the alphabet when every character is distinct", () => {
    expect(shannonEntropy("abcdefgh")).toBe(3);
  });
});

describe("findHighEntropySecrets", () => {
  const RANDOM = "q9Zx7Lm2Pw8Rt5Vb3Nc6Hd1Jf4";

  it("finds a long random string on its own", () => {
    expect(secretsIn("deploy with " + RANDOM + " tonight")).toEqual([RANDOM]);
  });

  it("finds a shorter mixed string when a key word comes before it", () => {
    expect(secretsIn("token: a8Kd03LmQ2x9Zp4T")).toEqual(["a8Kd03LmQ2x9Zp4T"]);
    expect(secretsIn("lunch: a8Kd03LmQ2x9Zp4T")).toEqual([]);
  });

  it("ignores env-style names, plain words and digit runs", () => {
    expect(secretsIn("AWS_SECRET_ACCESS_KEY_2 is the name")).toEqual([]);
    expect(secretsIn("internationalization-and-localization")).toEqual([]);
    expect(secretsIn("12345678901234567890123456")).toEqual([]);
  });

  it("ignores the scrubber's own placeholders", () => {
    expect(secretsIn("the key is [HIGH_ENTROPY_SECRET_12] here")).toEqual([]);
  });
});
