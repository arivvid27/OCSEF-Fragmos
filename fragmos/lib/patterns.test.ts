import { describe, expect, it } from "vitest";
import { STRUCTURED_PATTERNS, passesLuhn, type StructuredCategory } from "./patterns";

function categoriesIn(text: string): StructuredCategory[] {
  const found: StructuredCategory[] = [];
  for (const pattern of STRUCTURED_PATTERNS) {
    for (const m of text.matchAll(pattern.re)) {
      if (!pattern.validate || pattern.validate(m[0])) {
        found.push(pattern.category);
        break;
      }
    }
  }
  return found;
}

const CASES: Record<StructuredCategory, { hit: string; miss: string }> = {
  EMAIL: { hit: "write to elena.rostova@northwood-usd.org today", miss: "elena.rostova@northwood" },
  SSN: { hit: "SSN 531-62-4408", miss: "order 5531-62-44081" },
  PHONE: { hit: "call (949) 555-0142", miss: "call 555-0142" },
  RECORD_ID: { hit: "Student ID #884920", miss: "Student ID #8849" },
  CREDIT_CARD: { hit: "card 4111 1111 1111 1111", miss: "card 4111 1111 1111 1112" },
  IBAN: { hit: "IBAN GB29 NWBK 6016 1331 9268 19", miss: "IBAN GB29 NWBK" },
  TAX_ID: { hit: "EIN 12-3456789", miss: "EIN 12-345678" },
  NATIONAL_INSURANCE: { hit: "NI number AB 12 34 56 C", miss: "NI number AB 12 34 56 E" },
  DATE_OF_BIRTH: { hit: "DOB: 04/12/2009", miss: "due 04/12/2009" },
  IPV4: { hit: "host 10.0.4.12", miss: "host 10.0.4.256" },
  IPV6: { hit: "host 2001:0db8:85a3:0000:0000:8a2e:0370:7334", miss: "at 12:30 today" },
  MAC_ADDRESS: { hit: "mac 00:1A:2B:3C:4D:5E", miss: "mac 00:1A:2B:3C:4D" },
  UUID: { hit: "id 123e4567-e89b-42d3-a456-426614174000", miss: "id 123e4567-e89b-02d3-a456-426614174000" },
  CRYPTO_WALLET: {
    hit: "pay 0x52908400098527886E0F7030069857D2E4169EE7",
    miss: "pay 0x52908400098527886E0F7030069857D2E4169E",
  },
  JWT: {
    hit: "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    miss: "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0",
  },
  AWS_ACCESS_KEY: { hit: "id AKIAIOSFODNN7EXAMPLE", miss: "id AKIAIOSFODNN7EXAMPL" },
  AWS_SECRET_KEY: {
    hit: "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    miss: "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG",
  },
  GITHUB_TOKEN: {
    hit: "push with ghp_16C7e42F292c6912E7710c838347Ae178B4a",
    miss: "push with ghp_16C7e42F292c6912E7710c8383",
  },
  SLACK_TOKEN: { hit: "bot xoxb-2048-3526-a1b2c3d4e5", miss: "bot xoxb-2048" },
  STRIPE_KEY: { hit: "charge with sk_test_51NexampleFakeKey0099", miss: "charge with sk_demo_51NexampleFakeKey0099" },
  GOOGLE_API_KEY: {
    hit: "maps AIzaSyD4f7Kq9ExampleOnlyNotReal01234567",
    miss: "maps AIzaSyD4f7Kq9ExampleOnly",
  },
  API_KEY: { hit: "use sk-ant-api03-Q7fakeKEYnotREAL0x9", miss: "use sk-ant-short" },
  SENDGRID_KEY: {
    hit: "mail SG." + "abcdefghijklmnopqrstuv.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
    miss: "mail SG." + "abcdefghijklmnopqrstuv.short",
  },
  TWILIO_KEY: { hit: "sid AC" + "0123456789abcdef0123456789abcdef", miss: "sid AC" + "0123456789abcdef0123456789abcde" },
  NPM_TOKEN: { hit: "publish npm_abcdefghijklmnopqrstuvwxyz0123456789", miss: "publish npm_abcdefghijklmnop" },
  PRIVATE_KEY: {
    hit: "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----",
    miss: "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkq\n-----END PUBLIC KEY-----",
  },
  BEARER_TOKEN: { hit: "Authorization: Bearer abcdefghijklmnop1234", miss: "Authorization: Bearer short" },
  BASIC_AUTH: { hit: "Authorization: Basic dXNlcjpwYXNzd29yZDEyMw==", miss: "Authorization: Basic dXNlcg==" },
  URL_CREDENTIALS: {
    hit: "postgres://admin:S3cretPass99@10.0.4.12:5432/students",
    miss: "postgres://db.internal:5432/students",
  },
  SECRET_ASSIGNMENT: { hit: "SMTP_PASSWORD=hunter2hunter2", miss: "SMTP_PASSWORD=abc" },
  PROJECT: { hit: "Project Falcon ships Friday", miss: "Project Manager ships Friday" },
};

describe("structured patterns", () => {
  it("has a case for every pattern", () => {
    expect(Object.keys(CASES).sort()).toEqual(STRUCTURED_PATTERNS.map((p) => p.category).sort());
  });

  for (const [category, { hit, miss }] of Object.entries(CASES) as [StructuredCategory, { hit: string; miss: string }][]) {
    it(`${category} matches the real shape`, () => {
      expect(categoriesIn(hit)).toContain(category);
    });
    it(`${category} ignores the near miss`, () => {
      expect(categoriesIn(miss)).not.toContain(category);
    });
  }
});

describe("passesLuhn", () => {
  it("accepts valid card numbers, with or without separators", () => {
    expect(passesLuhn("4111111111111111")).toBe(true);
    expect(passesLuhn("4111-1111-1111-1111")).toBe(true);
    expect(passesLuhn("378282246310005")).toBe(true);
  });

  it("rejects a wrong check digit", () => {
    expect(passesLuhn("4111111111111112")).toBe(false);
  });

  it("rejects lengths no card uses", () => {
    expect(passesLuhn("411111111111")).toBe(false);
    expect(passesLuhn("0".repeat(20))).toBe(false);
  });
});

describe("hostile input", () => {
  const SEEDS = ["a", "a.", "a-", "1", "password", "password.", "a1.", "a+", "1-", "a@a.", "a://a:a"];

  for (const seed of SEEDS) {
    it(`scans 20,000 characters of ${JSON.stringify(seed)} quickly`, () => {
      const text = seed.repeat(Math.floor(20_000 / seed.length));
      const started = performance.now();
      categoriesIn(text);
      expect(performance.now() - started).toBeLessThan(500);
    });
  }

  it("still takes the whole assignment, name included", () => {
    const text = "export SMTP_PASSWORD=hunter2hunter2 now";
    const pattern = STRUCTURED_PATTERNS.find((p) => p.category === "SECRET_ASSIGNMENT")!;
    expect(text.match(pattern.re)).toEqual(["SMTP_PASSWORD=hunter2hunter2"]);
  });
});
