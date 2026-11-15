export interface Preset {
  id: "ferpa" | "hipaa" | "config";
  label: string;
  text: string;
}

export const PRESETS: Preset[] = [
  {
    id: "ferpa",
    label: "IEP Student Note",
    text: `IEP Meeting Notes (draft)
Student: Marcus Vance, Grade 9, Student ID #884920
School: Northwood High School, Irvine Unified School District
Case manager: Dr. Elena Rostova, elena.rostova@northwood-usd.org, (949) 555-0142
Parent/guardian: Sarah Vance, reachable at (949) 555-0187 or svance.family@gmail.com

Marcus has a documented specific learning disability in reading fluency and receives resource support three times a week. He responds well to chunked instructions and extended time. Sarah reported that Marcus has felt anxious about oral presentations since the fall, and Dr. Rostova noted his writing has improved since September.

Task: Draft a warm, parent-friendly summary letter to Sarah Vance covering Marcus's current accommodations, two measurable goals for next semester, and next steps before the annual review. Sign it from Dr. Rostova at Northwood High School.`,
  },
  {
    id: "hipaa",
    label: "Clinical Intake",
    text: `Clinical Intake Summary (confidential)
Patient: Priya Raman, MRN-772913, SSN 531-62-4408
Contact: (714) 555-0166, priya.raman@outlook.com
Referred by Dr. Daniel Okafor of Orange Coast Family Clinic; admitted through the emergency department at UCI Medical Center.

Presenting complaint: three weeks of persistent migraines with intermittent visual aura. Ms. Raman reports poor sleep, high work stress, and a family history of hypertension. Dr. Okafor started a low-dose preventive medication and ordered a follow-up blood panel.

Task: Write plain-language discharge instructions for Priya Raman covering medication, warning signs that need urgent care, and when to schedule her follow-up at UCI Medical Center.`,
  },
  {
    id: "config",
    label: "Leaked API Config",
    text: `# staging notes, do not share
Project Falcon runs on 10.0.4.12 behind the school portal.

GEMINI_API_KEY=AIzaSyD4f7Kq9ExampleOnlyNotReal01234567
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
STRIPE_KEY=sk_test_51NexampleFakeKey0099
DATABASE_URL=postgres://admin:S3cretPass99@10.0.4.12:5432/students
SMTP_PASSWORD=hunter2hunter2

Task: List which of these values are credentials that must be rotated, and draft a short incident note to the IT team.`,
  },
];
