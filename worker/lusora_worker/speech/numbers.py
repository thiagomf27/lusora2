"""Numbers and money as the voice should READ them (D115; Dark Palace's `falavel.py`).

Only the text sent to the TTS provider changes: the script, the captions and
the word timings keep what was written (align.py matches the two).

Measured by Dark Palace with a Portuguese voice and a transcription of what it
said (2026-09-26):
    "15 milhões de reais", "3,5 bilhões de dólares"   read right  (number + scale word)
    "R$ 15 milhões"      -> "15 milhões"               the currency was dropped
    "R$ 15 mi"           -> "R$ 15 mil"                million became thousand
    "15.000.000 de reais"-> "15 mil mil de reais"      big numbers with separators misread
    "15000000"           -> garbled                    big plain digits too
So big numbers become "<number> <scale word>", a currency symbol or code (before
or after the amount) becomes the currency's name after it, abbreviations (mi,
bi, M, B, k) are spelled out and cents are said as cents. Years and small
numbers are left alone (they are read right).

A second round (three takes of each form, two Whisper models) decided the rest:
"2.750" becomes "2 mil 750"; digits stay digits (a whole script in words made
the voice repeat and invent numbers); and only a number whose words change with
a feminine noun is written in words ("duas pessoas", "duzentas moedas").

    speakable_numbers(text, lang) -> text
"""

from __future__ import annotations

import re

from .words import in_words, is_feminine

SCALES = {
    "pt": [(10 ** 12, "trilhão", "trilhões"), (10 ** 9, "bilhão", "bilhões"), (10 ** 6, "milhão", "milhões"), (10 ** 3, "mil", "mil")],
    "es": [(10 ** 12, "billón", "billones"), (10 ** 9, "mil millones", "mil millones"), (10 ** 6, "millón", "millones"),
           (10 ** 3, "mil", "mil")],
    "en": [(10 ** 12, "trillion", "trillion"), (10 ** 9, "billion", "billion"), (10 ** 6, "million", "million"),
           (10 ** 3, "thousand", "thousand")],
}
# scale words and abbreviations after an amount (looked up in lower case)
ABBREVIATIONS = {
    "pt": {"mil": 10 ** 3, "mi": 10 ** 6, "bi": 10 ** 9, "tri": 10 ** 12, "milhão": 10 ** 6, "milhões": 10 ** 6, "milhao": 10 ** 6,
           "milhoes": 10 ** 6, "bilhão": 10 ** 9, "bilhões": 10 ** 9, "bilhao": 10 ** 9, "bilhoes": 10 ** 9, "trilhão": 10 ** 12,
           "trilhões": 10 ** 12, "trilhao": 10 ** 12, "trilhoes": 10 ** 12},
    "es": {"mil": 10 ** 3, "millón": 10 ** 6, "millones": 10 ** 6, "millon": 10 ** 6, "mil millones": 10 ** 9, "billón": 10 ** 12,
           "billones": 10 ** 12, "billon": 10 ** 12},
    "en": {"thousand": 10 ** 3, "million": 10 ** 6, "billion": 10 ** 9, "trillion": 10 ** 12},
}
LETTER_SCALES = {"k": 10 ** 3, "m": 10 ** 6, "mm": 10 ** 6, "mn": 10 ** 6, "b": 10 ** 9, "bn": 10 ** 9, "t": 10 ** 12}   # "$5m", "US$ 3 MM"
# amount + abbreviation with NO currency: only the unambiguous ones ("15m" can be metres, "3t" tonnes)
WITHOUT_CURRENCY = {"pt": r"(?i:mi|bi|tri)|k|K|M", "es": r"k|K|M|MM", "en": r"k|K|M|B|bn|mn"}

