"""The one Detector implementation and the only module that imports Presidio."""

from __future__ import annotations

import re
from functools import lru_cache

from presidio_analyzer import AnalyzerEngine, EntityRecognizer, Pattern, PatternRecognizer
from presidio_analyzer.nlp_engine import NlpEngineProvider
from presidio_analyzer.predefined_recognizers import SpacyRecognizer

from sentinel.core.model import Span

MEDICAL_TERMS = [  # P3: 9 hits on patient_note.txt, 0 on patient_note_light.txt
    "diabetes", "diabetes mellitus", "hypertension", "hba1c", "metformin", "lisinopril",
    "diagnosis", "diagnosed", "insulin", "chemotherapy", "cancer", "hiv", "asthma",
    "depression", "prescribed", "mg twice daily", "mg daily",
]

SECRET_PATTERNS = [
    Pattern("anthropic_key", r"sk-ant-[A-Za-z0-9_\-]{20,}", 0.95),
    Pattern("aws_access_key", r"\bAKIA[0-9A-Z]{16}\b", 0.95),
    Pattern("github_token", r"\bgh[pousr]_[A-Za-z0-9]{36,}\b", 0.95),
    Pattern("private_key", r"-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]+?-----END (?:[A-Z ]+ )?PRIVATE KEY-----",
            0.95),
    Pattern("jwt", r"\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", 0.95),
]

# Presidio's own email recognizer misses @demo.sentinel.local (P3).
EMAIL_PATTERN = Pattern("email", r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b", 0.9)

# Presidio's default flags include IGNORECASE, which would let AKIA[0-9A-Z] match lowercase noise.
CASE_SENSITIVE = re.DOTALL | re.MULTILINE


class PresidioDetector:
    """Build once at boot: loading spaCy en_core_web_lg takes seconds."""

    def __init__(self) -> None:
        nlp = NlpEngineProvider(nlp_configuration={
            "nlp_engine_name": "spacy", "models": [{"lang_code": "en", "model_name": "en_core_web_lg"}],
        }).create_engine()
        self._engine = AnalyzerEngine(nlp_engine=nlp, supported_languages=["en"])
        self._engine.registry.add_recognizer(PatternRecognizer(supported_entity="HEALTH", deny_list=MEDICAL_TERMS))
        self._engine.registry.add_recognizer(PatternRecognizer(
            supported_entity="SECRET", patterns=SECRET_PATTERNS, global_regex_flags=CASE_SENSITIVE))
        self._engine.registry.add_recognizer(PatternRecognizer(
            supported_entity="EMAIL_ADDRESS", patterns=[EMAIL_PATTERN], global_regex_flags=CASE_SENSITIVE))
        self._supported = frozenset(self._engine.get_supported_entities(language="en"))
        self._scan = lru_cache(maxsize=4096)(self._analyze)
        self._without_ner = [r for r in self._engine.registry.get_recognizers(language="en", all_fields=True)
                             if not isinstance(r, SpacyRecognizer)]
        self._patterns = lru_cache(maxsize=4096)(self._match)

    def scan(self, text: str, entity_types: frozenset[str]) -> tuple[Span, ...]:
        return self._scan(text, entity_types)

    def patterns(self, text: str, entity_types: frozenset[str]) -> tuple[Span, ...]:
        return self._patterns(text, entity_types)

    def _match(self, text: str, entity_types: frozenset[str]) -> tuple[Span, ...]:
        """Calls the recognizers directly: AnalyzerEngine.analyze always runs the spaCy pipeline first."""
        results = []
        for recognizer in self._without_ner:
            wanted = [e for e in recognizer.supported_entities if e in entity_types]
            if wanted:
                results += recognizer.analyze(text, wanted, None)
        return tuple(Span(r.entity_type, r.start, r.end, r.score) for r in EntityRecognizer.remove_duplicates(results))

    def _analyze(self, text: str, entity_types: frozenset[str]) -> tuple[Span, ...]:
        """Asking only for the policy's types is what keeps URL, US_ITIN and US_DRIVER_LICENSE out."""
        entities = sorted(entity_types & self._supported)
        if not text.strip() or not entities:
            return ()
        results = self._engine.analyze(text=text, language="en", entities=entities)
        return tuple(Span(r.entity_type, r.start, r.end, r.score) for r in results)
