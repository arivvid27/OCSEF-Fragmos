import { CATEGORY_META, type Category, type CategoryMeta } from "../categories";

const like = (category: Category, label?: string): CategoryMeta =>
  label ? { ...CATEGORY_META[category], label } : CATEGORY_META[category];

const ENTITY_META = {
  SECRET: like("API_KEY", "Secret Credential"),
  US_SSN: like("SSN"),
  CREDIT_CARD: like("CREDIT_CARD"),
  PERSON: like("SUBJECT"),
  PHONE_NUMBER: like("PHONE"),
  EMAIL_ADDRESS: like("EMAIL"),
  IBAN_CODE: like("IBAN"),
  CRYPTO: like("CRYPTO_WALLET"),
  IP_ADDRESS: like("IPV4", "IP Address"),
  MAC_ADDRESS: like("MAC_ADDRESS"),
  UUID: like("UUID"),
  US_EIN: like("TAX_ID", "Employer Identification Number"),
  UK_NINO: like("NATIONAL_INSURANCE"),
  DATE_OF_BIRTH: like("DATE_OF_BIRTH"),
  PROJECT_CODENAME: like("PROJECT"),
  HEALTH: {
    label: "Health Information",
    regulation: "HIPAA Privacy Rule (45 CFR § 160.103, PHI) · GDPR Art. 9",
    whySensitive:
      "Diagnoses, medications and treatments describe a person's body and history. Next to anything that identifies them, they become protected health information.",
    consequence:
      "Sent to an external model, health details can be logged or retained outside any business-associate agreement. That is an impermissible disclosure, and it can expose the person to discrimination by insurers or employers.",
  },
  FINANCIAL: {
    label: "Financial Detail",
    regulation: "GLBA · NIST SP 800-122",
    whySensitive:
      "Salaries, balances and account details reveal a person's economic situation, and banks use them to verify identity.",
    consequence:
      "Leaked figures fuel targeted fraud and social engineering, and expose confidential pay or business finances.",
  },
  US_PASSPORT: {
    label: "Passport Number",
    regulation: "NIST SP 800-122 · Privacy Act of 1974",
    whySensitive:
      "A passport number is a government identifier accepted worldwide as proof of identity, at borders, airlines and banks.",
    consequence:
      "Exposure enables identity fraud and forged travel or account-opening documents, and replacing a passport is slow.",
  },
  LOCATION: {
    label: "Location",
    regulation: "HIPAA Safe Harbor (geographic units smaller than a state) · GDPR Art. 4(1)",
    whySensitive:
      "Addresses, cities and places are quasi-identifiers. Next to a date or a role, a location narrows a population to a few people.",
    consequence:
      "Combined with other details it lets a reader re-identify the person, and it can reveal where they live or work.",
  },
  DATE_TIME: {
    label: "Date or Time",
    regulation: "HIPAA Safe Harbor (dates more specific than a year)",
    whySensitive:
      "Admission, visit and event dates are quasi-identifiers. Alone they say little. Next to a name or a place they pin down one person and one event.",
    consequence: "On its own the risk is low, but each date adds to the picture that re-identifies someone.",
  },
} satisfies Record<string, CategoryMeta>;

type EngineEntity = keyof typeof ENTITY_META;

const GENERIC: CategoryMeta = {
  label: "Sensitive Value",
  regulation: "NIST SP 800-122 (PII)",
  whySensitive: "The engine flagged this value as sensitive. Fragmós has no explanation for its type yet.",
  consequence: "Treat it as personal or confidential data until its type is described here.",
};

export function entityMeta(type: string): CategoryMeta {
  return Object.hasOwn(ENTITY_META, type) ? ENTITY_META[type as EngineEntity] : GENERIC;
}
