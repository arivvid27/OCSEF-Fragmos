export const SSN = "531-62-4408";
export const KEY = "sk-ant-api03-" + "Q7fakeKEYnotREAL0x9".repeat(3);

export function b64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

export const DISGUISED_SSNS: Record<string, string> = {
  "non-breaking hyphen": SSN.replaceAll("-", "‑"),
  "en dash": SSN.replaceAll("-", "–"),
  "minus sign": SSN.replaceAll("-", "−"),
  "fullwidth hyphen": SSN.replaceAll("-", "－"),
  "zero-width space": "531-62-​4408",
  "zero-width everywhere": SSN.split("").join("​"),
  "soft hyphen": "531-6­2-4408",
  "fullwidth digits": "５３１-６２-４４０８",
  "spaces": "531 62 4408",
  "dots": "531.62.4408",
  "non-breaking spaces": "531 62 4408",
  "one character at a time": SSN.split("").join(" "),
  "base64": b64(SSN),
};
