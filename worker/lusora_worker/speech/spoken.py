"""The text the voice reads, per language, and the "spoken form" used to check
what it said (D115; Dark Palace's `fala.py`).

    prepare(text, lang)      -> the text sent to the TTS provider: loose symbols,
                                money, units, decimals, ranges and abbreviations
                                written the way they are said. Only the provider
                                gets it: the script, the captions and the word
                                timings keep the original words (align.py matches them).
    spoken_form(text, lang)  -> [tokens] lower case, no accents, numbers in
                                words. The script and what Whisper heard are both
                                turned into this, so "1.000" and "mil", "10" and
                                "dez" count as the same thing.
    is_number(token, lang)   -> a number word in that language ("duzentos", "twelve")

Measured by Dark Palace (80 cases heard back): the voice misreads a decimal
comma with a unit, money, a.C./d.C. and loose symbols; dates, times, ordinals,
roman numerals and acronyms come out right, so they stay. pt, es, en, fr, de
and it have their own tables; any other language gets the safe part (emoji,
loose symbols, "&"), and numbers in words through num2words where it knows the
language.
"""

from __future__ import annotations

import re
import unicodedata
from functools import lru_cache
from typing import Any

from .numbers import speakable_numbers


def base(lang: str | None) -> str:
    """'pt-BR' / 'pt_BR' / 'PT' -> 'pt'; empty -> 'en'."""
    return (lang or "en").strip().lower().replace("_", "-").split("-")[0] or "en"


_EMOJI = re.compile("[\U0001F000-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\uFE0F\u200D]")
_LOOSE_SYMBOL = re.compile(r"(?<!\S)[*_#|<>^~\\+=@/]+(?!\S)")


def _pair(one: str, many: str) -> tuple[str, str]:
    return (one, many)