# currency -> its name in each language (singular, plural)
CURRENCY_NAMES = {
    "brl": {"pt": ("real", "reais"), "es": ("real", "reales"), "en": ("real", "reais")},
    "usd": {"pt": ("dólar", "dólares"), "es": ("dólar", "dólares"), "en": ("dollar", "dollars")},
    "eur": {"pt": ("euro", "euros"), "es": ("euro", "euros"), "en": ("euro", "euros")},
    "gbp": {"pt": ("libra", "libras"), "es": ("libra", "libras"), "en": ("pound", "pounds")},
    "jpy": {"pt": ("iene", "ienes"), "es": ("yen", "yenes"), "en": ("yen", "yen")},
    "cny": {"pt": ("yuan", "yuans"), "es": ("yuan", "yuanes"), "en": ("yuan", "yuan")},
    "pln": {"pt": ("zlóti", "zlótis"), "es": ("esloti", "eslotis"), "en": ("zloty", "zlotys")},
    "chf": {"pt": ("franco suíço", "francos suíços"), "es": ("franco suizo", "francos suizos"), "en": ("Swiss franc", "Swiss francs")},
    "rub": {"pt": ("rublo", "rublos"), "es": ("rublo", "rublos"), "en": ("ruble", "rubles")},
    "inr": {"pt": ("rupia", "rupias"), "es": ("rupia", "rupias"), "en": ("rupee", "rupees")},
    "krw": {"pt": ("won", "wons"), "es": ("won", "wones"), "en": ("won", "won")},
    "ils": {"pt": ("shekel", "shekels"), "es": ("séquel", "séqueles"), "en": ("shekel", "shekels")},
    "try": {"pt": ("lira turca", "liras turcas"), "es": ("lira turca", "liras turcas"), "en": ("Turkish lira", "Turkish lira")},
    "uah": {"pt": ("hryvnia", "hryvnias"), "es": ("grivna", "grivnas"), "en": ("hryvnia", "hryvnias")},
    "mxn": {"pt": ("peso mexicano", "pesos mexicanos"), "es": ("peso mexicano", "pesos mexicanos"), "en": ("Mexican peso", "Mexican pesos")},
    "ars": {"pt": ("peso argentino", "pesos argentinos"), "es": ("peso argentino", "pesos argentinos"),
            "en": ("Argentine peso", "Argentine pesos")},
    "clp": {"pt": ("peso chileno", "pesos chilenos"), "es": ("peso chileno", "pesos chilenos"), "en": ("Chilean peso", "Chilean pesos")},
    "cop": {"pt": ("peso colombiano", "pesos colombianos"), "es": ("peso colombiano", "pesos colombianos"),
            "en": ("Colombian peso", "Colombian pesos")},
    "pen": {"pt": ("sol", "soles"), "es": ("sol", "soles"), "en": ("sol", "soles")},
    "cad": {"pt": ("dólar canadense", "dólares canadenses"), "es": ("dólar canadiense", "dólares canadienses"),
            "en": ("Canadian dollar", "Canadian dollars")},
    "aud": {"pt": ("dólar australiano", "dólares australianos"), "es": ("dólar australiano", "dólares australianos"),
            "en": ("Australian dollar", "Australian dollars")},
    "zar": {"pt": ("rand", "rands"), "es": ("rand", "rands"), "en": ("rand", "rand")},
    "sek": {"pt": ("coroa sueca", "coroas suecas"), "es": ("corona sueca", "coronas suecas"), "en": ("Swedish krona", "Swedish kronor")},
    "nok": {"pt": ("coroa norueguesa", "coroas norueguesas"), "es": ("corona noruega", "coronas noruegas"),
            "en": ("Norwegian krone", "Norwegian kroner")},
    "dkk": {"pt": ("coroa dinamarquesa", "coroas dinamarquesas"), "es": ("corona danesa", "coronas danesas"),
            "en": ("Danish krone", "Danish kroner")},
    "kr": {"pt": ("coroa", "coroas"), "es": ("corona", "coronas"), "en": ("krona", "kronor")},
    "czk": {"pt": ("coroa tcheca", "coroas tchecas"), "es": ("corona checa", "coronas checas"), "en": ("Czech koruna", "Czech korunas")},
    "huf": {"pt": ("forint", "forints"), "es": ("forinto", "forintos"), "en": ("forint", "forints")},
    "btc": {"pt": ("bitcoin", "bitcoins"), "es": ("bitcoin", "bitcoins"), "en": ("bitcoin", "bitcoins")},
    # Brazil's old currencies (case matters: CR$ is the cruzeiro real, Cr$ the cruzeiro)
    "crr": {"pt": ("cruzeiro real", "cruzeiros reais"), "es": ("cruzeiro real", "cruzeiros reales"),
            "en": ("cruzeiro real", "cruzeiros reais")},
    "crz": {"pt": ("cruzeiro", "cruzeiros"), "es": ("cruzeiro", "cruzeiros"), "en": ("cruzeiro", "cruzeiros")},
    "czd": {"pt": ("cruzado", "cruzados"), "es": ("cruzado", "cruzados"), "en": ("cruzado", "cruzados")},
    "ncz": {"pt": ("cruzado novo", "cruzados novos"), "es": ("cruzado novo", "cruzados novos"), "en": ("cruzado novo", "cruzados novos")},
}
CODES = {"BRL": "brl", "USD": "usd", "EUR": "eur", "GBP": "gbp", "JPY": "jpy", "CNY": "cny", "RMB": "cny", "PLN": "pln",
           "CHF": "chf", "RUB": "rub", "INR": "inr", "KRW": "krw", "ILS": "ils", "TRY": "try", "UAH": "uah", "MXN": "mxn",
           "ARS": "ars", "CLP": "clp", "COP": "cop", "PEN": "pen", "CAD": "cad", "AUD": "aud", "ZAR": "zar", "SEK": "sek",
           "NOK": "nok", "DKK": "dkk", "CZK": "czk", "HUF": "huf", "BTC": "btc"}
