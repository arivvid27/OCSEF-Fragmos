"""The one Detector implementation and the only module that imports Presidio."""

from __future__ import annotations

import math
import re
from collections import Counter
from functools import lru_cache

from presidio_analyzer import AnalyzerEngine, EntityRecognizer, Pattern, PatternRecognizer, RecognizerResult
from presidio_analyzer.nlp_engine import NlpEngineProvider
from presidio_analyzer.predefined_recognizers import CreditCardRecognizer, SpacyRecognizer

from sentinel.core.detect import SHAPED, SURE
from sentinel.core.model import Span

MEDICAL_TERMS = [  # P3: 9 hits on patient_note.txt, 0 on patient_note_light.txt
    "diabetes", "diabetes mellitus", "hypertension", "hba1c", "metformin", "lisinopril",
    "diagnosis", "diagnosed", "insulin", "chemotherapy", "cancer", "hiv", "asthma",
    "depression", "prescribed", "mg twice daily", "mg daily",
]

KEY = 0.95  # the characters alone say what it is
CONTEXT = SURE - 0.1  # the match leans on the words and spacing around the value
GUESS = SHAPED / 5  # randomness alone, no pattern behind it

# A head with part of its body is still a secret: a key split in two, or a PEM cut off before its END line.
# Heads too short to stand alone (sk-, AQ., AC, SK) keep the full body length Fragmos asks for.
SECRET_PATTERNS = [
    Pattern("anthropic_key", r"sk-ant-[A-Za-z0-9_\-]{8,}", KEY),
    Pattern("openai_key", r"\bsk-(?:proj-[A-Za-z0-9_-]{8,}|[A-Za-z0-9_-]{20,})", KEY),
    Pattern("aws_access_key", r"\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[0-9A-Z]{16}\b", KEY),
    Pattern("github_token", r"\b(?:gh[pousr]_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,})", KEY),
    Pattern("slack_token", r"\bxox[abprs]-[A-Za-z0-9-]{10,}", KEY),
    Pattern("stripe_key", r"\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}", KEY),
    Pattern("google_api_key", r"\b(?:AIza[0-9A-Za-z_-]{16,}|AQ\.[0-9A-Za-z_-]{30,})", KEY),
    Pattern("sendgrid_key", r"\bSG\.[A-Za-z0-9_-]{22}(?:\.[A-Za-z0-9_-]+)?", KEY),
    Pattern("twilio_key", r"\b(?:AC|SK)[0-9a-f]{32}\b", KEY),
    Pattern("npm_token", r"\bnpm_[A-Za-z0-9]{16,}", KEY),
    Pattern("private_key", r"-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY(?: BLOCK)?-----"
                           r"(?:[\s\S]+?-----END (?:[A-Z ]+ )?PRIVATE KEY(?: BLOCK)?-----"
                           r"|(?:\s*[A-Za-z0-9+/=]{16,})+)", KEY),
    Pattern("jwt", r"\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", KEY),
    Pattern("bearer_token", r"\b(?i:Bearer)\s+[A-Za-z0-9._~+/-]{16,}=*", CONTEXT),
    Pattern("basic_auth", r"\bBasic\s+[A-Za-z0-9+/]{16,}={0,2}", CONTEXT),
    Pattern("url_credentials", r"\b(?i:[a-z][a-z0-9+.-]*)://[^\s:@/]+:[^\s@/]+@[^\s/]+", CONTEXT),
    # Covers Fragmos's AWS_SECRET_KEY too: `aws_secret_access_key = ...` is one more name with `secret` in it.
    Pattern("secret_assignment",
            r"\b[A-Za-z0-9_.-]*(?i:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token"
            r"|client[_-]?secret|private[_-]?key)[A-Za-z0-9_.-]*[\"']?\s*[:=]\s*[\"']?[^\s\"',;]{6,}", CONTEXT),
]

