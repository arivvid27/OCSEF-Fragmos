
export type StructuredCategory = "EMAIL" | "SSN" | "PHONE" | "RECORD_ID";

export interface StructuredPattern {
  category: StructuredCategory;
  re: RegExp;
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
];

export function containsStructuredPII(text: string): boolean {
  return STRUCTURED_PATTERNS.some(({ re }) => text.search(re) !== -1);
}