BEFORE = {"R$": "brl", "US$": "usd", "U$": "usd", "$": "usd", "€": "eur", "£": "gbp", "¥": "jpy", "CN¥": "cny", "₽": "rub",
         "₹": "inr", "₩": "krw", "₪": "ils", "₺": "try", "₴": "uah", "MX$": "mxn", "AR$": "ars", "CLP$": "clp", "COL$": "cop",
         "S/": "pen", "C$": "cad", "CA$": "cad", "A$": "aud", "AU$": "aud", "₿": "btc", "CR$": "crr", "Cr$": "crz", "Cz$": "czd",
         "NCz$": "ncz", **CODES}
AFTER = {"zł": "pln", "€": "eur", "kr": "kr", "Kč": "czk", "Ft": "huf", "₽": "rub", "₴": "uah", "₺": "try", "₹": "inr", **CODES}
HAS_CENTS = {"brl", "usd", "eur", "mxn", "ars", "cad", "aud", "cop", "clp"}
CENTS = {"pt": ("centavo", "centavos", " e "), "es": ("centavo", "centavos", " con "), "en": ("cent", "cents", " and ")}
LETTER = r"A-Za-zÀ-ÿĀ-ſ"

# units after a number (the voice said "mel cudo" for m³ and garbled °C): unit -> {lang: (singular, plural)}
UNITS = {
    "km²": {"pt": ("quilômetro quadrado", "quilômetros quadrados"), "es": ("kilómetro cuadrado", "kilómetros cuadrados"),
            "en": ("square kilometer", "square kilometers")},
    "m²": {"pt": ("metro quadrado", "metros quadrados"), "es": ("metro cuadrado", "metros cuadrados"), "en": ("square meter", "square meters")},
    "km³": {"pt": ("quilômetro cúbico", "quilômetros cúbicos"), "es": ("kilómetro cúbico", "kilómetros cúbicos"),
            "en": ("cubic kilometer", "cubic kilometers")},
    "m³": {"pt": ("metro cúbico", "metros cúbicos"), "es": ("metro cúbico", "metros cúbicos"), "en": ("cubic meter", "cubic meters")},
    "km/h": {"pt": ("quilômetro por hora", "quilômetros por hora"), "es": ("kilómetro por hora", "kilómetros por hora"),
             "en": ("kilometer per hour", "kilometers per hour")},
    "mph": {"pt": ("milha por hora", "milhas por hora"), "es": ("milla por hora", "millas por hora"), "en": ("mile per hour", "miles per hour")},
    "km": {"pt": ("quilômetro", "quilômetros"), "es": ("kilómetro", "kilómetros"), "en": ("kilometer", "kilometers")},
    "cm": {"pt": ("centímetro", "centímetros"), "es": ("centímetro", "centímetros"), "en": ("centimeter", "centimeters")},
    "mm": {"pt": ("milímetro", "milímetros"), "es": ("milímetro", "milímetros"), "en": ("millimeter", "millimeters")},
    "m": {"pt": ("metro", "metros"), "es": ("metro", "metros")},                      # English "15m" can be millions
    "kg": {"pt": ("quilo", "quilos"), "es": ("kilo", "kilos"), "en": ("kilogram", "kilograms")},
    "ha": {"pt": ("hectare", "hectares"), "es": ("hectárea", "hectáreas"), "en": ("hectare", "hectares")},
    "°C": {"pt": ("grau Celsius", "graus Celsius"), "es": ("grado Celsius", "grados Celsius"), "en": ("degree Celsius", "degrees Celsius")},
    "°F": {"pt": ("grau Fahrenheit", "graus Fahrenheit"), "es": ("grado Fahrenheit", "grados Fahrenheit"),
           "en": ("degree Fahrenheit", "degrees Fahrenheit")},
    "°": {"pt": ("grau", "graus"), "es": ("grado", "grados"), "en": ("degree", "degrees")},
    "kWh": {"pt": ("quilowatt-hora", "quilowatts-hora"), "es": ("kilovatio hora", "kilovatios hora"), "en": ("kilowatt-hour", "kilowatt-hours")},
    "MWh": {"pt": ("megawatt-hora", "megawatts-hora"), "es": ("megavatio hora", "megavatios hora"), "en": ("megawatt-hour", "megawatt-hours")},
    "GWh": {"pt": ("gigawatt-hora", "gigawatts-hora"), "es": ("gigavatio hora", "gigavatios hora"), "en": ("gigawatt-hour", "gigawatt-hours")},
    "TWh": {"pt": ("terawatt-hora", "terawatts-hora"), "es": ("teravatio hora", "teravatios hora"), "en": ("terawatt-hour", "terawatt-hours")},
    "kW": {"pt": ("quilowatt", "quilowatts"), "es": ("kilovatio", "kilovatios"), "en": ("kilowatt", "kilowatts")},
    "MW": {"pt": ("megawatt", "megawatts"), "es": ("megavatio", "megavatios"), "en": ("megawatt", "megawatts")},
    "GW": {"pt": ("gigawatt", "gigawatts"), "es": ("gigavatio", "gigavatios"), "en": ("gigawatt", "gigawatts")},
}
MONTHS = {"pt": ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro",
                "dezembro"],
         "es": ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre",
                "diciembre"]}
