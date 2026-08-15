"""Script <-> narration text matching (pt-BR and en).

The script is the validated source of truth; the narration text the
compiler aligns against — a Whisper transcript, hand-authored captions,
or the TTS adapter's chunks — is only a TIMING source. The two routinely
disagree on how the same spoken words are WRITTEN, and none of those
disagreements is a content divergence:

  written           spoken/transcribed         handled by
  1945              nineteen forty-five        number runs (year form)
  50%               cinquenta por cento        number runs + SKIPPABLE
  20 mil            20,000 / twenty thousand   number runs (scales)
  3.5               three point five           number runs (decimals)
  os anos 1950      os anos 50 / nineteen-fifties  number runs (decades)
  Seculo XX         seculo vinte               roman numerals
  20th century      twentieth century          ordinals
  Estevao / cafe    Estêvão / café             diacritic folding
  state-of-the-art  state of the art           dash splitting

Everything here only ever ADDS a match; a genuine wording divergence
("read" vs "burned") still fails the compile loud. Coverage is
deliberately finite: see the module tests for the exact contract, and
`docs/03-contracts/beat-sheet.md` for what remains unhandled.
"""

from __future__ import annotations

import re
import unicodedata

_NON_ALNUM = re.compile(r"[^a-z0-9]")
_SPLIT_CHARS = re.compile(r"[-–—/]+")
_DIGITS_ONLY = re.compile(r"^\d+$")
_DECADE_DIGITS = re.compile(r"^(\d+)s$")
_ORDINAL_DIGITS = re.compile(r"^(\d+)(?:st|nd|rd|th|o|a|os|as)$")
_GROUPED = re.compile(r"^\d{1,3}(?:[.,]\d{3})+$")
_DECIMAL = re.compile(r"^(\d+)[.,](\d+)$")
_CLOCK = re.compile(r"^(\d{1,2}):(\d{2})$")
_ROMAN = re.compile(r"^[IVXLCDM]{2,}$")
_ROMAN_VALUES = {"i": 1, "v": 5, "x": 10, "l": 50, "c": 100, "d": 500, "m": 1000}


def fold(word: str) -> str:
    """Comparison form: lowercase, diacritics folded, punctuation dropped.

    Folding (not deleting) the diacritics matters: Whisper and a human
    typing a script disagree about accents constantly, and deleting the
    accented letter outright turned 'coração' into 'corao' while the
    transcript's 'coracao' stayed intact — two spellings of one word that
    could never match."""
    w = unicodedata.normalize("NFKD", word.lower())
    w = "".join(c for c in w if not unicodedata.combining(c))
    return _NON_ALNUM.sub("", w)


_CURRENCY = re.compile(r"^(?:us|r|c|a|nz)?\$$", re.I)

#: Written and spoken forms of the same word, folded to one key. Both
#: directions matter: the script may abbreviate what the narration spells
#: out, or the transcript may abbreviate what the script spelled out.
_EQUIVALENTS = {
    "dr": "@dr", "doutor": "@dr", "doctor": "@dr",
    "dra": "@dra", "doutora": "@dra",
    "sr": "@sr", "senhor": "@sr", "mr": "@sr", "mister": "@sr",
    "sra": "@sra", "senhora": "@sra", "mrs": "@sra",
    "prof": "@prof", "professor": "@prof",
    "vs": "@vs", "versus": "@vs",
    "etc": "@etc", "etcetera": "@etc",
    "km": "@km", "quilometros": "@km", "quilometro": "@km",
    "kilometers": "@km", "kilometres": "@km", "kilometer": "@km",
    "kg": "@kg", "quilos": "@kg", "quilogramas": "@kg", "kilograms": "@kg",
}


def compare_key(word: str) -> str:
    """The form two tokens are compared by: folded, with known
    written/spoken pairs ('Dr.' / 'doutor') collapsed onto one key."""
    w = fold(word)
    return _EQUIVALENTS.get(w, w)


