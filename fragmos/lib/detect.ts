import { CATEGORY_META, type Category } from "./categories";
import { findHighEntropySecrets } from "./entropy";
import { BROKEN_KEY_PATTERNS, STRUCTURED_PATTERNS, type StructuredPattern } from "./patterns";
import { decoded, readings, type View } from "./views";

export interface Detection {
  start: number;
  end: number;
  category: Category;
}

const PLACEHOLDER = new RegExp("\\[(?:" + Object.keys(CATEGORY_META).join("|") + ")_\\d+\\]", "g");
const NEVER_PART_OF_A_VALUE = ";";

export function overlaps(spans: Detection[], start: number, end: number): boolean {
  for (let i = 0; i < spans.length; i++) {
    if (start < spans[i].end && end > spans[i].start) {
      return true;
    }
  }
  return false;
}

function claimLongestFirst(found: Detection[], candidates: Detection[]) {
  candidates.sort(function (a, b) {
    return b.end - b.start - (a.end - a.start) || a.start - b.start;
  });
  for (let i = 0; i < candidates.length; i++) {
    if (!overlaps(found, candidates[i].start, candidates[i].end)) {
      found.push(candidates[i]);
    }
  }
}

function collect(view: View, pattern: StructuredPattern, into: Detection[]) {
  for (const m of view.text.matchAll(pattern.re)) {
    if (pattern.validate && !pattern.validate(m[0])) {
      continue;
    }
    const [start, end] = view.source(m.index, m.index + m[0].length);
    into.push({ start: start, end: end, category: pattern.category });
  }
}

export function detectSensitive(text: string, disabled: ReadonlySet<Category> = new Set()): Detection[] {
  const asRead = readings(text);
  const views = asRead.concat(decoded(text));

  const direct: Detection[] = [];
  const acrossBreaks: Detection[] = [];
  for (let p = 0; p < STRUCTURED_PATTERNS.length; p++) {
    const pattern = STRUCTURED_PATTERNS[p];
    if (disabled.has(pattern.category)) {
      continue;
    }
    for (let v = 0; v < views.length; v++) {
      collect(views[v], pattern, direct);
    }
  }
  for (let p = 0; p < BROKEN_KEY_PATTERNS.length; p++) {
    if (!disabled.has(BROKEN_KEY_PATTERNS[p].category)) {
      collect(asRead[asRead.length - 1], BROKEN_KEY_PATTERNS[p], acrossBreaks);
    }
  }

  const secrets: Detection[] = [];
  for (let v = 0; v < asRead.length; v++) {
    const spans = findHighEntropySecrets(asRead[v].text);
    for (let i = 0; i < spans.length; i++) {
      const [start, end] = asRead[v].source(spans[i].start, spans[i].end);
      secrets.push({ start: start, end: end, category: "HIGH_ENTROPY_SECRET" });
    }
  }

  const found: Detection[] = [];
  claimLongestFirst(found, direct);
  claimLongestFirst(found, acrossBreaks);
  claimLongestFirst(found, secrets);
  return found;
}

export function maskPlaceholders(text: string): string {
  return text.replace(PLACEHOLDER, (token) => NEVER_PART_OF_A_VALUE.repeat(token.length));
}

export function containsResidualPII(sanitized: string, disabled?: ReadonlySet<Category>): boolean {
  return detectSensitive(maskPlaceholders(sanitized), disabled).length > 0;
}