TIMES = {"pt": "vezes", "es": "veces", "en": "times"}
PERCENT = {"pt": "por cento", "es": "por ciento", "en": "percent"}


def _value(text: str, lang: str) -> float | None:
    """'15.000.000' / '2,35' / '1,200.5' -> float, by the language's separators."""
    t = text.strip()
    if lang in ("pt", "es"):
        t = t.replace(".", "").replace(",", ".")
    else:
        t = t.replace(",", "")
    try:
        return float(t)
    except ValueError:
        return None


def _num(v: float, lang: str) -> str:
    """A number as the voice reads it best: no thousands separators, up to 2
    decimals, the language's decimal mark."""
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return s.replace(".", ",") if lang in ("pt", "es") else s


def _every_part(v: float, lang: str) -> tuple[str, int]:
    """2347891 -> ('2 milhões 347 mil 891', 1): a big number that is not round,
    every part with its scale word."""
    n, parts, last = int(round(v)), [], 1
    for base, one, many in SCALES[lang]:
        if lang == "es" and base == 10 ** 9:  # Spanish says "2347 millones", not "2 mil millones 347 millones"
            continue
        q, n = divmod(n, base)
        if q:
            parts.append(f"{q} {one if q == 1 and lang != 'en' else many}")
            last = base
    if n:
        parts.append(str(n))
        last = 1
    return " ".join(parts), last


