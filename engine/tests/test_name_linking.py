"""One person, one placeholder: a lone first or last name shares the token of the full name it belongs to, across
turns, without breaking the vault's promises. The detector is a fixed list of names; Presidio is not the subject."""

import json
import re

from sentinel.core.model import Span
from test_redact import Agent, result_for, text

NAMES = ["Dr. Elena Rostova", "Sarah Vance", "Marcus Vance", "Priya Raman", "Dr. Rostova", "Rostova", "Marcus",
         "Sarah", "Priya", "Vance"]


class NamedPeople:
    """Tags each listed name, longest first, so `Sarah Vance` is one span and a later lone `Sarah` is another."""

    def scan(self, text, entity_types):
        spans = []
        for name in sorted(NAMES, key=len, reverse=True):
            for m in re.finditer(rf"\b{re.escape(name)}\b", text):
                if not any(m.start() < s.end and s.start < m.end() for s in spans):
                    spans.append(Span("PERSON", m.start(), m.end(), 0.85))
        return spans if "PERSON" in entity_types else []

    patterns = scan


def upstream_text(agent, turn=-1, message=-1):
    """The text of one message as the upstream received it."""
    content = agent.ports.requests[turn]["messages"][message]["content"]
    return " ".join(b["text"] for b in content if b["type"] == "text")


def test_a_lone_name_shares_the_token_of_the_one_full_name_it_belongs_to():
    agent = Agent(NamedPeople())
    agent.turn(text("Sarah Vance called about Priya Raman. Tell Sarah the form is in. Priya is fine."))
    assert upstream_text(agent) == "[PERSON_1] called about [PERSON_2]. Tell [PERSON_1] the form is in. [PERSON_2] is fine."


def test_a_name_part_of_two_full_names_gets_its_own_token():
    agent = Agent(NamedPeople())
    agent.turn(text("Sarah Vance and Marcus Vance are here. Ask Vance. Then ask Marcus."))
    assert upstream_text(agent) == "[PERSON_1] and [PERSON_2] are here. Ask [PERSON_3]. Then ask [PERSON_2]."


def test_a_lone_name_before_its_full_name_in_the_same_request_still_links():
    agent = Agent(NamedPeople())
    agent.turn(text("Marcus is waiting. Marcus Vance is his full name."))
    assert upstream_text(agent) == "[PERSON_1] is waiting. [PERSON_1] is his full name."


def test_a_title_does_not_make_a_second_person():
    agent = Agent(NamedPeople())
    agent.turn(text("Dr. Elena Rostova signed it. Dr. Rostova also called, and Rostova will follow up."))
    assert upstream_text(agent) == "[PERSON_1] signed it. [PERSON_1] also called, and [PERSON_1] will follow up."


def test_the_agent_gets_the_full_name_back_for_a_linked_token():
    agent = Agent(NamedPeople())
    reply = agent.turn(text("Sarah Vance called. Tell Sarah the form is in."))
    said = next(b["text"] for b in reply["content"] if b["type"] == "text")
    assert "I saw [PERSON_1]." not in said and "I saw Sarah Vance." in said


def test_linking_keeps_history_byte_identical_across_turns():
    """Turn 2 links `Priya` to a turn-1 full name, mints a new person, and meets `Vance`, which by then belongs to
    two people. The upstream's view of turn 1 and of its own reply must not move."""
    agent = Agent(NamedPeople())
    r1 = agent.turn(text("Sarah Vance called about Priya Raman. Tell Sarah the form is in."))
    agent.turn(result_for(r1, "sent"), text("Did Priya reply? Also loop in Marcus Vance, and ask Vance to sign."))

    first, second = agent.ports.requests
    said = {"role": "assistant", "content": agent.ports.produced[0]["content"]}
    assert json.dumps(second["messages"][:2]) == json.dumps(first["messages"] + [said])
    assert json.dumps(second["system"]) == json.dumps(first["system"])
    assert upstream_text(agent) == "Did [PERSON_2] reply? Also loop in [PERSON_3], and ask [PERSON_4] to sign."
    assert not [n for n in NAMES if n in json.dumps(second)]


def test_a_token_minted_for_a_lone_name_is_never_reassigned():
    """`Sarah` got her own token before any full name was known. Append-only: she keeps it when `Sarah Vance`
    arrives, and turn 1 still masks to the same bytes."""
    agent = Agent(NamedPeople())
    r1 = agent.turn(text("Ping Sarah."))
    agent.turn(result_for(r1, "sent"), text("Her full name is Sarah Vance. Ping Sarah again."))

    first, second = agent.ports.requests
    assert upstream_text(agent, 0) == "Ping [PERSON_1]."
    assert json.dumps(second["messages"][0]) == json.dumps(first["messages"][0])
    assert upstream_text(agent).endswith("Ping [PERSON_1] again.") and "Vance" not in json.dumps(second)


def test_masking_the_same_history_twice_gives_the_same_bytes():
    agent = Agent(NamedPeople())
    agent.turn(text("Sarah Vance and Marcus Vance are here. Ask Vance, then Sarah, then Dr. Elena Rostova."))
    agent.history = agent.history[:1]
    agent.turn()
    first, second = agent.ports.requests
    assert json.dumps(second["messages"][0]) == json.dumps(first["messages"][0])