# per language: decimal word and separators, "and", "to" (ranges), percent,
# degrees, units (singular, plural), currencies, how money joins a scale word,
# cents, scale words, abbreviations, num2words code
LANGUAGES = {
    "pt": dict(decimal="vírgula", dec_sep=",", thousands_sep=".", and_="e", to="a", percent="por cento", degrees="graus", of=" de ",
               cents=("centavo", "centavos"), scales=r"mil|milhão|milhões|bilhão|bilhões|trilhão|trilhões", n2w="pt_BR",
               units={"km/h": _pair("quilômetro por hora", "quilômetros por hora"), "km²": _pair("quilômetro quadrado", "quilômetros quadrados"),
                     "m²": _pair("metro quadrado", "metros quadrados"), "km": _pair("quilômetro", "quilômetros"),
                     "cm": _pair("centímetro", "centímetros"), "mm": _pair("milímetro", "milímetros"), "kg": _pair("quilo", "quilos"),
                     "ml": _pair("mililitro", "mililitros"), "min": _pair("minuto", "minutos"), "m": _pair("metro", "metros"),
                     "g": _pair("grama", "gramas"), "l": _pair("litro", "litros"), "h": _pair("hora", "horas"), "s": _pair("segundo", "segundos")},
               money={"R$": _pair("real", "reais"), "US$": _pair("dólar", "dólares"), "U$": _pair("dólar", "dólares"),
                      "€": _pair("euro", "euros"), "£": _pair("libra", "libras"), "$": _pair("dólar", "dólares")},
               abbreviations=[(r"\ba\.\s?C\.", "antes de Cristo"), (r"\bd\.\s?C\.", "depois de Cristo"), (r"\bp\.\s?ex\.", "por exemplo"),
                      (r"\bEx\.:", "Exemplo:"), (r"\bséc\.\s?", "século "), (r"\baprox\.", "aproximadamente"),
                      (r"\bn\.?º\s?(?=\d)", "número ")]),
    "es": dict(decimal="coma", dec_sep=",", thousands_sep=".", and_="y", to="a", percent="por ciento", degrees="grados", of=" de ",
               cents=("centavo", "centavos"), scales=r"mil|millón|millones|billón|billones", n2w="es",
               units={"km/h": _pair("kilómetro por hora", "kilómetros por hora"), "km²": _pair("kilómetro cuadrado", "kilómetros cuadrados"),
                     "m²": _pair("metro cuadrado", "metros cuadrados"), "km": _pair("kilómetro", "kilómetros"),
                     "cm": _pair("centímetro", "centímetros"), "mm": _pair("milímetro", "milímetros"), "kg": _pair("kilo", "kilos"),
                     "ml": _pair("mililitro", "mililitros"), "min": _pair("minuto", "minutos"), "m": _pair("metro", "metros"),
                     "g": _pair("gramo", "gramos"), "l": _pair("litro", "litros"), "h": _pair("hora", "horas"), "s": _pair("segundo", "segundos")},
               money={"US$": _pair("dólar", "dólares"), "U$": _pair("dólar", "dólares"), "R$": _pair("real", "reales"),
                      "€": _pair("euro", "euros"), "£": _pair("libra", "libras"), "$": _pair("dólar", "dólares")},
               abbreviations=[(r"\ba\.\s?C\.", "antes de Cristo"), (r"\bd\.\s?C\.", "después de Cristo"), (r"\bp\.\s?ej\.", "por ejemplo"),
                      (r"\baprox\.", "aproximadamente"), (r"\bn\.?º\s?(?=\d)", "número ")]),
    "en": dict(decimal="point", dec_sep=".", thousands_sep=",", and_="and", to="to", percent="percent", degrees="degrees", of=" ",
               cents=("cent", "cents"), scales=r"thousand|million|billion|trillion", n2w="en",
               units={"km/h": _pair("kilometer per hour", "kilometers per hour"), "mph": _pair("mile per hour", "miles per hour"),
                     "km²": _pair("square kilometer", "square kilometers"), "km": _pair("kilometer", "kilometers"),
                     "cm": _pair("centimeter", "centimeters"), "mm": _pair("millimeter", "millimeters"), "kg": _pair("kilogram", "kilograms"),
                     "lb": _pair("pound", "pounds"), "lbs": _pair("pound", "pounds"), "ft": _pair("foot", "feet"), "mi": _pair("mile", "miles"),
                     "ml": _pair("milliliter", "milliliters"), "min": _pair("minute", "minutes"), "m": _pair("meter", "meters"),
                     "g": _pair("gram", "grams"), "l": _pair("liter", "liters"), "h": _pair("hour", "hours"), "s": _pair("second", "seconds")},
               money={"US$": _pair("dollar", "dollars"), "R$": _pair("real", "reais"), "€": _pair("euro", "euros"),
                      "£": _pair("pound", "pounds"), "$": _pair("dollar", "dollars")},
               abbreviations=[(r"\be\.g\.", "for example"), (r"\bi\.e\.", "that is"), (r"\bapprox\.", "approximately"),
                      (r"\bvs\.", "versus"), (r"\bNo\.\s?(?=\d)", "number ")]),
    "fr": dict(decimal="virgule", dec_sep=",", thousands_sep=" ", and_="et", to="à", percent="pour cent", degrees="degrés", of=" de ", of_vowel=" d'",
               cents=("centime", "centimes"), scales=r"mille|millions?|milliards?", n2w="fr",
               units={"km/h": _pair("kilomètre par heure", "kilomètres par heure"), "km": _pair("kilomètre", "kilomètres"),
                     "cm": _pair("centimètre", "centimètres"), "mm": _pair("millimètre", "millimètres"), "kg": _pair("kilo", "kilos"),
                     "min": _pair("minute", "minutes"), "m": _pair("mètre", "mètres"), "g": _pair("gramme", "grammes"),
                     "l": _pair("litre", "litres"), "h": _pair("heure", "heures"), "s": _pair("seconde", "secondes")},
               money={"US$": _pair("dollar", "dollars"), "€": _pair("euro", "euros"), "£": _pair("livre", "livres"), "$": _pair("dollar", "dollars")},
               abbreviations=[(r"\bav\.\s?J\.-?C\.", "avant Jésus-Christ"), (r"\bapr\.\s?J\.-?C\.", "après Jésus-Christ"),
                      (r"\bp\.\s?ex\.", "par exemple"), (r"\benv\.", "environ")]),
    "de": dict(decimal="Komma", dec_sep=",", thousands_sep=".", and_="und", to="bis", percent="Prozent", degrees="Grad", of=" ",
               cents=("Cent", "Cent"), scales=r"Tausend|Millionen|Million|Milliarden|Milliarde", n2w="de",
               units={"km/h": _pair("Kilometer pro Stunde", "Kilometer pro Stunde"), "km": _pair("Kilometer", "Kilometer"),
                     "cm": _pair("Zentimeter", "Zentimeter"), "mm": _pair("Millimeter", "Millimeter"), "kg": _pair("Kilogramm", "Kilogramm"),
                     "min": _pair("Minute", "Minuten"), "m": _pair("Meter", "Meter"), "g": _pair("Gramm", "Gramm"),
                     "l": _pair("Liter", "Liter"), "h": _pair("Stunde", "Stunden"), "s": _pair("Sekunde", "Sekunden")},
               money={"US$": _pair("Dollar", "Dollar"), "€": _pair("Euro", "Euro"), "£": _pair("Pfund", "Pfund"), "$": _pair("Dollar", "Dollar")},
               abbreviations=[(r"\bv\.\s?Chr\.", "vor Christus"), (r"\bn\.\s?Chr\.", "nach Christus"), (r"\bz\.\s?B\.", "zum Beispiel"),
                      (r"\bu\.\s?a\.", "unter anderem"), (r"\bca\.", "circa")]),
    "it": dict(decimal="virgola", dec_sep=",", thousands_sep=".", and_="e", to="a", percent="per cento", degrees="gradi", of=" di ",
               cents=("centesimo", "centesimi"), scales=r"mila|milione|milioni|miliardo|miliardi", n2w="it",
               units={"km/h": _pair("chilometro orario", "chilometri orari"), "km": _pair("chilometro", "chilometri"),
                     "cm": _pair("centimetro", "centimetri"), "mm": _pair("millimetro", "millimetri"), "kg": _pair("chilo", "chili"),
                     "min": _pair("minuto", "minuti"), "m": _pair("metro", "metri"), "g": _pair("grammo", "grammi"),
                     "l": _pair("litro", "litri"), "h": _pair("ora", "ore"), "s": _pair("secondo", "secondi")},
               money={"US$": _pair("dollaro", "dollari"), "€": _pair("euro", "euro"), "£": _pair("sterlina", "sterline"), "$": _pair("dollaro", "dollari")},
               abbreviations=[(r"\ba\.\s?C\.", "avanti Cristo"), (r"\bd\.\s?C\.", "dopo Cristo"), (r"\bad\s?es\.", "ad esempio"),
                      (r"\bca\.", "circa")]),
}
_AND_ANYWHERE = {"pt": "e", "es": "y", "en": "and", "fr": "et", "de": "und", "it": "e", "nl": "en", "pl": "i", "ro": "și",
               "sv": "och", "da": "og", "no": "og", "tr": "ve", "id": "dan", "ru": "и", "uk": "і"}