def _scaled(v: float, lang: str, minimum: int = 10 ** 6) -> tuple[str, int] | None:
    """1.5e7 -> ('15 milhões', 10**6); a big number with more than 2 decimals of
    its scale -> every part spelled; below `minimum` -> None (it stays as written)."""
    for base, one, many in SCALES[lang]:
        if v >= base and base >= minimum:
            q = v / base
            if abs(q * 100 - round(q * 100)) > 1e-6:
                return _every_part(v, lang) if v >= 10 ** 6 else None
            single = q < 2 if lang == "pt" else q == 1
            return f"{_num(q, lang)} {one if single and lang != 'en' else many}", base
    return None


def _scale(word: str, lang: str) -> int:
    e = " ".join(word.lower().split())
    return ABBREVIATIONS[lang].get(e) or LETTER_SCALES.get(e) or 1


def _money(n: str, scale: str | None, code: str, lang: str) -> str | None:
    """'15' + 'mi' + brl -> '15 milhões de reais'; '1.200,50' + brl -> '1.200 reais e 50 centavos'."""
    v = _value(n, lang)
    if v is None:
        return None
    one, many = CURRENCY_NAMES[code][lang]
    if scale:
        v *= _scale(scale, lang)
    round_ = v >= 10 ** 4 and v % 1000 == 0
    said = _scaled(v, lang, minimum=10 ** 3 if (scale or round_) else 10 ** 6)
    if said:
        text, base = said
        of = " de " if lang in ("pt", "es") and base >= 10 ** 6 else " "
        return f"{text}{of}{many}"
    mark = "," if lang in ("pt", "es") else "."
    whole, _, cents = n.partition(mark)
    if cents and len(cents) == 2 and code in HAS_CENTS:
        c, vw = int(cents), _value(whole or "0", lang) or 0
        cent_one, cent_many, joiner = CENTS[lang]
        said_cents = f"{c} {cent_one if c == 1 else cent_many}"
        if not vw:
            return said_cents
        units = f"{whole} {one if vw == 1 else many}"
        return units if c == 0 else units + joiner + said_cents
    return f"{n} {one if v == 1 else many}"


