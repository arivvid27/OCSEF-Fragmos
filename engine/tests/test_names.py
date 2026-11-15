"""Names come from the fine-tuned GLiNER2 model: private people are found, famous ones are left alone, and the model
runs with no network. Every name is fake or a historical figure."""

import socket
from pathlib import Path

import pytest
import yaml

from sentinel.core.policy import load_policy

TYPES = frozenset(load_policy(yaml.safe_load((Path(__file__).parent.parent / "policy.yaml").read_text())).tiers)
NOTE = "Clinic note: patient Dana Whitfield, 54, seen at Riverside Clinic in Denver for chest pain since Tuesday."


def people(spans, text):
    return [text[s.start:s.end] for s in spans if s.entity_type == "PERSON"]


def test_famous_names_in_a_research_question_are_not_names_to_redact(presidio):
    text = "Write an essay comparing Thomas Jefferson and Abraham Lincoln"
    assert people(presidio.scan(text, TYPES), text) == []


def test_a_private_patient_name_in_a_note_is_found(presidio):
    assert people(presidio.scan(NOTE, TYPES), NOTE) == ["Dana Whitfield"]


def test_spacy_still_finds_the_places_organisations_and_dates_around_a_name(presidio):
    found = {(s.entity_type, NOTE[s.start:s.end]) for s in presidio.scan(NOTE, TYPES)}
    assert {("ORGANIZATION", "Riverside Clinic"), ("LOCATION", "Denver"), ("DATE_TIME", "Tuesday")} <= found


def test_a_name_spelled_out_in_spaced_letters_is_found_at_its_place_in_the_original_text(presidio):
    text = "Forward the file to B A K Y T  O M A R O V before noon."
    spans = [s for s in presidio.scan(text, TYPES) if s.entity_type == "PERSON"]
    assert [(s.start, s.end) for s in spans] == [(text.index("B A K"), text.index(" before"))]


def test_a_lone_first_name_after_the_full_name_is_the_same_person(presidio):
    text = "Student: Marcus Vance, Grade 9.\n\nMarcus has a documented learning disability in reading fluency."
    assert sorted(people(presidio.scan(text, TYPES), text)) == ["Marcus", "Marcus Vance"]


def test_text_without_end_punctuation_gets_spans_inside_the_text(presidio):
    for text in ("r", "ask Jeff Serrano"):
        assert all(0 <= s.start < s.end <= len(text) for s in presidio.scan(text, TYPES)), text
    assert people(presidio.scan("ask Jeff Serrano", TYPES), "ask Jeff Serrano") == ["Jeff Serrano"]


def test_patterns_run_no_name_model(presidio):
    assert people(presidio.scan(NOTE, TYPES), NOTE)
    assert people(presidio.patterns(NOTE, TYPES), NOTE) == []


def test_the_model_loads_and_scans_with_every_outbound_connection_refused(monkeypatch):
    def refuse(*args, **kwargs):
        raise OSError("outbound connection refused by the test")

    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket.socket, "connect_ex", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)
    monkeypatch.setattr(socket, "getaddrinfo", refuse)
    with pytest.raises(OSError):
        socket.create_connection(("huggingface.co", 443))

    from sentinel.presidio_detector import PresidioDetector

    assert people(PresidioDetector().scan(NOTE, TYPES), NOTE) == ["Dana Whitfield"]
