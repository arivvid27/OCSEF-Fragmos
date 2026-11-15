import type { RiskSpan } from "./scrubber";

export function adjustSpans(spans: RiskSpan[], oldText: string, newText: string): RiskSpan[] {
  const shortest = Math.min(oldText.length, newText.length);

  let prefix = 0;
  while (prefix < shortest && oldText[prefix] === newText[prefix]) {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < shortest - prefix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) {
    suffix++;
  }

  const delta = newText.length - oldText.length;
  const kept: RiskSpan[] = [];
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    if (s.end <= prefix) {
      kept.push(s);
    } else if (s.start >= oldText.length - suffix) {
      kept.push({ start: s.start + delta, end: s.end + delta, token: s.token });
    }
  }
  return kept;
}