def tokenize(text: str) -> list[str]:
    """Split into comparable tokens, raw form preserved (the number
    parser needs the digits, casing and separators that `fold` strips).

    Hyphens, dashes and slashes split: whether 'state-of-the-art' or an
    em-dash-joined 'guerra—a' is one written token or four spoken words is
    a typography choice, not a wording difference. Number compounds
    ('forty-seven') split too and are put back together by the run
    parser."""
    out: list[str] = []
    for raw in text.split():
        for part in _SPLIT_CHARS.split(raw):
            # 'R$'/'US$' survive folding as letters but are read aloud as
            # the currency name, which lands elsewhere in the sentence
            if _CURRENCY.match(part.strip(".,;:!?()[]")):
                continue
            if fold(part):
                out.append(part)
    return out


# ---------------- number words ----------------

_UNITS = {
    # en
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
    "seventeen": 17, "eighteen": 18, "nineteen": 19,
    # pt (folded: no accents)
    "um": 1, "uma": 1, "dois": 2, "duas": 2, "tres": 3, "quatro": 4, "cinco": 5,
    "seis": 6, "sete": 7, "oito": 8, "nove": 9, "dez": 10, "onze": 11, "doze": 12,
    "treze": 13, "catorze": 14, "quatorze": 14, "quinze": 15, "dezesseis": 16,
    "dezasseis": 16, "dezessete": 17, "dezassete": 17, "dezoito": 18,
    "dezenove": 19, "dezanove": 19,
}
_TENS = {
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60,
    "seventy": 70, "eighty": 80, "ninety": 90,
    "vinte": 20, "trinta": 30, "quarenta": 40, "cinquenta": 50, "sessenta": 60,
    "setenta": 70, "oitenta": 80, "noventa": 90,
}
_HUNDREDS = {
    "cem": 100, "cento": 100, "duzentos": 200, "duzentas": 200,
    "trezentos": 300, "trezentas": 300, "quatrocentos": 400, "quatrocentas": 400,
    "quinhentos": 500, "quinhentas": 500, "seiscentos": 600, "seiscentas": 600,
    "setecentos": 700, "setecentas": 700, "oitocentos": 800, "oitocentas": 800,
    "novecentos": 900, "novecentas": 900,
}
_SCALES = {
    "thousand": 1_000, "million": 1_000_000, "billion": 1_000_000_000,
    "mil": 1_000, "milhao": 1_000_000, "milhoes": 1_000_000,
    "bilhao": 1_000_000_000, "bilhoes": 1_000_000_000,
}
_DECADES = {
    "twenties": 20, "thirties": 30, "forties": 40, "fifties": 50,
    "sixties": 60, "seventies": 70, "eighties": 80, "nineties": 90,
}
_ORDINALS = {
    "first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5, "sixth": 6,
    "seventh": 7, "eighth": 8, "ninth": 9, "tenth": 10, "eleventh": 11,
    "twelfth": 12, "thirteenth": 13, "fourteenth": 14, "fifteenth": 15,
    "sixteenth": 16, "seventeenth": 17, "eighteenth": 18, "nineteenth": 19,
    "twentieth": 20, "thirtieth": 30, "fortieth": 40, "fiftieth": 50,
    "sixtieth": 60, "seventieth": 70, "eightieth": 80, "ninetieth": 90,
    "hundredth": 100, "thousandth": 1000,
    "primeiro": 1, "primeira": 1, "segundo": 2, "segunda": 2, "terceiro": 3,
    "terceira": 3, "quarto": 4, "quarta": 4, "quinto": 5, "quinta": 5,
    "sexto": 6, "sexta": 6, "setimo": 7, "setima": 7, "oitavo": 8, "oitava": 8,
    "nono": 9, "nona": 9, "decimo": 10, "decima": 10, "centesimo": 100,
    "centesima": 100, "milesimo": 1000, "milesima": 1000,
}
_CONNECTORS = {"and", "e"}
_POINTS = {"point", "ponto", "virgula", "comma"}

