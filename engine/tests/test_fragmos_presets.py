"""Fragmos's three demo presets through the real detector and policy, read from fragmos/lib/presets.ts so an edit
there shows up here. The engine has to flag what the browser scrubber flags."""

import re
from pathlib import Path

import pytest

from sentinel import wire
from sentinel.core.detect import detect
from sentinel.core.model import Action, Tier
from sentinel.core.vault import Vault
from test_gaps import POLICY, UPSTREAMS, assert_stayed_local, cloud_saw, run_body, text, user

SOURCE = (Path(__file__).parent.parent.parent / "fragmos" / "lib" / "presets.ts").read_text()
PRESETS = dict(re.findall(r'id: "(\w+)",\s+label: "[^"]+",\s+text: `([^`]*)`', SOURCE))


@pytest.fixture(scope="module")
def findings(presidio):
    def of(preset):
        request = wire.parse_request({"model": "x", "max_tokens": 10, "messages": [user(text(PRESETS[preset]))]}, {},
                                     frozenset(UPSTREAMS))
        return detect(request, presidio, Vault(), POLICY.tiers).findings
    return of


def test_all_three_presets_are_read():
    assert set(PRESETS) == {"ferpa", "hipaa", "config"}


@pytest.mark.parametrize("credential", [
    "AIzaSyD4f7Kq9ExampleOnlyNotReal01234567", "AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    "sk_test_51NexampleFakeKey0099", "S3cretPass99", "hunter2hunter2",
], ids=["gemini", "aws-access-key", "aws-secret-key", "stripe", "database-password", "smtp-password"])
def test_every_credential_in_the_leaked_config_is_a_secret(findings, credential):
    assert credential in PRESETS["config"]
    assert any(f.entity_type == "SECRET" and credential in f.value for f in findings("config"))


def test_the_leaked_config_also_names_its_project_and_host(findings):
    found = {(f.entity_type, f.value) for f in findings("config")}
    assert {("PROJECT_CODENAME", "Project Falcon"), ("IP_ADDRESS", "10.0.4.12")} <= found


def test_the_leaked_config_never_reaches_the_cloud(presidio):
    _, ports = run_body({"messages": [user(text(PRESETS["config"]))]}, presidio)
    assert_stayed_local(ports)
    assert ports.events[-1].request.rule == "secrets-never-leave"


@pytest.mark.parametrize("preset, expected", [
    ("ferpa", {("PERSON", "Marcus Vance"), ("PERSON", "Elena Rostova"), ("PERSON", "Sarah Vance"),
               ("EMAIL_ADDRESS", "elena.rostova@northwood-usd.org"), ("EMAIL_ADDRESS", "svance.family@gmail.com"),
               ("PHONE_NUMBER", "(949) 555-0142"), ("PHONE_NUMBER", "(949) 555-0187"),
               ("ORGANIZATION", "Northwood High School"), ("ORGANIZATION", "Irvine Unified School District")}),
    ("hipaa", {("PERSON", "Priya Raman"), ("PERSON", "Daniel Okafor"), ("US_SSN", "531-62-4408"),
               ("PHONE_NUMBER", "(714) 555-0166"), ("EMAIL_ADDRESS", "priya.raman@outlook.com"),
               ("ORGANIZATION", "Orange Coast Family Clinic"), ("ORGANIZATION", "UCI Medical Center"),
               ("HEALTH", "hypertension")}),
])
def test_names_contacts_ids_and_institutions_are_found(findings, preset, expected):
    assert expected <= {(f.entity_type, f.value) for f in findings(preset)}


@pytest.mark.xfail(strict=True, reason="known gap: Fragmos masks record ids as RECORD_ID; Presidio has no recognizer "
                                       "for them, and reads MRN-772913 as a LOCATION")
@pytest.mark.parametrize("preset, record_id", [("ferpa", "884920"), ("hipaa", "772913")])
def test_record_ids_are_confidential(findings, preset, record_id):
    assert record_id in PRESETS[preset]
    assert any(record_id in f.value and f.tier >= Tier.CONFIDENTIAL for f in findings(preset))


def test_the_student_note_goes_to_the_cloud_with_every_name_and_contact_masked(presidio):
    _, ports = run_body({"messages": [user(text(PRESETS["ferpa"]))]}, presidio)
    assert ports.events[-1].request.action is Action.REDACT and [c["upstream"] for c in ports.calls] == ["cloud"]
    seen = cloud_saw(ports)
    leaked = [v for v in ("Marcus", "Vance", "Elena", "Rostova", "Sarah", "@northwood-usd.org", "@gmail.com", "555-01")
              if v in seen]
    assert not leaked


def test_the_clinical_intake_stays_local(presidio):
    _, ports = run_body({"messages": [user(text(PRESETS["hipaa"]))]}, presidio)
    assert_stayed_local(ports)
    assert ports.events[-1].request.rule == "restricted-stays-local"
