import type { StructuredCategory } from "./patterns";

type CoreCategory = "SUBJECT" | "INSTITUTION" | "EMAIL" | "SSN" | "RECORD_ID" | "PHONE";

type DetectedCategory = "ENTITY" | "CUSTOM" | "HIGH_ENTROPY_SECRET";

export type Category = CoreCategory | StructuredCategory | DetectedCategory;

export interface CategoryMeta {
  label: string;
  regulation: string;
  whySensitive: string;
  consequence: string;
}

const CORE_META: Record<CoreCategory, CategoryMeta> = {
  SUBJECT: {
    label: "Direct Personal Identifier",
    regulation: "FERPA § 99.3 · HIPAA Safe Harbor (45 CFR § 164.514(b))",
    whySensitive:
      "A name is the most direct key to a real person. Once it sits next to grades, diagnoses or behavioral notes, the record stops being anonymous and becomes a profile of an identifiable child or patient.",
    consequence:
      "If sent to an external model, the name and its context can be logged or used for third-party model training, and the disclosure itself can count as an unauthorized release of education or health records.",
  },
  INSTITUTION: {
    label: "Institutional & Geographic Link",
    regulation: "FERPA § 99.3 (indirect identifiers) · HIPAA Safe Harbor",
    whySensitive:
      "A school, district or clinic is a quasi-identifier. Combined with grade level, a diagnosis or a date, it shrinks the pool of possible people to a handful, which is enough to re-identify someone.",
    consequence:
      "Re-identification attacks can link a supposedly anonymous passage back to a single student or patient, exposing the institution to federal compliance findings and loss of community trust.",
  },
  EMAIL: {
    label: "Direct Contact Vector",
    regulation: "COPPA / CCPA · FERPA directory-information limits",
    whySensitive:
      "An email address is a persistent, globally unique identifier. It links straight to accounts, other datasets and breach corpora, and it works as a delivery channel for attackers.",
    consequence:
      "Leaked addresses fuel targeted spear-phishing against families, staff and patients, and let outside parties tie this record to other databases.",
  },
  SSN: {
    label: "Government Identifier",
    regulation: "HIPAA Safe Harbor · NIST SP 800-122 (PII)",
    whySensitive:
      "A Social Security number is a lifelong primary key used by banks, credit bureaus and government agencies. It cannot be rotated once exposed.",
    consequence:
      "Exposure enables identity theft and synthetic-identity fraud, and triggers breach-notification duties and significant federal penalties.",
  },
  RECORD_ID: {
    label: "Institutional Record ID",
    regulation: "FERPA § 99.3 · HIPAA Safe Harbor · NIST SP 800-122",
    whySensitive:
      "Student IDs and medical record numbers are primary keys into institutional databases. Anyone holding one can join this text to the full underlying record.",
    consequence:
      "An external model that retains the ID gives outsiders a handle for record lookups, social-engineering calls to the registrar or clinic, and cross-dataset linkage.",
  },
  PHONE: {
    label: "Direct Contact Vector",
    regulation: "COPPA / CCPA · HIPAA Safe Harbor",
    whySensitive:
      "A phone number reaches a specific person or household directly and is widely used as an identity-verification factor.",
    consequence:
      "Leaked numbers enable vishing, SIM-swap attempts and harassment of families and patients, and add to the unauthorized-disclosure record.",
  },
};

const financial: CategoryMeta = {
  label: "Financial Account Identifier",
  regulation: "PCI DSS · GLBA · NIST SP 800-122",
  whySensitive:
    "Card, bank and wallet numbers give direct access to money. Possessing the number is often enough to attempt a charge or a transfer.",
  consequence:
    "Leaked numbers lead to fraudulent charges and account takeover, and can trigger breach-notification duties and card-network penalties.",
};

const governmentId: CategoryMeta = {
  label: "Government Identifier",
  regulation: "HIPAA Safe Harbor · NIST SP 800-122 · GDPR Art. 87",
  whySensitive:
    "National and tax identifiers are lifelong keys used across banks, employers and agencies. They cannot be reissued once exposed.",
  consequence:
    "Exposure enables identity theft and tax or benefits fraud, with notification duties and heavy penalties.",
};

