import { describe, expect, it } from "vitest";
import { entityMeta } from "./entities";

const ENGINE_TYPES = [
  "SECRET",
  "US_SSN",
  "HEALTH",
  "CREDIT_CARD",
  "US_PASSPORT",
  "FINANCIAL",
  "PERSON",
  "PHONE_NUMBER",
  "EMAIL_ADDRESS",
  "LOCATION",
  "DATE_TIME",
  "IBAN_CODE",
  "CRYPTO",
  "IP_ADDRESS",
  "MAC_ADDRESS",
  "UUID",
  "US_EIN",
  "UK_NINO",
  "DATE_OF_BIRTH",
  "PROJECT_CODENAME",
];

describe("entityMeta", () => {
  const generic = entityMeta("NOT_A_REAL_TYPE");

  it.each(ENGINE_TYPES)("explains %s with its own entry", (type) => {
    const meta = entityMeta(type);
    expect(meta).not.toBe(generic);
    expect(meta.label && meta.regulation && meta.whySensitive && meta.consequence).toBeTruthy();
  });

  it("falls back to a generic entry for an unknown type, even one named like an object key", () => {
    expect(generic.label).toBe("Sensitive Value");
    expect(entityMeta("toString")).toBe(generic);
  });
});
