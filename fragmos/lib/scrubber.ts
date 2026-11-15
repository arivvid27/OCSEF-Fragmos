import nlp from "compromise";
import { CATEGORY_META, type Category } from "./categories";
import { findHighEntropySecrets } from "./entropy";
import { STRUCTURED_PATTERNS } from "./patterns";

export interface VaultEntry {
  token: string;
  original: string;
  category: Category;
  label: string;
  regulation: string;
  whySensitive: string;
  consequence: string;
  count: number;
}

export interface RiskSpan {
  start: number;
  end: number;
  token: string;
}

export interface ScrubResult {
  sanitized: string;
  vault: VaultEntry[];
  spans: RiskSpan[];
  elapsedMs: number;
}

interface RawSpan {
  start: number;
  end: number;
  category: Category;
}

export interface ScrubOptions {
  customTerms?: string[];
  disabled?: ReadonlySet<Category>;
}

const CAPS_STOPWORDS = new Set([
  "THE", "AND", "FOR", "NOT", "BUT", "ALL", "ANY", "YES", "OK", "NO", "OR", "IF", "IN", "ON", "AT", "TO",
  "OF", "BY", "AS", "IS", "IT", "WE", "US", "UK", "EU", "AM", "PM", "TBD", "ASAP", "FYI", "NOTE", "TODO",
  "TASK", "DRAFT", "URGENT", "CONFIDENTIAL", "IEP", "API", "PDF", "USA", "URL", "HTML", "HTTP", "HTTPS",
  "JSON", "SQL", "FAQ", "CEO", "CFO", "CTO", "HR", "IT", "AI", "ID", "IDS", "SSN", "DOB", "MRN", "PII", "PHI",
  "FERPA", "HIPAA", "COPPA", "CCPA", "GDPR", "NIST", "PCI", "DSS", "SOC", "GLBA", "OWASP", "ADHD", "ASD",
  "ELL", "ESL", "SLD", "FAPE", "LRE", "BIP", "FBA", "MRI", "ER", "ICU", "ED", "RN", "MD", "DR", "II", "III",
  "IV", "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "IL", "IA", "KS", "KY", "LA", "ME",
  "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR",
  "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
]);

const SCHOOL_WORDS =
  "(?:Unified |Public |Independent )?School District|High School|Middle School|Elementary School|Elementary|Academy|University|College|Medical Center|Health Center|Hospital|Clinic|Health System";
const INSTITUTION_RE = new RegExp("(?:[A-Z][\\p{L}'’&.-]*\\s+){1,4}(?:" + SCHOOL_WORDS + ")\\b", "gu");

const DOCUMENT_WORDS = [
  "iep", "meeting", "notes", "note", "summary", "intake", "report", "plan", "draft", "memo",
  "evaluation", "assessment", "review", "discharge", "clinical", "confidential", "progress",
  "behavior", "behavioral", "education", "educational", "individualized", "program", "services",
  "record", "records", "form", "letter", "referral", "history", "diagnosis", "treatment",
  "student", "patient", "parent", "guardian", "teacher", "case", "manager", "grade", "task",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august", "september",
  "october", "november", "december",
];

const LEADING_WORDS = /^(?:The|A|An|At|In|Of|From|To|For|By|With|And)\s+/;
const TITLES = /^(?:Dr|Mr|Mrs|Ms|Mx|Prof|Professor)\.?\s+/i;

function isTaken(spans: RawSpan[], start: number, end: number) {
  for (let i = 0; i < spans.length; i++) {
    if (start < spans[i].end && end > spans[i].start) {
      return true;
    }
  }
  return false;
}

function escapeForRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tidy(raw: string) {
  let s = raw;
  s = s.replace(/[’']s$/, "");
  s = s.replace(/^[\s"'“”([{]+/, "");
  s = s.replace(/[\s"'“”)\]},.;:!?]+$/, "");
  s = s.replace(LEADING_WORDS, "");
  return s.trim();
}

function atSentenceStart(text: string, phrase: string) {
  const idx = text.indexOf(phrase.trim());
  if (idx <= 0) {
    return true;
  }
  const before = text.slice(Math.max(0, idx - 4), idx);
  return /(?:^|[.!?:]\s*|\n\s*)$/.test(before);
}

function nameKey(original: string) {
  const noTitle = original.replace(TITLES, "");
  return noTitle.toLowerCase().replace(/\s+/g, " ").trim();
}

function findAll(text: string, entity: string, category: Category, taken: RawSpan[], flags = "gu") {
  const body = escapeForRegex(entity).replace(/\s+/g, "\\s+");
  const re = new RegExp("(?<![\\p{L}\\p{N}])" + body + "(?![\\p{L}\\p{N}])", flags);
  const matches = text.matchAll(re);
  for (const m of matches) {
    const start = m.index;
    const end = start + m[0].length;
    if (isTaken(taken, start, end) === false) {
      taken.push({ start: start, end: end, category: category });
    }
  }
}

function claimLongestFirst(text: string, list: Map<string, Category>, taken: RawSpan[]) {
  const sorted = Array.from(list.entries());
  sorted.sort(function (a, b) {
    return b[0].length - a[0].length;
  });
  for (let i = 0; i < sorted.length; i++) {
    findAll(text, sorted[i][0], sorted[i][1], taken);
  }
}

export function scrubText(text: string, options: ScrubOptions = {}): ScrubResult {
  const startTime = performance.now();
  const taken: RawSpan[] = [];
  const disabled = options.disabled || new Set<Category>();

  const candidates: RawSpan[] = [];
  for (let p = 0; p < STRUCTURED_PATTERNS.length; p++) {
    const pattern = STRUCTURED_PATTERNS[p];
    if (disabled.has(pattern.category)) {
      continue;
    }
    const matches = text.matchAll(pattern.re);
    for (const m of matches) {
      if (pattern.validate && pattern.validate(m[0]) === false) {
        continue;
      }
      candidates.push({ start: m.index, end: m.index + m[0].length, category: pattern.category });
    }
  }

  candidates.sort(function (a, b) {
    return b.end - b.start - (a.end - a.start) || a.start - b.start;
  });
  for (let i = 0; i < candidates.length; i++) {
    if (isTaken(taken, candidates[i].start, candidates[i].end) === false) {
      taken.push(candidates[i]);
    }
  }

  const secrets = findHighEntropySecrets(text);
  for (let i = 0; i < secrets.length; i++) {
    if (isTaken(taken, secrets[i].start, secrets[i].end) === false) {
      taken.push({ start: secrets[i].start, end: secrets[i].end, category: "HIGH_ENTROPY_SECRET" });
    }
  }

  const customTerms = (options.customTerms || []).slice();
  customTerms.sort(function (a, b) {
    return b.length - a.length;
  });
  for (let i = 0; i < customTerms.length; i++) {
    if (customTerms[i].trim().length >= 2) {
      findAll(text, customTerms[i].trim(), "CUSTOM", taken, "giu");
    }
  }

  if (text.trim() !== "") {
    let masked = text;
    for (let i = 0; i < taken.length; i++) {
      const before = masked.slice(0, taken[i].start);
      const after = masked.slice(taken[i].end);
      masked = before + " ".repeat(taken[i].end - taken[i].start) + after;
    }

    const doc = nlp(masked);
    const found = new Map<string, Category>();

    function remember(raw: string, category: Category) {
      const cleaned = tidy(raw);
      const hasLetter = /\p{L}/u.test(cleaned);
      if (cleaned.length >= 2 && hasLetter && found.has(cleaned) === false) {
        found.set(cleaned, category);
      }
    }

    const people = doc.people().out("array") as string[];
    for (let i = 0; i < people.length; i++) {
      remember(people[i], "SUBJECT");
    }

    const orgs = doc.organizations().out("array") as string[];
    for (let i = 0; i < orgs.length; i++) {
      remember(orgs[i], "INSTITUTION");
    }

    const schoolMatches = masked.matchAll(INSTITUTION_RE);
    for (const m of schoolMatches) {
      remember(m[0], "INSTITUTION");
    }

    const runs = doc.match("#ProperNoun+").out("array") as string[];
    for (let i = 0; i < runs.length; i++) {
      const words = tidy(runs[i]).split(/\s+/);
      let usable = words;
      if (words.length >= 3 && atSentenceStart(masked, runs[i])) {
        usable = words.slice(1);
      }
      if (usable.length < 2) {
        continue;
      }
      let looksLikeHeading = false;
      for (let w = 0; w < usable.length; w++) {
        if (DOCUMENT_WORDS.indexOf(usable[w].toLowerCase()) !== -1) {
          looksLikeHeading = true;
        }
      }
      if (looksLikeHeading === false) {
        remember(usable.join(" "), "SUBJECT");
      }
    }

    claimLongestFirst(masked, found, taken);

    const nameParts = new Map<string, Category>();
    for (let i = 0; i < taken.length; i++) {
      if (taken[i].category !== "SUBJECT") {
        continue;
      }
      const key = nameKey(text.slice(taken[i].start, taken[i].end));
      const words = key.split(" ");
      for (let w = 0; w < words.length; w++) {
        const word = words[w];
        if (word.length >= 3 && /^\p{L}+$/u.test(word)) {
          nameParts.set(word.charAt(0).toUpperCase() + word.slice(1), "SUBJECT");
        }
      }
    }
    claimLongestFirst(masked, nameParts, taken);

    if (disabled.has("ENTITY") === false) {
      for (const m of masked.matchAll(/\b[A-Z]{2,10}\b/g)) {
        if (CAPS_STOPWORDS.has(m[0]) || isTaken(taken, m.index, m.index + m[0].length)) {
          continue;
        }
        const lineStart = masked.lastIndexOf("\n", m.index) + 1;
        let lineEnd = masked.indexOf("\n", m.index);
        if (lineEnd === -1) {
          lineEnd = masked.length;
        }
        if (/[a-z]/.test(masked.slice(lineStart, lineEnd)) === false) {
          continue;
        }
        taken.push({ start: m.index, end: m.index + m[0].length, category: "ENTITY" });
      }
    }
  }

  taken.sort(function (a, b) {
    return a.start - b.start;
  });

  const lookupKey = makeKeyLookup(text, taken);
  const entries = new Map<string, VaultEntry>();
  const counters = new Map<Category, number>();
  const spans: RiskSpan[] = [];
  let sanitized = "";
  let cursor = 0;

  for (let i = 0; i < taken.length; i++) {
    const s = taken[i];
    const original = text.slice(s.start, s.end);
    const key = lookupKey(s.category, original);

    let entry = entries.get(key);
    if (entry === undefined) {
      const next = (counters.get(s.category) || 0) + 1;
      counters.set(s.category, next);
      const meta = CATEGORY_META[s.category];
      entry = {
        token: "[" + s.category + "_" + next + "]",
        original: original,
        category: s.category,
        label: meta.label,
        regulation: meta.regulation,
        whySensitive: meta.whySensitive,
        consequence: meta.consequence,
        count: 0,
      };
      entries.set(key, entry);
    }

    entry.count = entry.count + 1;
    if (original.length > entry.original.length) {
      entry.original = original;
    }

    sanitized = sanitized + text.slice(cursor, s.start) + entry.token;
    cursor = s.end;
    spans.push({ start: s.start, end: s.end, token: entry.token });
  }
  sanitized = sanitized + text.slice(cursor);

  return {
    sanitized: sanitized,
    vault: Array.from(entries.values()),
    spans: spans,
    elapsedMs: performance.now() - startTime,
  };
}

function makeKeyLookup(text: string, taken: RawSpan[]) {
  const fullNames: string[] = [];
  for (let i = 0; i < taken.length; i++) {
    if (taken[i].category !== "SUBJECT") {
      continue;
    }
    const key = nameKey(text.slice(taken[i].start, taken[i].end));
    if (key.includes(" ") && fullNames.indexOf(key) === -1) {
      fullNames.push(key);
    }
  }

  const seen = new Map<string, string>();

  return function (category: Category, original: string) {
    if (category !== "SUBJECT") {
      return category + ":" + original.toLowerCase().replace(/\s+/g, " ");
    }

    const key = nameKey(original);
    const cached = seen.get(key);
    if (cached) {
      return cached;
    }

    let result = key;
    if (key.includes(" ") === false) {
      const candidates = fullNames.filter(function (full) {
        return full.split(" ").indexOf(key) !== -1;
      });
      if (candidates.length === 1) {
        result = candidates[0];
      }
    }

    result = "SUBJECT:" + result;
    seen.set(key, result);
    return result;
  };
}

export function leaksOriginal(sanitized: string, vault: VaultEntry[]): boolean {
  for (let i = 0; i < vault.length; i++) {
    const body = escapeForRegex(vault[i].original);
    const re = new RegExp("(?<![\\p{L}\\p{N}])" + body + "(?![\\p{L}\\p{N}])", "iu");
    if (re.test(sanitized)) {
      return true;
    }
  }
  return false;
}

const TOKEN_RE =/\[\s*([A-Z][A-Z0-9_]*_\d+)\s*\]/g;

export interface RehydratedSegment {
  text: string;
  entry?: VaultEntry;
}

export function rehydrateSegments(text: string, vault: VaultEntry[]): RehydratedSegment[] {
  const byToken = new Map<string, VaultEntry>();
  for (let i = 0; i < vault.length; i++) {
    byToken.set(vault[i].token.slice(1, -1), vault[i]);
  }

  const out: RehydratedSegment[] = [];
  let cursor = 0;
  const matches = text.matchAll(TOKEN_RE);
  for (const m of matches) {
    const entry = byToken.get(m[1]);
    if (entry === undefined) {
      continue;
    }
    if (m.index > cursor) {
      out.push({ text: text.slice(cursor, m.index) });
    }
    out.push({ text: entry.original, entry: entry });
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) {
    out.push({ text: text.slice(cursor) });
  }
  return out;
}

export function rehydrateTextClientSide(text: string, vault: VaultEntry[]): string {
  const segments = rehydrateSegments(text, vault);
  let result = "";
  for (let i = 0; i < segments.length; i++) {
    result += segments[i].text;
  }
  return result;
}

export function countRestored(segments: RehydratedSegment[]): number {
  let n = 0;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].entry) {
      n++;
    }
  }
  return n;
}

export function withholdPartialToken(text: string): string {
  return text.replace(/\[[A-Za-z_0-9\s]{0,24}$/, "");
}

export function splitTokens(text: string): { text: string; isToken: boolean }[] {
  const pieces: { text: string; isToken: boolean }[] = [];
  let cursor = 0;
  const matches = text.matchAll(/\[[A-Z][A-Z0-9_]*_\d+\]/g);
  for (const m of matches) {
    if (m.index > cursor) {
      pieces.push({ text: text.slice(cursor, m.index), isToken: false });
    }
    pieces.push({ text: m[0], isToken: true });
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) {
    pieces.push({ text: text.slice(cursor), isToken: false });
  }
  return pieces;
}