const deviceId: CategoryMeta = {
  label: "Device & Network Identifier",
  regulation: "HIPAA Safe Harbor (device identifiers, IP addresses) · GDPR Recital 30",
  whySensitive:
    "IP addresses, MAC addresses and UUIDs tie activity to a specific device or household and persist across sessions.",
  consequence:
    "They allow tracking and re-identification across datasets, and can expose internal network layout to attackers.",
};

const secret: CategoryMeta = {
  label: "Secret Credential",
  regulation: "NIST SP 800-63B · SOC 2 CC6.1 · OWASP A07",
  whySensitive:
    "Secrets are bearer credentials: whoever holds the string can act as its owner without any further proof.",
  consequence:
    "A secret sent to an external model may be logged or retained. Anyone who obtains it can reach accounts, data or cloud resources, and it must be revoked and rotated.",
};

const named = (base: CategoryMeta, label: string): CategoryMeta => ({ ...base, label });

const confidential: CategoryMeta = {
  label: "Confidential Name or Codename",
  regulation: "NIST SP 800-122 · organizational confidentiality policy",
  whySensitive:
    "Project, client and deal names are not personal data, but they identify unreleased work and relationships. A codename can be a common word, so it is caught by its surrounding wording rather than by a list.",
  consequence:
    "Sent to an external model, an internal codename can be retained or surface in other outputs, leaking unannounced plans or client relationships.",
};

const EXTRA_META: Record<Exclude<Category, CoreCategory>, CategoryMeta> = {
  PROJECT: named(confidential, "Project / Codename"),
  ENTITY: named(confidential, "Unrecognized Name (review suggested)"),
  CUSTOM: named(confidential, "Marked by You"),
  HIGH_ENTROPY_SECRET: named(secret, "High-Entropy Secret"),
  CREDIT_CARD: named(financial, "Payment Card Number"),
  IBAN: named(financial, "Bank Account (IBAN)"),
  CRYPTO_WALLET: named(financial, "Crypto Wallet Address"),
  TAX_ID: named(governmentId, "Tax Identifier"),
  NATIONAL_INSURANCE: named(governmentId, "National Insurance Number"),
  DATE_OF_BIRTH: {
    label: "Date of Birth",
    regulation: "HIPAA Safe Harbor (45 CFR § 164.514(b)) · FERPA § 99.3",
    whySensitive:
      "A birth date is a strong quasi-identifier. Combined with a name, school or ZIP code it narrows a population to one person, and it is a common security-question answer.",
    consequence:
      "It enables re-identification and account-recovery fraud, and counts as a disclosed identifier under HIPAA and FERPA.",
  },
  IPV4: named(deviceId, "IPv4 Address"),
  IPV6: named(deviceId, "IPv6 Address"),
  MAC_ADDRESS: named(deviceId, "MAC Address"),
  UUID: named(deviceId, "Unique Identifier (UUID)"),
  JWT: named(secret, "Session Token (JWT)"),
  AWS_ACCESS_KEY: named(secret, "AWS Access Key"),
  AWS_SECRET_KEY: named(secret, "AWS Secret Key"),
  GITHUB_TOKEN: named(secret, "GitHub Token"),
  SLACK_TOKEN: named(secret, "Slack Token"),
  STRIPE_KEY: named(secret, "Stripe API Key"),
  GOOGLE_API_KEY: named(secret, "Google API Key"),
  API_KEY: named(secret, "API Key"),
  SENDGRID_KEY: named(secret, "SendGrid API Key"),
  TWILIO_KEY: named(secret, "Twilio Credential"),
  NPM_TOKEN: named(secret, "npm Token"),
  PRIVATE_KEY: named(secret, "Private Key"),
  BEARER_TOKEN: named(secret, "Bearer Token"),
  BASIC_AUTH: named(secret, "Basic Auth Credential"),
  URL_CREDENTIALS: named(secret, "Credentials in URL"),
  SECRET_ASSIGNMENT: named(secret, "Embedded Secret"),
};

export const CATEGORY_META: Record<Category, CategoryMeta> = { ...CORE_META, ...EXTRA_META };
