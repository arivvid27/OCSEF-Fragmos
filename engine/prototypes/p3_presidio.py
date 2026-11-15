"""P3 throwaway: what does Presidio find in the demo files, and does a medical keyword list catch the health content?"""

import time
from collections import Counter
from pathlib import Path

from presidio_analyzer import AnalyzerEngine, Pattern, PatternRecognizer

DATA = Path(__file__).resolve().parent.parent / "demo" / "data"

MEDICAL_TERMS = [
    "diabetes", "diabetes mellitus", "hypertension", "hba1c", "metformin", "lisinopril",
    "diagnosis", "diagnosed", "insulin", "chemotherapy", "cancer", "hiv", "asthma",
    "depression", "prescribed", "mg twice daily", "mg daily",
]

engine = AnalyzerEngine()
engine.registry.add_recognizer(PatternRecognizer(supported_entity="HEALTH", deny_list=MEDICAL_TERMS))
engine.registry.add_recognizer(PatternRecognizer(
    supported_entity="SECRET",
    patterns=[Pattern("anthropic", r"sk-ant-[A-Za-z0-9_\-]{20,}", 0.95)],
))


def report(name, text):
    engine.analyze(text=text, language="en")
    t = time.perf_counter()
    for _ in range(5):
        res = engine.analyze(text=text, language="en")
    ms = (time.perf_counter() - t) / 5 * 1000
    print(f"\n== {name} ({len(text)} chars) {ms:.0f} ms/analyze")
    print("counts:", dict(Counter(r.entity_type for r in res)))
    for r in sorted(res, key=lambda r: r.start):
        print(f"  {r.entity_type:14} {r.score:.2f} {text[r.start:r.end]!r}")
    return res


for f in ["patient_note.txt", "patient_note_light.txt", "employees.csv", ".env.fake"]:
    report(f, (DATA / f).read_text())

ssn_res = report("ssn-only line", "Jane, 912-34-5678, Sales, 90000")
print("\nP3 9xx SSN detected by built-in US_SSN:", any(r.entity_type == "US_SSN" for r in ssn_res))