# single letters are units only when they are clearly one (a space before, nothing glued after): "10 s" yes, "1980s" no,
# "10h30" no. In English "10m" is often "10 million", so there "m" needs the space too.


# single letters are units only when they clearly are one (a space before,
# nothing glued after): "10 s" yes, "1980s" no, "10h30" no. In English "10m" is
# often "10 million", so there "m" needs the space too.
_SINGLE_LETTER_UNITS = {"m", "g", "l", "h", "s"}


def _num(text: str, cfg: dict[str, Any]) -> int | float | None:
    """'1.250' / '1,250' / '1 250' -> 1250, or a float for '1,5' / '1.5'; None when it is not one number."""
    t = text.strip().replace("\u00a0", " ").replace("\u202f", " ")
    sd, sm = cfg["dec_sep"], cfg["thousands_sep"]
    if sm and sm != " ":
        if re.fullmatch(r"\d{1,3}(?:%s\d{3})+(?:%s\d+)?" % (re.escape(sm), re.escape(sd)), t):
            t = t.replace(sm, "")
    elif sm == " ":
        t = re.sub(r"(?<=\d) (?=\d{3}\b)", "", t)
    if sd in t:
        a, _, b = t.partition(sd)
        return float(a + "." + b) if a.isdigit() and b.isdigit() else None
    return int(t) if t.isdigit() else None


def _money(cfg: dict[str, Any]):
    symbols = "|".join(re.escape(s) for s in sorted(cfg["money"], key=len, reverse=True))
    num = r"\d{1,3}(?:[.,\u00a0\u202f ]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?"
    scales = cfg["scales"]
    before = re.compile(r"(?<![\w$])(%s)\s?(%s)(?:\s(%s)\b)?" % (symbols, num, scales), re.I)  # "R$ 1,5 milhão"
    after = re.compile(r"(?<![\w.,])(%s)(?:\s(%s))?\s?(%s)(?!\w)" % (num, scales, symbols), re.I)  # "20 €"

    def say(symbol: str, number: str, scale: str | None) -> str:
        one, many = cfg["money"].get(symbol) or cfg["money"].get(symbol.upper()) or ("", "")
        if scale:  # "R$ 1,5 milhão" -> "1,5 milhão de reais" (the decimal is said later)
            of = cfg.get("of_vowel", cfg["of"]) if _plain(many[:1].lower()) in "aeiouh" else cfg["of"]
            return f"{number} {scale}{of}{many}"
        n = _num(number, cfg)
        if isinstance(n, float):
            whole, _, cents = number.rpartition(cfg["dec_sep"])
            if len(cents) == 2 and cents.isdigit():  # "R$ 100,50" -> "100 reais e 50 centavos"; ",00" -> nothing
                w = _num(whole, cfg)
                w = w if isinstance(w, int) else whole
                out = f"{w} {one if w == 1 else many}"
                if cents != "00":
                    out += f" {cfg['and_']} {int(cents)} {cfg['cents'][0] if cents == '01' else cfg['cents'][1]}"
                return out
            return f"{number} {many}"  # "R$ 1,5" -> "1,5 reais" (the decimal rule says the comma)
        return f"{n if n is not None else number} {one if n == 1 else many}"

    return before, after, say