def speakable_numbers(text: str, lang: str = "en") -> str:
    lang = lang if lang in SCALES else "en"
    sep = r"(?:\.\d{3})+(?:,\d+)?" if lang in ("pt", "es") else r"(?:,\d{3})+(?:\.\d+)?"
    dec = r"(?:,\d+)?" if lang in ("pt", "es") else r"(?:\.\d+)?"
    number = rf"\d{{1,3}}{sep}|\d+{dec}"
    scales = "|".join(sorted({re.escape(k) for k in list(ABBREVIATIONS[lang]) + list(LETTER_SCALES)}, key=len, reverse=True))
    scales = rf"(?i:{scales})(?![{LETTER}])"

    # 1) currency before the amount (+ scale word): "R$ 15 mi" -> "15 milhões de reais"
    before = "|".join(re.escape(s) for s in sorted(BEFORE, key=len, reverse=True))

    def money_before(m: re.Match) -> str:
        return _money(m.group(2), m.group(3), BEFORE[m.group(1)], lang) or m.group(0)
    text = re.sub(rf"(?<![{LETTER}$])({before})\s?({number})(?:\s?({scales}))?", money_before, text)

    # 2) currency after the amount: "100 zł", "50 €", "3 bi USD" -> "100 zlotys", "50 euros", "3 bilhões de dólares"
    after = "|".join(re.escape(s) for s in sorted(AFTER, key=len, reverse=True))

    def money_after(m: re.Match) -> str:
        return _money(m.group(1), m.group(2), AFTER[m.group(3)], lang) or m.group(0)
    text = re.sub(rf"(?<![\d.,])({number})(?:\s?({scales}))?\s?({after})(?![{LETTER}])", money_after, text)

    # 3) amount + abbreviation without a currency: "15 mi", "3,5 bi", "15M", "2.5k"
    def abbreviated(m: re.Match) -> str:
        v = _value(m.group(1), lang)
        mult = _scale(m.group(2), lang) if m.group(2) not in ("M", "B") else {"M": 10 ** 6, "B": 10 ** 9}[m.group(2)]
        said = _scaled(v * mult, lang, minimum=10 ** 3) if v is not None else None
        return said[0] if said else m.group(0)
    text = re.sub(rf"(?<![\d.,])({number})\s?({WITHOUT_CURRENCY[lang]})(?![{LETTER}\d])", abbreviated, text)

    # 3b) percent: "2.477%" was heard as "2,487%" -> "2 mil 477 por cento"; "47,43%" -> "47,43 por cento"
    thousands = r"\." if lang in ("pt", "es") else ","

    def percent(m: re.Match) -> str:
        n = m.group(1)
        v = _value(n, lang)
        if v is not None and re.search(thousands + r"\d{3}", n) and v == int(v):
            n = _every_part(v, lang)[0]
        return f"{n} {PERCENT[lang]}"
    text = re.sub(rf"(?<![\d.,])({number})\s?%", percent, text)

    # 3c) units: "29 bilhões de m³" -> "... metros cúbicos", "45 °C" -> "45 graus Celsius"
    units = {u: names[lang] for u, names in UNITS.items() if lang in names}
    alternatives = "|".join(re.escape(u) for u in sorted(units, key=len, reverse=True))
    words = {"pt": r"mil|milhão|milhões|bilhão|bilhões|trilhão|trilhões",
             "es": r"mil millones|mil|millón|millones|billón|billones",
             "en": r"thousand|million|billion|trillion"}[lang]

    def unit(m: re.Match) -> str:  # group 1: the amount as written ("29 bilhões de"), 2: its number, 3: the unit
        one, many = units[m.group(3)]
        single = m.group(1) == m.group(2) and _value(m.group(2), lang) == 1
        return f"{m.group(1)} {one if single else many}"
    text = re.sub(rf"(?<![\d.,])(({number})(?:\s+(?:{words})(?:\s+(?:de|of))?)?)\s?({alternatives})(?![{LETTER}\d²³/])",
                  unit, text)

    # 3d) "3x" -> "3 vezes" (the voice said "3 CIS"); "4x4" stays
    text = re.sub(rf"(?<![\d.,{LETTER}])({number})\s?[x×](?![{LETTER}\d])", lambda m: f"{m.group(1)} {TIMES[lang]}", text)

    # 3e) dates dd/mm/yyyy (Portuguese and Spanish): "01/07/1994" -> "1º de julho de 1994" (it was read "01-07-994")
    if lang in ("pt", "es"):
        def date(m: re.Match) -> str:
            d, month, year = int(m.group(1)), int(m.group(2)), m.group(3)
            if not (1 <= d <= 31 and 1 <= month <= 12):
                return m.group(0)
            day = "1º" if d == 1 and lang == "pt" else str(d)
            return f"{day} de {MONTHS[lang][month - 1]} de {year}"
        text = re.sub(r"(?<![\d/])(\d{1,2})/(\d{1,2})/(\d{4})(?![\d/])", date, text)

    # 3f) year ranges: "1986-1994" -> "1986 a 1994" (it was heard as "1986-1984")
    from_, to, between, and_ = {"pt": ("de", "a", "entre", "e"), "es": ("de", "a", "entre", "y"),
                                "en": ("from", "to", "between", "and")}[lang]

    def years(m: re.Match) -> str:
        word = (m.group(1) or "").strip().lower()
        if word == between:
            return f"{m.group(1)}{m.group(2)} {and_} {m.group(3)}"  # "entre 1986-1994" -> "entre 1986 e 1994"
        if word in ("período", "periodo", "época", "epoca", "era"):
            return f"{m.group(1)}{from_} {m.group(2)} {to} {m.group(3)}"  # "no período 1986-1994" -> "... de 1986 a 1994"
        return f"{m.group(1) or ''}{m.group(2)} {to} {m.group(3)}"
    text = re.sub(rf"((?<![{LETTER}])[{LETTER}]+\s)?(?<![\d.,])(1\d{{3}}|20\d{{2}})\s?[-–—]\s?(1\d{{3}}|20\d{{2}})(?![\d])",
                  years, text)

    # 3g) times "14h30" / "14h" (Portuguese and Spanish) -> "14 horas e 30"
    if lang in ("pt", "es"):
        joiner = " e " if lang == "pt" else " y "

        def clock(m: re.Match) -> str:
            h, minutes = int(m.group(1)), m.group(2)
            if h > 24 or (minutes and int(minutes) > 59):
                return m.group(0)
            said = f"{h} {'hora' if h == 1 else 'horas'}"
            return said + (f"{joiner}{int(minutes)}" if minutes and int(minutes) else "")
        text = re.sub(rf"(?<![\d.,])(\d{{1,2}})h(\d{{2}})?(?![\d{LETTER}])", clock, text)

    # 4) big numbers in digits: "15.000.000" / "15000000" / "2,350,000" -> "15 milhões" / "2,35 milhões"
    def big(m: re.Match) -> str:
        v = _value(m.group(0), lang)
        if v is None:
            return m.group(0)
        if v < 10 ** 6:
            if v >= 10 ** 4 and v % 1000 == 0:
                said = _scaled(v, lang, minimum=10 ** 3)  # "250.000" -> "250 mil"
                return said[0] if said else m.group(0)
            if m.group(0).isdigit():  # "12345" was garbled, "12.345" is read right
                grouped = f"{int(v):,}"
                return grouped.replace(",", ".") if lang in ("pt", "es") else grouped
            return m.group(0)
        said = _scaled(v, lang)
        return said[0] if said else m.group(0)
    text = re.sub(rf"(?<![\d.,])(?:\d{{1,3}}{sep}|\d{{5,}}{dec})(?![\d])", big, text)

    # 5) "2,35 milhões visitantes" -> "2,35 milhões de visitantes" (Portuguese and Spanish need the "de")
    if lang in ("pt", "es"):
        scale = r"milhão|milhões|bilhão|bilhões|trilhão|trilhões" if lang == "pt" else r"millón|millones|billón|billones"
        text = re.sub(rf"\b({scale})\s+(?!(?:de|e|y|o|ou)\b)(?=[{LETTER}])", r"\1 de ", text)

    # 6) Portuguese and Spanish: "2.750" -> "2 mil 750"; "2 pessoas" -> "duas pessoas" (only where the gender changes the word)
    if lang in ("pt", "es"):
        text = _mixed(text, lang)
        text = _acronyms(text, lang)
    return text