#: Written-vs-spoken filler that may be SKIPPED on the script side when it
#: finds no match: unit and currency names the other side rendered as a
#: bare symbol ('50%' vs 'cinquenta por cento'). Function words and unit
#: names only — never a content word.
SKIPPABLE = {
    "percent", "cento", "por", "per", "cent", "porcento",
    "dollars", "dollar", "dolares", "dolar", "reais", "euros", "euro",
    "pounds", "libras", "cents", "centavos",
    "degrees", "graus", "degree", "grau",
    "@km", "@kg", "mi", "ft", "kmh", "mph", "ha", "mm", "cm", "kwh", "hz",
}


_FUNCTION_WORDS = {
    "de", "da", "do", "dos", "das", "em", "no", "na", "e", "a", "o", "os", "as",
    "the", "of", "and", "to", "in", "at", "on", "for",
}


def is_filler(word: str) -> bool:
    """True for words that carry no content on their own: the spoken form
    of a written symbol, or a function word. Used only to decide whether a
    handful of UNMATCHED narration words is worth failing a compile over —
    'de dolares' after a '$5' is not, 'uncovered tail' is."""
    w = compare_key(word)
    return w in SKIPPABLE or w in _FUNCTION_WORDS


def _roman_value(raw: str) -> int | None:
    """Roman numeral -> int, uppercase and 2+ chars only. Bare 'I'/'X'/'C'
    are left alone: the English pronoun and stray initials are far more
    common than a one-letter numeral."""
    if not _ROMAN.match(raw):
        return None
    values = [_ROMAN_VALUES[c.lower()] for c in raw]
    total = 0
    for i, v in enumerate(values):
        total += -v if i + 1 < len(values) and v < values[i + 1] else v
    return total


def _classify(raw: str) -> tuple[str, object] | None:
    """One token -> its role in a number run, or None if it isn't part of
    one. Digit forms carry their own candidate set (a written '1.200' is
    both 1200 and 1.2 depending on the locale that typed it)."""
    w = fold(raw)
    if not w:
        return None
    # separators first: folding strips them, and '3.5' must not read as 35
    bare = raw.strip("()[]\"'“”‘’.,;:!?")
    if _GROUPED.match(bare):
        return ("keys", frozenset({str(int(re.sub(r"[.,]", "", bare)))}))
    if m := _DECIMAL.match(bare):
        whole, frac = m.groups()
        return ("keys", frozenset({f"{int(whole)}.{frac}", f"{whole}{frac}"}))
    if m := _CLOCK.match(bare):
        h, mi = int(m.group(1)), int(m.group(2))
        return ("keys", frozenset({f"{h}:{mi:02d}", f"{h}{mi:02d}"}))
    if _DIGITS_ONLY.match(w):
        return ("num", int(w))
    if m := _DECADE_DIGITS.match(w):
        return ("decade_digits", int(m.group(1)))
    if m := _ORDINAL_DIGITS.match(w):
        return ("num", int(m.group(1)))
    if (v := _roman_value(bare)) is not None:
        return ("num", v)
    if w in _UNITS:
        return ("num", _UNITS[w])
    if w in _TENS:
        return ("num", _TENS[w])
    if w in _ORDINALS:
        return ("num", _ORDINALS[w])
    if w in _HUNDREDS:
        return ("hundreds", _HUNDREDS[w])
    if w == "hundred":
        return ("hundred", 100)
    if w in _SCALES:
        return ("scale", _SCALES[w])
    if w in _DECADES:
        return ("decade", _DECADES[w])
    if w in _POINTS:
        return ("point", 0)
    if w in _CONNECTORS:
        return ("connector", 0)
    return None


def _decade_keys(value: int) -> frozenset[str]:
    """'1950s' and 'os anos 50' name the same decade."""
    short = value % 100
    return frozenset({f"{value}s", str(value), f"{short}s", str(short)})