@lru_cache(maxsize=None)
def _rules(lb: str):
    cfg = LANGUAGES.get(lb)
    if not cfg:
        return None
    before, after, say_money = _money(cfg)
    units = sorted(cfg["units"], key=len, reverse=True)
    multi = "|".join(re.escape(u) for u in units if u not in _SINGLE_LETTER_UNITS)
    single = "|".join(re.escape(u) for u in units if u in _SINGLE_LETTER_UNITS)
    rx_multi = re.compile(r"(\d)\s?(%s)(?![\wº°/²])" % multi, re.I) if multi else None
    # "m" glued is fine ("9,8m") except in English; the other single letters always need the space
    rx_single = re.compile(r"(\d)(\s)(%s)(?![\wº°/²'’])" % single) if single else None
    rx_m_glued = re.compile(r"(\d)(m)(?![\wº°/²'’])") if lb != "en" else None
    return cfg, before, after, say_money, rx_multi, rx_single, rx_m_glued


def prepare(text: str, lang: str | None) -> str:
    """The text the voice reads (line breaks kept)."""
    t = text or ""
    t = _EMOJI.sub(" ", t)
    t = _LOOSE_SYMBOL.sub(" ", t)
    lb = base(lang)
    if lb in ("pt", "es", "en"):
        # the measured number rules first ("R$ 15 mi" -> "15 milhões de reais",
        # "15.000.000" -> "15 milhões", "2.750" -> "2 mil 750", "2 pessoas" ->
        # "duas pessoas"); these follow. Only these three languages: elsewhere
        # the number pass would read "3,5" the English way
        t = speakable_numbers(t, lb)
    t = re.sub(r"(?<!\S)&(?!\S)", _AND_ANYWHERE.get(lb, "&"), t)
    r = _rules(lb)
    if r:
        cfg, before, after, say_money, rx_multi, rx_single, rx_m_glued = r
        for rx, new in cfg["abbreviations"]:
            if re.search(r"Crist|Christ", new):  # "... em 800 d.C." ends a sentence: its dot was the full stop too
                t = re.sub(rx + r"(?=\s*$|\s*\n|\s+[A-ZÀ-ÖØ-Þ])", new + ".", t)
            t = re.sub(rx, new, t)
        t = before.sub(lambda m: say_money(m.group(1), m.group(2), m.group(3)), t)
        t = after.sub(lambda m: say_money(m.group(3), m.group(1), m.group(2)), t)
        # ranges: "2–12" / "1939-1945" -> "2 a 12" (a plain hyphen only between small numbers or two years)
        t = re.sub(r"(?<![\d.,])(\d{1,4})\s?[–—]\s?(\d{1,4})(?![\d\-]|[.,]\d)", r"\1 %s \2" % cfg["to"], t)
        t = re.sub(r"(?<![\d.,\-])(\d{1,3})-(\d{1,3})(?![\d\-]|[.,]\d)", r"\1 %s \2" % cfg["to"], t)
        t = re.sub(r"(?<![\d.,\-])(1\d{3}|2[01]\d{2})-(1\d{3}|2[01]\d{2})(?![\d\-]|[.,]\d)", r"\1 %s \2" % cfg["to"], t)
        if cfg["dec_sep"] == ",":  # "9,8" -> "9 vírgula 8" (never a thousands group like 1.000)
            t = re.sub(r"(?<![\d.,])(\d{1,3}),(\d{1,2})(?![\d])", r"\1 %s \2" % cfg["decimal"], t)
        t = re.sub(r"(\d)\s?%", r"\1 " + cfg["percent"], t)
        t = re.sub(r"(\d)\s?°\s?C\b", r"\1 %s Celsius" % cfg["degrees"], t)
        t = re.sub(r"(\d)\s?°\s?F\b", r"\1 %s Fahrenheit" % cfg["degrees"], t)

        def unit(m: re.Match, g_num: int, g_unit: int) -> str:
            u = m.group(g_unit).lower() if m.group(g_unit).lower() in cfg["units"] else m.group(g_unit)
            one, many = cfg["units"][u]
            before_it = current[max(0, m.start() - 14):m.start() + 1]
            single = m.group(g_num) == "1" and not re.search(r"\d\s*(?:%s|[.,])\s*1$" % re.escape(cfg["decimal"]), before_it)
            return f"{m.group(g_num)} {one if single else many}"

        current = t
        if rx_multi:
            t = rx_multi.sub(lambda m: unit(m, 1, 2), t)
            current = t
        if rx_single:
            t = rx_single.sub(lambda m: unit(m, 1, 3), t)
            current = t
        if rx_m_glued:
            t = rx_m_glued.sub(lambda m: unit(m, 1, 2), t)
    return re.sub(r"[ \t]{2,}", " ", t).strip()