# Entity type -> the patterns Presidio lacks for it. IBAN_CODE, IP_ADDRESS, MAC_ADDRESS and UUID need none.
PATTERNS = {
    "SECRET": SECRET_PATTERNS,
    # Presidio's own email recognizer misses @demo.sentinel.local (P3).
    "EMAIL_ADDRESS": [Pattern("email", r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b", 0.9)],
    # Presidio reads only Bitcoin addresses whose checksum holds.
    "CRYPTO": [Pattern("wallet", r"\b(?:0x[a-fA-F0-9]{40}|bc1[a-z0-9]{25,60})\b", 0.6)],
    "US_EIN": [Pattern("ein", r"(?<!\d)\d{2}-\d{7}(?!\d)", 0.5)],
    # Presidio's UkNinoRecognizer also takes lowercase, which reads "at 10 20 30 a" as a number.
    "UK_NINO": [Pattern("nino", r"\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b", 0.5)],
    "DATE_OF_BIRTH": [Pattern("dob", r"\b(?i:DOB|D\.O\.B\.?|Date\s+of\s+Birth|Birth\s*date)\s*[-:#]?\s*"
                                     r"(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2})\b", 0.6)],
    "PROJECT_CODENAME": [Pattern(
        "codename", r"\b(?:Project|Operation|Initiative|Codename|Client|Account|Deal)\s+"
                    r"(?!(?:Number|Manager|Services|Team|Executive|Name|Information|Details|Summary|Representative"
                    r"|Settings)\b)[A-Z][A-Za-z0-9_-]{1,24}(?:\s+[A-Z][A-Za-z0-9_-]{1,24})?\b", 0.5)],
}

# Presidio's card pattern wants a first digit of 1, 3, 4, 5 or 6, which misses Mastercard's 2-series.
CARD = Pattern("card_16", r"(?<![\d-])(?:\d{4}[ -]?){3}\d{4}(?![\d-])", 0.3)

# Presidio's default flags include IGNORECASE, which would let AKIA[0-9A-Z] match lowercase noise.
CASE_SENSITIVE = re.DOTALL | re.MULTILINE

# Shapes Fragmos reads before it guesses: a guess that overlaps one of them is that shape, not a secret.
CLAIMS = frozenset({"UUID", "MAC_ADDRESS", "CRYPTO", "IBAN_CODE", "EMAIL_ADDRESS"})


class EntropyRecognizer(EntityRecognizer):
    """Fragmos's findHighEntropySecrets: a token with letters and digits that is random enough to be a key, at a
    lower bar when a word such as `token` or `secret` comes just before it."""

    CANDIDATE = re.compile(r"[A-Za-z0-9_/+=-]{16,128}")
    KEY_WORD = re.compile(r"api|key|secret|token|auth|bearer|credential|passw(?:or)?d|pwd", re.IGNORECASE)
    CONSTANT = re.compile(r"[A-Z0-9]+(?:_[A-Z0-9]+)+")  # ENV_NAMES, and the inside of every [TYPE_N] placeholder
    MINTED_IDS = ("toolu_", "srvtoolu_", "msg_", "call_", "req_")  # upstreams mint these random on purpose
    # Not in Fragmos: a host and path are slugs and dates that score as random, and 5 of 6 ordinary URLs fired.
    URL = re.compile(r"[a-z][a-z0-9+.-]*://[^\s?#]+", re.IGNORECASE)

    def __init__(self) -> None:
        super().__init__(supported_entities=["SECRET"], supported_language="en")

    def load(self) -> None:
        pass

    def analyze(self, text: str, entities: list[str], nlp_artifacts: object = None) -> list[RecognizerResult]:
        urls = [m.span() for m in self.URL.finditer(text)]
        found = []
        for m in self.CANDIDATE.finditer(text):
            value, start, end = m.group(), m.start(), m.end()
            if (self.CONSTANT.fullmatch(value) or value.startswith(self.MINTED_IDS)
                    or not (re.search(r"\d", value) and re.search("[A-Za-z]", value))
                    or any(start < b and a < end for a, b in urls)):
                continue
            bits = -sum(n / len(value) * math.log2(n / len(value)) for n in Counter(value).values())
            keyed = self.KEY_WORD.search(text, max(0, start - 40), start)
            if (keyed and bits >= 3.3) or (len(value) >= 20 and bits >= 4.0):
                found.append(RecognizerResult("SECRET", start, end, GUESS))
        return found


def spans(results: list[RecognizerResult]) -> tuple[Span, ...]:
    claimed = [(r.start, r.end) for r in results if r.entity_type in CLAIMS]
    return tuple(Span(r.entity_type, r.start, r.end, r.score) for r in results
                 if r.score > GUESS or not any(r.start < end and start < r.end for start, end in claimed))


class PresidioDetector:
    """Build once at boot: loading spaCy en_core_web_lg takes seconds."""

    def __init__(self) -> None:
        nlp = NlpEngineProvider(nlp_configuration={
            "nlp_engine_name": "spacy", "models": [{"lang_code": "en", "model_name": "en_core_web_lg"}],
        }).create_engine()
        self._engine = AnalyzerEngine(nlp_engine=nlp, supported_languages=["en"])
        added = [PatternRecognizer(supported_entity="HEALTH", deny_list=MEDICAL_TERMS),
                 CreditCardRecognizer(patterns=[CARD]),  # for its Luhn check
                 EntropyRecognizer(),
                 *(PatternRecognizer(supported_entity=entity, patterns=patterns, global_regex_flags=CASE_SENSITIVE)
                   for entity, patterns in PATTERNS.items())]
        for recognizer in added:
            self._engine.registry.add_recognizer(recognizer)
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
        return spans(EntityRecognizer.remove_duplicates(results))

    def _analyze(self, text: str, entity_types: frozenset[str]) -> tuple[Span, ...]:
        """Asking only for the policy's types is what keeps URL, US_ITIN and US_DRIVER_LICENSE out."""
        entities = sorted(entity_types & self._supported)
        if not text.strip() or not entities:
            return ()
        results = self._engine.analyze(text=text, language="en", entities=entities)
        return spans(results)
