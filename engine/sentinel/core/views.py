"""Readings of a string that a person or model would decode but a regex reads literally.

Every view maps each of its characters back to the leaf character it came from, so a finding in a view lands on the
span of the original text a reader would decode it from.
"""

from __future__ import annotations

import base64
import binascii
import re
import unicodedata
from dataclasses import dataclass
from typing import Sequence


@dataclass(frozen=True)
class View:
    text: str
    origin: Sequence[int]  # per view character, the index of the leaf character it came from
    whole: tuple[int, int] | None = None  # set for a decoded token: every character came from this leaf span

    def source(self, start: int, end: int) -> tuple[int, int]:
        """The leaf span that view span [start, end) was read from."""
        return self.whole or (self.origin[start], self.origin[end - 1] + 1)


_ASCII = str.maketrans("\t_", "  ")
_SPACED = re.compile(r"(?<!\S)\S(?: \S){5,}")  # s k - a n t - ...
_GROUPS = re.compile(r"\b(\d{3})[ .-](\d{2})[ .-](\d{4})\b")  # Presidio rejects an SSN with mixed separators
_TOKEN = re.compile(r"[A-Za-z0-9+/_-]{12,}={0,2}")
_URLSAFE = str.maketrans("-_", "+/")


def normalized(text: str) -> View:
    """NFKC; format characters such as zero-width spaces dropped; every dash a hyphen; tabs, Unicode spaces and
    underscores a plain space; runs of single spaced-out characters joined; 3-2-4 digit groups hyphenated."""
    if text.isascii():
        chars, origin = text.translate(_ASCII), range(len(text))
    else:
        out, index = [], []
        for i, c in enumerate(text):
            for n in unicodedata.normalize("NFKC", c):
                kind = unicodedata.category(n)
                if kind == "Cf":
                    continue
                out.append("-" if kind == "Pd" or n == "\u2212" else " " if kind == "Zs" or n in "\t_" else n)
                index.append(i)
        chars, origin = "".join(out), index
    if _SPACED.search(chars):
        out, index, last = [], [], 0
        for m in _SPACED.finditer(chars):
            out.append(chars[last:m.start()])
            index.extend(origin[last:m.start()])
            out.append(chars[m.start():m.end():2])
            index.extend(origin[m.start():m.end():2])
            last = m.end()
        out.append(chars[last:])
        index.extend(origin[last:])
        chars, origin = "".join(out), index
    return View(_GROUPS.sub(r"\1-\2-\3", chars), origin)


def compact(view: View) -> View:
    """The view with all whitespace removed, so a key broken by a space or a line break reads whole again."""
    keep = [i for i, c in enumerate(view.text) if not c.isspace()]
    return View("".join(view.text[i] for i in keep), [view.origin[i] for i in keep])


def decoded(text: str) -> list[View]:
    """Each base64 or base64url token in text that decodes to printable UTF-8, normalized."""
    views = []
    for m in _TOKEN.finditer(text):
        body = m.group().rstrip("=")
        if len(body) % 4 == 1:
            continue
        try:
            plain = base64.b64decode(body.translate(_URLSAFE) + "=" * (-len(body) % 4), validate=True).decode()
        except (binascii.Error, UnicodeDecodeError):
            continue
        if plain.strip() and plain.translate({9: None, 10: None, 13: None}).isprintable():
            views.append(View(normalized(plain).text, (), (m.start(), m.end())))
    return views
