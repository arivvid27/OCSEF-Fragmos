"""P4 throwaway: does redact -> cloud -> rehydrate -> re-redact keep upstream history byte-identical?

Strategy A re-runs detection on each turn's full history.
Strategy B replaces known vault values first (longest first), then detects new ones in what is left.
"""

import json
import os
import re
import sys
import uuid
from pathlib import Path

import anthropic
from presidio_analyzer import AnalyzerEngine, Pattern, PatternRecognizer

DATA = Path(__file__).resolve().parent.parent / "demo" / "data"
STRATEGY = sys.argv[1] if len(sys.argv) > 1 else "B"
ENTITIES = ["PERSON", "EMAIL_ADDRESS", "PHONE_NUMBER"]
engine = AnalyzerEngine()
engine.registry.add_recognizer(PatternRecognizer(supported_entity="EMAIL_ADDRESS", patterns=[Pattern("email", r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b", 0.9)]))


class Vault:
    def __init__(self):
        self.fwd, self.back, self.n = {}, {}, {}

    def ph(self, etype, value):
        if value not in self.fwd:
            self.n[etype] = self.n.get(etype, 0) + 1
            p = f"[{etype}_{self.n[etype]}]"
            self.fwd[value], self.back[p] = p, value
        return self.fwd[value]

    def redact(self, text):
        if STRATEGY == "B":
            for v in sorted(self.fwd, key=len, reverse=True):
                text = text.replace(v, self.fwd[v])
        found = [r for r in engine.analyze(text=text, language="en", entities=ENTITIES)
                 if not re.fullmatch(r"\[[A-Z_]+_\d+\]", text[r.start:r.end])]
        found.sort(key=lambda r: (r.start, -(r.end - r.start)))
        out, pos = [], 0
        for r in found:
            if r.start < pos:
                continue
            seg = text[r.start:r.end]
            if "[" in seg:
                continue
            out += [text[pos:r.start], self.ph(r.entity_type, seg)]
            pos = r.end
        return "".join(out) + text[pos:]

    def rehydrate(self, text):
        return re.sub(r"\[[A-Z_]+_\d+\]", lambda m: self.back.get(m.group(0), m.group(0)), text)


client = anthropic.Anthropic(
    api_key=os.environ["OPENCODE_API_KEY"], base_url="https://opencode.ai/inference/go/anthropic",
    default_headers={"x-opencode-session": str(uuid.uuid4()), "user-agent": "sentinel/0.1"},
)
note = (DATA / "patient_note_light.txt").read_text()
user_turns = [
    f"Here is today's handoff note:\n\n{note}\nWho asked to move the meeting, and what is their email?",
    "Draft a two-line email to that person confirming Friday at 10am. Address them by full name.",
    "Who is covering reception, and how do I reach them?",
]

vault = Vault()
agent_history, upstream_history = [], []
mismatches = 0
for turn, u in enumerate(user_turns, 1):
    agent_history.append({"role": "user", "content": u})
    sent = [{"role": m["role"], "content": vault.redact(m["content"])} for m in agent_history]
    if upstream_history:
        prefix = sent[: len(upstream_history)]
        same = json.dumps(prefix) == json.dumps(upstream_history)
        mismatches += not same
        print(f"turn {turn}: re-redacted history identical to what upstream saw before: {same}")
        if not same:
            for a, b in zip(prefix, upstream_history):
                if a != b:
                    print("  SENT NOW:", a["content"][:400])
                    print("  SAW THEN:", b["content"][:400])
    resp = client.messages.create(model="deepseek-v4.1-flash", max_tokens=1500, messages=sent)
    reply = "".join(b.text for b in resp.content if b.type == "text")
    upstream_history = sent + [{"role": "assistant", "content": reply}]
    agent_history.append({"role": "assistant", "content": vault.rehydrate(reply)})
    print(f"turn {turn} upstream reply: {reply[:200]!r}")
    print(f"turn {turn} agent sees:     {vault.rehydrate(reply)[:200]!r}")

leaked = [v for v in vault.fwd if any(v in m["content"] for m in upstream_history)]
print(f"\nP4 RESULT strategy={STRATEGY}: history mismatches={mismatches}, real values leaked upstream={leaked}")
print("vault:", {p: v for p, v in vault.back.items()})