# ---------------- the spoken form (to compare the voice with the script) ----------------


def _plain(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def _n2w(n: int | float, lb: str) -> str | None:
    cfg = LANGUAGES.get(lb)
    code = cfg["n2w"] if cfg else lb
    try:
        from num2words import num2words
        return num2words(n, lang=code)
    except Exception:  # noqa: BLE001 - a language num2words does not know: keep the digits
        return None


def _year(n: int) -> str | None:
    try:
        from num2words import num2words
        return num2words(n, lang="en", to="year")
    except Exception:  # noqa: BLE001
        return None


_GENDER = {"pt": {"uma": "um", "duas": "dois"}, "es": {"una": "uno", "un": "uno"}, "it": {"una": "uno", "un": "uno"},
           "fr": {"une": "un"}, "de": {"eine": "ein", "eins": "ein"}}


def _gender(token: str, lb: str) -> str:
    token = _GENDER.get(lb, {}).get(token, token)
    if lb == "pt" and token.endswith("entas"):
        token = token[:-5] + "entos"
    if lb == "es" and token.endswith("ientas"):
        token = token[:-6] + "ientos"
    return token


def spoken_form(text: str, lang: str | None) -> list[str]:
    lb = base(lang)
    cfg = LANGUAGES.get(lb) or {"dec_sep": ".", "thousands_sep": ","}
    t = prepare(text, lang)
    num = r"\d{1,3}(?:[%s]\d{3})+(?:[%s]\d+)?|\d+(?:[%s]\d+)?" % (
        re.escape(cfg["thousands_sep"] or ","), re.escape(cfg["dec_sep"]), re.escape(cfg["dec_sep"]))

    def in_words(m: re.Match) -> str:
        n = _num(m.group(0), cfg) if lb in LANGUAGES else (int(m.group(0)) if m.group(0).isdigit() else None)
        if lb == "en" and isinstance(n, int) and m.group(0).isdigit() and 1100 <= n <= 2099:
            # D115, a change from Dark Palace: English says a year "nineteen
            # sixty-two", so a take that did must not count as a slip against
            # "one thousand, nine hundred and sixty-two"
            w = _year(n)
        else:
            w = _n2w(n, lb) if n is not None else None
        return f" {w} " if w else m.group(0)

    t = re.sub(num, in_words, t)
    t = _plain(t.lower())
    t = re.sub(r"[^\w\s]", " ", t)
    return [_gender(x, lb) for x in t.split()]


@lru_cache(maxsize=None)
def _number_words(lb: str) -> re.Pattern:
    vocab: set[str] = set()
    for n in list(range(0, 101)) + list(range(100, 1001, 100)) + [1000, 2000, 10 ** 6, 2 * 10 ** 6, 10 ** 9, 2 * 10 ** 9]:
        w = _n2w(n, lb)
        if w:
            vocab.update(_gender(x, lb) for x in re.sub(r"[^\w\s]", " ", _plain(w.lower())).split())
    cfg = LANGUAGES.get(lb)
    if cfg:
        vocab.update(_plain(x.lower()) for x in (cfg["decimal"], cfg["and_"]))
    for extra in ("mil", "milhao", "milhoes", "bilhao", "bilhoes", "millon", "millones", "million", "billion",
                  "thousand", "hundred", "cento", "cem", "e", "y", "and"):
        vocab.add(extra)
    vocab = {v for v in vocab if v}
    return re.compile("(?:%s)+" % "|".join(re.escape(v) for v in sorted(vocab, key=len, reverse=True)))


def is_number(token: str, lang: str | None) -> bool:
    """Digits, or a number word of that language (compound ones too: German and Italian glue them)."""
    lb = base(lang)
    t = _gender(_plain((token or "").lower()), lb)
    return t.isdigit() or bool(_number_words(lb).fullmatch(t))
