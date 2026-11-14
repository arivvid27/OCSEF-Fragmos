export type Category =
  | "SUBJECT"
  | "INSTITUTION"
  | "EMAIL"
  | "SSN"
  | "RECORD_ID"
  | "PHONE";

export interface CategoryMeta {
  label: string;
  regulation: string;
  whySensitive: string;
  consequence: string;
}

export const CATEGORY_META: Record<Category, CategoryMeta> = {
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
