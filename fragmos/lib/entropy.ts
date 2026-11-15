const CANDIDATE_RE = /[A-Za-z0-9_\/+=-]{16,128}/g;
const KEY_WORDS_RE = /(?:api|key|secret|token|auth|bearer|credential|passw(?:or)?d|pwd)/i;
const SNAKE_UPPER_RE = /^[A-Z0-9]+(?:_[A-Z0-9]+)+$/;

export interface SecretSpan {
  start: number;
  end: number;
}

export function shannonEntropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) {
    counts.set(ch, (counts.get(ch) || 0) + 1);
  }
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    bits = bits - p * Math.log2(p);
  }
  return bits;
}

export function findHighEntropySecrets(text: string): SecretSpan[] {
  const found: SecretSpan[] = [];

  for (const m of text.matchAll(CANDIDATE_RE)) {
    const value = m[0];
    const start = m.index;
    const end = start + value.length;

    if (text[start - 1] === "[" && text[end] === "]") {
      continue;
    }
    if (SNAKE_UPPER_RE.test(value)) {
      continue;
    }
    if (!/\d/.test(value) || !/[A-Za-z]/.test(value)) {
      continue;
    }

    const before = text.slice(Math.max(0, start - 40), start);
    const nearKeyWord = KEY_WORDS_RE.test(before);
    const entropy = shannonEntropy(value);

    const looksLikeKeyInContext = nearKeyWord && entropy >= 3.3;
    const looksLikeKeyAlone = value.length >= 20 && entropy >= 4.0;
    if (looksLikeKeyInContext || looksLikeKeyAlone) {
      found.push({ start: start, end: end });
    }
  }

  return found;
}

export function containsHighEntropySecret(text: string): boolean {
  return findHighEntropySecrets(text).length > 0;
}
