export type StructuredCategory =
  | "EMAIL"
  | "SSN"
  | "PHONE"
  | "RECORD_ID"
  | "CREDIT_CARD"
  | "IBAN"
  | "TAX_ID"
  | "NATIONAL_INSURANCE"
  | "DATE_OF_BIRTH"
  | "IPV4"
  | "IPV6"
  | "MAC_ADDRESS"
  | "UUID"
  | "CRYPTO_WALLET"
  | "JWT"
  | "AWS_ACCESS_KEY"
  | "AWS_SECRET_KEY"
  | "GITHUB_TOKEN"
  | "SLACK_TOKEN"
  | "STRIPE_KEY"
  | "GOOGLE_API_KEY"
  | "API_KEY"
  | "SENDGRID_KEY"
  | "TWILIO_KEY"
  | "NPM_TOKEN"
  | "PRIVATE_KEY"
  | "BEARER_TOKEN"
  | "BASIC_AUTH"
  | "URL_CREDENTIALS"
  | "SECRET_ASSIGNMENT"
  | "PROJECT";

export interface StructuredPattern {
  category: StructuredCategory;
  re: RegExp;
  validate?: (match: string) => boolean;
}

export function passesLuhn(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) {
    return false;
  }
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d = d * 2;
      if (d > 9) {
        d = d - 9;
      }
    }
    sum = sum + d;
    double = !double;
  }
  return sum % 10 === 0;
}

export const STRUCTURED_PATTERNS: StructuredPattern[] = [
  { category: "EMAIL", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
  { category: "SSN", re: /(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/g },
  {
    category: "PHONE",
    re: /(?<![\d-])(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?![\d-])/g,
  },
  {
    category: "RECORD_ID",
    re: /(?:#|\b(?:ID|MRN|SID|Student\s+ID|Patient\s+ID|Case)\s*[-:#]?\s*)\d{5,12}\b/gi,
  },
  {
    category: "CREDIT_CARD",
    re: /(?<![\d-])(?:3[47]\d{2}[\s-]?\d{6}[\s-]?\d{5}|(?:\d{4}[\s-]?){3}\d{4})(?![\d-])/g,
    validate: passesLuhn,
  },
  {
    category: "IBAN",
    re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g,
  },
  { category: "TAX_ID", re: /(?<!\d)\d{2}-\d{7}(?!\d)/g },
  {
    category: "NATIONAL_INSURANCE",
    re: /\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/g,
  },
  {
    category: "DATE_OF_BIRTH",
    re: /\b(?:DOB|D\.O\.B\.?|Date\s+of\s+Birth|Birth\s*date)\s*[-:#]?\s*(?:\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/gi,
  },
  {
    category: "IPV4",
    re: /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])/g,
  },
  {
    category: "IPV6",
    re: /(?<![\w:])(?:(?:[A-Fa-f0-9]{1,4}:){7}[A-Fa-f0-9]{1,4}|(?:[A-Fa-f0-9]{1,4}:){1,7}:|(?:[A-Fa-f0-9]{1,4}:){1,6}:[A-Fa-f0-9]{1,4}|(?:[A-Fa-f0-9]{1,4}:){1,5}(?::[A-Fa-f0-9]{1,4}){1,2}|(?:[A-Fa-f0-9]{1,4}:){1,4}(?::[A-Fa-f0-9]{1,4}){1,3}|(?:[A-Fa-f0-9]{1,4}:){1,3}(?::[A-Fa-f0-9]{1,4}){1,4}|(?:[A-Fa-f0-9]{1,4}:){1,2}(?::[A-Fa-f0-9]{1,4}){1,5}|[A-Fa-f0-9]{1,4}:(?::[A-Fa-f0-9]{1,4}){1,6}|:(?::[A-Fa-f0-9]{1,4}){1,7})(?![\w:])/g,
  },
  { category: "MAC_ADDRESS", re: /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g },
  {
    category: "UUID",
    re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
  },
  { category: "CRYPTO_WALLET", re: /\b(?:0x[a-fA-F0-9]{40}|bc1[a-z0-9]{25,60})\b/g },
  {
    category: "JWT",
    re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    category: "AWS_ACCESS_KEY",
    re: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[A-Z0-9]{16}\b/g,
  },
  {
    category: "AWS_SECRET_KEY",
    re: /\b(?:aws_?secret_?access_?key|secret_?access_?key)\b["']?\s*[:=]\s*["']?[A-Za-z0-9\/+=]{40}(?![A-Za-z0-9\/+=])/gi,
  },
  {
    category: "GITHUB_TOKEN",
    re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{50,255})\b/g,
  },
  { category: "SLACK_TOKEN", re: /\bxox[abprs]-[A-Za-z0-9-]{10,72}\b/g },
  { category: "STRIPE_KEY", re: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { category: "GOOGLE_API_KEY", re: /\b(?:AIza[0-9A-Za-z_-]{35}|AQ\.[0-9A-Za-z_-]{30,})/g },
  { category: "API_KEY", re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { category: "SENDGRID_KEY", re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g },
  { category: "TWILIO_KEY", re: /\b(?:AC|SK)[0-9a-f]{32}\b/g },
  { category: "NPM_TOKEN", re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  {
    category: "PRIVATE_KEY",
    re: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/g,
  },
  { category: "BEARER_TOKEN", re: /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}=*/gi },
  { category: "BASIC_AUTH", re: /\bBasic\s+[A-Za-z0-9+\/]{16,}={0,2}/g },
  {
    category: "URL_CREDENTIALS",
    re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@\/]+:[^\s@\/]+@[^\s\/]+/gi,
  },
  {
    category: "SECRET_ASSIGNMENT",
    re: /\b[A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key)[A-Za-z0-9_.-]*["']?\s*[:=]\s*["']?[^\s"',;]{6,}/gi,
  },
  {
    category: "PROJECT",
    re: /\b(?:Project|Operation|Initiative|Codename|Client|Account|Deal)\s+(?!(?:Number|Manager|Services|Team|Executive|Name|Information|Details|Summary|Representative|Settings)\b)[A-Z][A-Za-z0-9_-]{1,24}(?:\s+[A-Z][A-Za-z0-9_-]{1,24})?\b/g,
  },
];

export function containsStructuredPII(text: string, skip?: ReadonlySet<string>): boolean {
  for (let i = 0; i < STRUCTURED_PATTERNS.length; i++) {
    const pattern = STRUCTURED_PATTERNS[i];
    if (skip && skip.has(pattern.category)) {
      continue;
    }
    for (const m of text.matchAll(pattern.re)) {
      if (!pattern.validate || pattern.validate(m[0])) {
        return true;
      }
    }
  }
  return false;
}