LETTER_NAMES = {
    "pt": dict(zip("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "á bê cê dê é éfe gê agá í jota cá éle ême ene ó pê quê érre ésse tê u vê "
                                                  "dáblio xis ípsilon zê".split())),
    "es": dict(zip("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "a be ce de e efe ge hache i jota ka ele eme ene o pe cu erre ese te u uve "
                                                  "uvedoble equis igriega zeta".split())),
}
_CLUSTERS = ("BR", "CR", "DR", "FR", "GR", "PR", "TR", "VR", "BL", "CL", "FL", "GL", "PL")


def _said_as_a_word(s: str) -> bool:
    """ONU, NASA, FIFA, UNESCO: said as a word. URV, IPCA, IBGE, STF, INSS: letter by letter."""
    v = "AEIOU"
    if not any(c in v for c in s) or all(c in v for c in s):
        return False
    if len(s) >= 2 and s[0] not in v and s[1] not in v and s[:2] not in _CLUSTERS:
        return False  # "CPI", "BNDES"
    if len(s) >= 2 and s[-1] not in v and s[-2] not in v:
        return False  # "URV", "INSS", "OMS"
    for i in range(1, len(s) - 1):
        a, b = s[i], s[i + 1]
        if a not in v and b not in v and a not in "RLSNM" and a + b not in _CLUSTERS:
            return False  # "IPCA", "IBGE"
        if i + 2 < len(s) and all(c not in v for c in s[i:i + 3]) and s[i + 1:i + 3] not in _CLUSTERS:
            return False
    return True


