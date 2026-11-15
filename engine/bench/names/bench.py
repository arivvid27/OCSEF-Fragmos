"""PERSON quality and speed of the engine's detector on the 250 synthetic records in test.jsonl, all fake.

Runs PresidioDetector.scan with the policy's entity types, as a turn does. `--detector spacy` rebuilds today's
baseline in this script: spaCy reports PERSON again and the names model is unregistered.

Exact-span F1 needs the same start and end. A gold name leaks when the spans the policy acts on (tier 2 and up)
leave any of its characters uncovered. A record with no gold PII is over-redacted when any such span is found.

    .venv/bin/python bench/names/bench.py [--detector spacy]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import statistics
import time
from pathlib import Path

import yaml
from presidio_analyzer.predefined_recognizers import SpacyRecognizer

from sentinel.core.model import Tier
from sentinel.core.policy import load_policy
from sentinel.presidio_detector import NameRecognizer, PresidioDetector

HERE = Path(__file__).resolve().parent
ENGINE = HERE.parent.parent
SPLITS = ("test_dev", "test_final")


def split_of(record_id: str) -> str:
    """The research harness's split: half the records by a hash of the id."""
    return "test_dev" if hashlib.sha1(record_id.encode()).digest()[-1] % 2 == 0 else "test_final"


def baseline() -> PresidioDetector:
    detector = PresidioDetector()
    registry = detector._engine.registry
    spacy = next(r for r in registry.recognizers if isinstance(r, SpacyRecognizer))
    registry.recognizers = [r for r in registry.recognizers if not isinstance(r, (NameRecognizer, SpacyRecognizer))]
    registry.add_recognizer(SpacyRecognizer(supported_entities=[*spacy.supported_entities, "PERSON"]))
    return detector


def prf(tp: int, fp: int, fn: int) -> tuple[float, float, float]:
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    return p, r, 2 * p * r / (p + r) if p + r else 0.0


def score(records: list[dict], found: dict[str, list], tiers: dict[str, Tier]) -> dict:
    counts, public = [0, 0, 0], [0, 0, 0]
    leaks = names = quiet = over = 0
    for rec in records:
        spans = found[rec["id"]]
        acted = [s for s in spans if tiers[s.entity_type] >= Tier.CONFIDENTIAL]
        gold = {(g["start"], g["end"]) for g in rec["spans"] if g["label"] == "PERSON"}
        pred = {(s.start, s.end) for s in spans if s.entity_type == "PERSON"}
        tally = (len(gold & pred), len(pred - gold), len(gold - pred))
        for i, n in enumerate(tally):
            counts[i] += n
            if "public-figure" in rec["tags"]:
                public[i] += n
        for start, end in gold:
            names += 1
            need = {i for i in range(start, end) if not rec["text"][i].isspace()}
            leaks += not need <= {i for s in acted for i in range(s.start, s.end)}
        if not any(g["label"] != "INJECTION" for g in rec["spans"]):
            quiet += 1
            over += bool(acted)
    p, r, f1 = prf(*counts)
    return {"precision": p, "recall": r, "f1": f1, "leak": leaks / names, "over": over / quiet,
            "public_f1": prf(*public)[2], "public_fp": public[1], "records": len(records)}


def timed_scan(detector: PresidioDetector, text: str, types: frozenset[str]) -> tuple[list, float]:
    detector._scan.cache_clear()
    start = time.perf_counter()
    spans = detector.scan(text, types)
    return list(spans), (time.perf_counter() - start) * 1000


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--detector", choices=["gliner", "spacy"], default="gliner")
    args = parser.parse_args()

    tiers = dict(load_policy(yaml.safe_load((ENGINE / "policy.yaml").read_text())).tiers)
    types = frozenset(tiers)
    detector = PresidioDetector() if args.detector == "gliner" else baseline()
    records = [json.loads(line) for line in open(HERE / "test.jsonl")]
    timed_scan(detector, "Warm up the pipeline before the first record.", types)

    found, ms = {}, {}
    for rec in records:
        found[rec["id"]], ms[rec["id"]] = timed_scan(detector, rec["text"], types)

    print(f"detector: {args.detector}")
    print("| Split | Records | PERSON F1 | Precision | Recall | Leak rate | Over-redaction | F1 public-figure "
          "| False flags public-figure | Median ms | p90 ms |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    for split in SPLITS:
        part = [r for r in records if split_of(r["id"]) == split]
        s = score(part, found, tiers)
        times = sorted(ms[r["id"]] for r in part)
        print(f"| {split} | {s['records']} | {s['f1']:.3f} | {s['precision']:.3f} | {s['recall']:.3f} "
              f"| {s['leak']:.3f} | {s['over']:.3f} | {s['public_f1']:.3f} | {s['public_fp']} | {statistics.median(times):.0f} "
              f"| {times[int(len(times) * 0.9)]:.0f} |")

    csv = (ENGINE / "demo" / "data" / "employees.csv").read_text()
    for _ in range(2):
        timed_scan(detector, csv, types)
    runs = sorted(timed_scan(detector, csv, types)[1] for _ in range(20))
    print(f"employees.csv ({len(csv)} chars): median {statistics.median(runs):.0f} ms over 20 scans after 2 warmups, "
          f"min {runs[0]:.0f}, max {runs[-1]:.0f}")


if __name__ == "__main__":
    main()