def _interpret(items: list[tuple[str, object]]) -> frozenset[str]:
    """A run of number roles -> every value it could be written as."""
    kinds = [k for k, _ in items]
    if kinds[0] == "keys":
        # a self-describing written form (1,200 / 3.5 / 9:30) stands alone
        return items[0][1]  # type: ignore[return-value]
    if kinds[0] == "decade_digits":
        return _decade_keys(int(items[0][1]))  # type: ignore[arg-type]

    if kinds[-1] == "decade":
        head = [i for i in items[:-1] if i[0] == "num"]
        base = int(items[-1][1])  # type: ignore[arg-type]
        if len(head) == 1 and 10 <= int(head[0][1]) <= 99:  # type: ignore[arg-type]
            return _decade_keys(int(head[0][1]) * 100 + base)  # type: ignore[arg-type]
        return _decade_keys(base) if not head else frozenset()

    if "point" in kinds:
        cut = kinds.index("point")
        left = _interpret(items[:cut]) if cut else frozenset({"0"})
        right = "".join(str(v) for k, v in items[cut + 1 :] if k == "num")
        if len(left) != 1 or not right:
            return frozenset()
        return frozenset({f"{next(iter(left))}.{right}"})

    total = 0
    current = 0
    for kind, value in items:
        v = int(value)  # type: ignore[arg-type]
        if kind in ("num", "hundreds"):
            current += v
        elif kind == "hundred":
            current = (current or 1) * 100
        elif kind == "scale":
            total += (current or 1) * v
            current = 0
    total += current
    keys = {str(total)}

    # 'nineteen forty-five' = 1945, not 64; 'nine thirty' = 9:30, not 39
    nums = [int(v) for k, v in items if k == "num"]  # type: ignore[arg-type]
    if len(nums) >= 2 and set(kinds) <= {"num", "connector"}:
        head, rest = nums[0], sum(nums[1:])
        if 10 <= head <= 99 and 0 <= rest <= 99:
            keys.add(str(head * 100 + rest))
        if 0 <= head <= 23 and 0 <= rest <= 59:
            keys.add(f"{head}:{rest:02d}")
    return frozenset(keys)


_DECADE_CONTEXT = {"anos", "decada", "decadas", "years", "decade", "decades"}


def decade_context(keys: frozenset[str], previous: str | None) -> frozenset[str]:
    """'os anos 1950' and 'os anos 50' name the same decade — but only
    behind an 'anos'/'years'. Standing alone, 1950 and 50 are just two
    different numbers and must not match."""
    if previous is None or fold(previous) not in _DECADE_CONTEXT:
        return keys
    extra = set(keys)
    for k in keys:
        if not k.isdigit():
            continue
        v = int(k)
        if 1000 <= v <= 2999 and v % 10 == 0:
            extra.add(str(v % 100))
        elif 20 <= v <= 99:
            extra.update({str(1900 + v), str(2000 + v)})
    return frozenset(extra)


def number_run(tokens: list[str], i: int) -> tuple[int, frozenset[str]]:
    """Longest number run starting at `tokens[i]` -> (tokens consumed,
    candidate values). (0, empty) when the token doesn't start a number.

    Candidates rather than one canonical value because a spoken run is
    genuinely ambiguous — 'nineteen forty-five' is a year to a human and
    64 to an adder — and the two sides match if any candidate agrees."""
    items: list[tuple[str, object]] = []
    j = i
    while j < len(tokens):
        role = _classify(tokens[j])
        if role is None:
            break
        # self-contained written forms don't combine with neighbours
        if role[0] in ("keys", "decade_digits"):
            if items:
                break
            items.append(role)
            j += 1
            break
        items.append(role)
        j += 1
    # never end on a dangling connector/point ('two and the rest')
    while items and items[-1][0] in ("connector", "point"):
        items.pop()
        j -= 1
    if not items or all(k in ("connector", "point") for k, _ in items):
        return 0, frozenset()
    return j - i, _interpret(items)
