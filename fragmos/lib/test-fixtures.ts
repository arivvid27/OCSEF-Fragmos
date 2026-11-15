export const SSN = "531-62-4408";
export const KEY = "sk-ant-api03-" + "Q7fakeKEYnotREAL0x9".repeat(3);

export function b64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

export const DISGUISED_SSNS: Record<string, string> = {
  "non-breaking hyphen": SSN.replaceAll("-", "\u2011"),
  "en dash": SSN.replaceAll("-", "\u2013"),
  "minus sign": SSN.replaceAll("-", "\u2212"),
  "fullwidth hyphen": SSN.replaceAll("-", "\uFF0D"),
  "zero-width space": "531-62-\u200B4408",
  "zero-width everywhere": SSN.split("").join("\u200B"),
  "soft hyphen": "531-6\u00AD2-4408",
  "fullwidth digits": "５３１-６２-４４０８",
  "spaces": "531 62 4408",
  "dots": "531.62.4408",
  "non-breaking spaces": "531\u00A062\u00A04408",
  "one character at a time": SSN.split("").join(" "),
  "base64": b64(SSN),
};
