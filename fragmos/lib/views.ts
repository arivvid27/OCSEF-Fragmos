export interface View {
  text: string;
  source(start: number, end: number): [number, number];
}

const NEEDS_FOLDING = /[^\t\n\r\x20-\x7E]/;
const INVISIBLE = /\p{Cf}|(?!\s)\p{Cc}/u;
const DASH = /\p{Pd}|\u2212/u;
const SPACE = /\p{Zs}|\t/u;
const SPACED_OUT = /(?<!\S)\S(?: \S){5,}/g;
const SSN_GROUPS = /(?<!\d)(\d{3})[ ._-](\d{2})[ ._-](\d{4})(?!\d)/g;
const BASE64_RUN = /[A-Za-z0-9+/_-]{12,}={0,2}/g;
const utf8 = new TextDecoder("utf-8", { fatal: true });

export function plain(text: string): View {
  return { text: text, source: (start, end) => [start, end] };
}

function pick(view: View, keep: number[]): View {
  let text = "";
  for (let i = 0; i < keep.length; i++) {
    text += view.text[keep[i]];
  }
  return { text: text, source: (start, end) => view.source(keep[start], keep[end - 1] + 1) };
}

function fold(text: string): View {
  if (!NEEDS_FOLDING.test(text)) {
    return plain(text.replace(/\t/g, " "));
  }
  let out = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let at = 0;
  for (const char of text) {
    const end = at + char.length;
    for (const n of char.normalize("NFKC")) {
      if (INVISIBLE.test(n)) {
        continue;
      }
      const folded = DASH.test(n) ? "-" : SPACE.test(n) ? " " : n;
      for (let unit = 0; unit < folded.length; unit++) {
        starts.push(at);
        ends.push(end);
      }
      out += folded;
    }
    at = end;
  }
  return { text: out, source: (start, end) => [starts[start], ends[end - 1]] };
}

function joinSpacedOut(view: View): View {
  const keep: number[] = [];
  let last = 0;
  for (const m of view.text.matchAll(SPACED_OUT)) {
    const end = m.index + m[0].length;
    for (let i = last; i < m.index; i++) {
      keep.push(i);
    }
    for (let i = m.index; i < end; i += 2) {
      keep.push(i);
    }
    last = end;
  }
  if (last === 0) {
    return view;
  }
  for (let i = last; i < view.text.length; i++) {
    keep.push(i);
  }
  return pick(view, keep);
}

export function normalized(text: string): View {
  const view = joinSpacedOut(fold(text));
  return { text: view.text.replace(SSN_GROUPS, "$1-$2-$3"), source: view.source };
}

export function readings(text: string): View[] {
  const reading = normalized(text);
  return reading.text === text ? [plain(text)] : [plain(text), reading];
}

function decodeBase64(body: string): string | null {
  try {
    const binary = atob(body.replace(/-/g, "+").replace(/_/g, "/"));
    return utf8.decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

export function decoded(text: string): View[] {
  const views: View[] = [];
  for (const m of text.matchAll(BASE64_RUN)) {
    const body = m[0].replace(/=+$/, "");
    if (body.length % 4 === 1) {
      continue;
    }
    const decodedText = decodeBase64(body);
    if (decodedText === null || decodedText.trim() === "") {
      continue;
    }
    const start = m.index;
    const end = start + m[0].length;
    for (const reading of readings(decodedText)) {
      views.push({ text: reading.text, source: () => [start, end] });
    }
  }
  return views;
}
