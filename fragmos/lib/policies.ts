import type { Category } from "./categories";

export type PolicyId = "hipaa" | "pci" | "gov" | "confidential";

export interface Policy {
  id: PolicyId;
  label: string;
  description: string;
  categories: Category[];
}

export const POLICIES: Policy[] = [
  {
    id: "hipaa",
    label: "HIPAA",
    description: "Birth dates, IP and MAC addresses, device and unique IDs",
    categories: ["DATE_OF_BIRTH", "IPV4", "IPV6", "MAC_ADDRESS", "UUID"],
  },
  {
    id: "pci",
    label: "PCI",
    description: "Payment cards (Luhn-checked), IBANs, crypto wallets",
    categories: ["CREDIT_CARD", "IBAN", "CRYPTO_WALLET"],
  },
  {
    id: "gov",
    label: "Gov IDs",
    description: "Tax IDs and national insurance numbers",
    categories: ["TAX_ID", "NATIONAL_INSURANCE"],
  },
  {
    id: "confidential",
    label: "Projects",
    description: "Project codenames and unrecognized ALL-CAPS terms",
    categories: ["PROJECT", "ENTITY"],
  },
];

export const ALL_POLICY_IDS: PolicyId[] = POLICIES.map((p) => p.id);

export const OPTIONAL_CATEGORIES: ReadonlySet<string> = new Set(
  POLICIES.flatMap((p) => p.categories),
);

export function disabledCategories(active: PolicyId[]): ReadonlySet<Category> {
  const off = new Set<Category>();
  for (const policy of POLICIES) {
    if (active.indexOf(policy.id) === -1) {
      for (const c of policy.categories) {
        off.add(c);
      }
    }
  }
  return off;
}