def _acronyms(text: str, lang: str) -> str:
    """The voice read "URV" as "Uri-V": an acronym that is not a word is spelled
    with the letters' names. Roman numerals (II, XX, XIV) and words written in
    capitals stay as they are."""
    names = LETTER_NAMES[lang]

    def acronym(m: re.Match) -> str:
        s = m.group(0)
        if re.fullmatch(r"[IVXLCDM]+", s) or s in ("OK",) or _said_as_a_word(s):
            return s
        return " ".join(names[c] for c in s)
    return re.sub(r"(?<![\w-])[A-Z]{2,5}(?![\w-])", acronym, text)


def _changes_when_feminine(n: int, lang: str) -> bool:
    """0 < n < 1000 whose words change with a feminine noun: 1, 2, 21, 32,
    200-999 (Spanish: 1, 21... and the hundreds)."""
    u, d = n % 10, (n // 10) % 10
    return n >= 200 or (d != 1 and (u == 1 or (u == 2 and lang == "pt")))


def _mixed(text: str, lang: str) -> str:
    num = r"\d{1,3}(?:\.\d{3})+|\d+"
    # an acronym's gender comes from the script itself: "a URV" -> "uma URV", not "um URV"
    art_f = r"a|as|da|das|na|nas|pela|pelas|uma|la|las|una"
    art_m = r"o|os|do|dos|no|nos|pelo|pelos|ao|aos|um|el|los|del|al|un"
    feminine_acronyms = (set(re.findall(rf"\b(?i:{art_f})\s+([A-Z]{{2,6}})\b", text))
                         - set(re.findall(rf"\b(?i:{art_m})\s+([A-Z]{{2,6}})\b", text)))
    joiner = " e " if lang == "pt" else " "

    def feminine_after(rest: str) -> bool:
        seg = re.match(rf"\s+([{LETTER}]+)", rest)
        if not seg:
            return False
        w = seg.group(1)
        if len(w) > 1 and w.isupper():
            return w in feminine_acronyms  # an acronym: only its article in the script counts
        return is_feminine(w, lang)

    def swap(m: re.Match) -> str:
        raw, whole, thousand = m.group(0), m.group(1), m.group(2)
        if len(whole) > 1 and whole.startswith("0"):
            return raw  # "007", codes
        n = int(whole.replace(".", ""))
        fem = feminine_after(text[m.end():])

        def word(k: int) -> str:
            return in_words(k, lang, True) if fem and 0 < k < 1000 and _changes_when_feminine(k, lang) else str(k)
        if thousand:  # "2 mil cédulas" -> "duas mil cédulas"; "500 mil" stays
            return (word(n) if n < 200 else whole) + thousand  # ("quinhentos mil" in words was heard "cinquenta mil")
        if n < 1000:
            return word(n)
        if "." not in whole or n >= 10 ** 6:
            return raw  # years, "146 milhões..." pieces: as written
        th, r = divmod(n, 1000)
        if th >= 10 and not (fem and _changes_when_feminine(r, lang)):
            return raw  # "27.500" is read right
        head = "mil" if th == 1 else f"{word(th) if th < 200 else th} mil"
        if not r:
            return head
        return head + (joiner if r < 100 or r % 100 == 0 else " ") + word(r)

    return re.sub(rf"(?<![\w/\-.,])({num})(?!,\d)(\s+mil\b)?(?![\w/\-]|[.,]\d)", swap, text)
