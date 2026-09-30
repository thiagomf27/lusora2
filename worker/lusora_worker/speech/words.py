"""Numbers in words for the voice, in Portuguese and Spanish, agreeing with the
noun's gender (D115; Dark Palace's `extenso.py`).

Measured by Dark Palace with a Portuguese voice (2026-09-26): digits are read
differently from one take to the next — "2.750" came out "dois ponto setecentos
e cinquenta", "347 mil 891" as "três em quarenta e sete mil" — and the gender
was often wrong: "dois pessoas", "duzentos moedas". Words leave the voice
nothing to guess. `speakable_numbers` uses them only where the gender changes
the word; everywhere else digits stay digits (a script entirely in words made
the voice repeat and invent numbers).

    in_words(n, lang, feminine=False)  -> "duas mil quatrocentas e setenta e sete"
    ordinal(n, lang, feminine=False)   -> "primeiro" / "primera"
    is_feminine(word, lang)            -> the noun is feminine, by its ending and lists of exceptions
"""

from __future__ import annotations

import re

_PT = {
    "units": ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze",
              "treze", "catorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"],
    "tens": ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"],
    "hundreds": ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos",
                 "oitocentos", "novecentos"],
}
_ES = {
    "units": ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce",
              "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno",
              "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho",
              "veintinueve"],
    "tens": ["", "", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"],
    "hundreds": ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos",
                 "ochocientos", "novecientos"],
}


def _below_1000_pt(n: int, feminine: bool) -> str:
    """0 < n < 1000, Portuguese."""
    c, r = divmod(n, 100)
    parts = []
    if c:
        if n == 100:
            return "cem"
        hundred = _PT["hundreds"][c]
        parts.append(hundred[:-2] + "as" if feminine and c > 1 else hundred)
    if r:
        if r < 20:
            u = _PT["units"][r]
        else:
            d, un = divmod(r, 10)
            u = _PT["tens"][d] + (" e " + _PT["units"][un] if un else "")
        if feminine:
            u = re.sub(r"\bum$", "uma", re.sub(r"\bdois$", "duas", u))
        parts.append(u)
    return " e ".join(parts)


def _below_1000_es(n: int, feminine: bool, apocope: bool) -> str:
    """0 < n < 1000, Spanish. `apocope`: "uno" -> "un" before a noun or a scale
    word ("veintiún", "un millón")."""
    c, r = divmod(n, 100)
    parts = []
    if c:
        if n == 100:
            return "cien"
        hundred = _ES["hundreds"][c]
        parts.append(hundred[:-2] + "as" if feminine and c > 1 else hundred)
    if r:
        if r < 30:
            u = _ES["units"][r]
        else:
            d, un = divmod(r, 10)
            u = _ES["tens"][d] + (" y " + _ES["units"][un] if un else "")
        if u.endswith("uno"):
            u = u[:-3] + ("una" if feminine else ("ún" if u == "veintiuno" and apocope else "un") if apocope else "uno")
        parts.append(u)
    return " ".join(parts)


def in_words(n: int, lang: str = "pt", feminine: bool = False, before_noun: bool = True) -> str:
    """A whole number in words. `feminine`: the counted noun is feminine (only
    the thousands and units agree: "duzentas mil pessoas", but "dois milhões de
    pessoas"). Any language but pt and es keeps its digits."""
    n = int(n)
    if lang not in ("pt", "es"):
        return str(n)
    if n == 0:
        return "zero" if lang == "pt" else "cero"
    groups, k = [], n
    while k:
        k, g = divmod(k, 1000)
        groups.append(g)
    if lang == "pt":
        names = [None, None, ("milhão", "milhões"), ("bilhão", "bilhões"), ("trilhão", "trilhões")]
        parts = []
        for i in range(len(groups) - 1, -1, -1):
            g = groups[i]
            if not g:
                continue
            if i == 0:
                parts.append(_below_1000_pt(g, feminine))
            elif i == 1:
                parts.append("mil" if g == 1 else _below_1000_pt(g, feminine) + " mil")
            else:
                parts.append(_below_1000_pt(g, False) + " " + (names[i][0] if g == 1 else names[i][1]))
        # "e" before the last group when it is below 100 or a round hundred: "mil e quinhentos", "dois mil e vinte"
        last = groups[0] if groups[0] else None
        if len(parts) > 1 and last and (last < 100 or last % 100 == 0):
            return " ".join(parts[:-1]) + " e " + parts[-1]
        if len(parts) > 1 and not groups[0] and groups[1] and len(groups) > 2 and \
                (groups[1] < 100 or groups[1] % 100 == 0):
            return " ".join(parts[:-1]) + " e " + parts[-1]  # "um milhão e duzentos mil"
        return " ".join(parts)
    # Spanish: the millions count in groups of six ("mil millones", "billón" = 10**12)
    parts = []
    millions, rest = divmod(n, 10 ** 6)
    trillions, millions = divmod(millions, 10 ** 6)
    if trillions:
        parts.append("un billón" if trillions == 1 else in_words(trillions, "es", False).replace("uno", "un") + " billones")
    if millions:
        if millions == 1:
            parts.append("un millón")
        else:
            thousands, units = divmod(millions, 1000)
            m = ("mil" if thousands == 1 else _below_1000_es(thousands, False, True) + " mil") if thousands else ""
            m = (m + " " + _below_1000_es(units, False, True)).strip() if units else m
            parts.append(m + " millones")
    if rest:
        thousands, units = divmod(rest, 1000)
        if thousands:
            parts.append("mil" if thousands == 1 else _below_1000_es(thousands, feminine, True) + " mil")
        if units:
            parts.append(_below_1000_es(units, feminine, before_noun))
    return " ".join(parts)


_ORD_PT = {1: "primeiro", 2: "segundo", 3: "terceiro", 4: "quarto", 5: "quinto", 6: "sexto", 7: "sétimo", 8: "oitavo",
           9: "nono", 10: "décimo", 20: "vigésimo", 30: "trigésimo", 40: "quadragésimo", 50: "quinquagésimo",
           60: "sexagésimo", 70: "septuagésimo", 80: "octogésimo", 90: "nonagésimo"}
_ORD_ES = {1: "primero", 2: "segundo", 3: "tercero", 4: "cuarto", 5: "quinto", 6: "sexto", 7: "séptimo", 8: "octavo",
           9: "noveno", 10: "décimo", 20: "vigésimo", 30: "trigésimo", 40: "cuadragésimo", 50: "quincuagésimo",
           60: "sexagésimo", 70: "septuagésimo", 80: "octogésimo", 90: "nonagésimo"}


def ordinal(n: int, lang: str = "pt", feminine: bool = False) -> str | None:
    """1..99 -> "primeiro", "vigésimo terceiro" (None past 99: the digits stay)."""
    table = _ORD_PT if lang == "pt" else _ORD_ES if lang == "es" else None
    if not table or not 1 <= n <= 99:
        return None
    d, u = divmod(n, 10)
    parts = [table[d * 10]] if d else []
    if u:
        parts.append(table[u])
    text = " ".join(parts)
    if lang == "es" and not feminine and n in (1, 3):
        text = text[:-1]  # "primer", "tercer" before a noun
    return re.sub(r"o\b", "a", text) if feminine else text


# ---- the gender of the counted word ----
_MASC_A = set("""dia dias mapa mapas problema problemas sistema sistemas planeta planetas clima climas tema temas programa programas
idioma idiomas cometa cometas poema poemas teorema teoremas drama dramas diploma diplomas esquema esquemas telefonema telefonemas
pijama pijamas atleta atletas pirata piratas poeta poetas profeta profetas astronauta astronautas motorista motoristas dentista
dentistas jornalista jornalistas artista artistas turista turistas cientista cientistas especialista especialistas analista
analistas economista economistas ativista ativistas terrorista terroristas papa papas monarca monarcas patriarca patriarcas
jesuíta jesuítas cinema cinemas aroma aromas dilema dilemas emblema emblemas enigma enigmas estigma estigmas lema lemas panorama
panoramas paradigma paradigmas prisma prismas trauma traumas magma plasma plasmas puma pumas gorila gorilas coala coalas panda
pandas grama gramas quilograma quilogramas miligrama miligramas quilo quilos guia guias colega colegas lhama lhamas atlas
pâncreas iogurte policial""".split())
_FEM_PT = set("""vez vezes noite noites morte mortes mulher mulheres mãe mães mão mãos tribo tribos lei leis parte partes fase fases
classe classes ponte pontes rede redes torre torres fonte fontes frase frases árvore árvores chave chaves nave naves ave aves pele
peles flor flores cor cores dor dores colher colheres nuvem nuvens ordem ordens espécie espécies série séries superfície
superfícies sede sedes gente fome febre neve sorte sortes arte artes tarde tardes carne carnes foto fotos moto motos libido
lente lentes mente mentes frente frentes corrente correntes serpente serpentes luz luzes paz voz vozes cruz cruzes raiz raízes
matriz matrizes atriz atrizes noz nozes foz virgem virgens hélice hélices ilhéu cidade cidades catedral catedrais capital
capitais""".split())
_FEM_ENDINGS_PT = ("ção", "ções", "são", "sões", "dade", "dades", "gem", "gens", "tude", "tudes", "ice", "ices", "ise", "ises",
                   "ez", "eza", "ezas", "ose", "oses", "ite", "ites")
_MASC_ENDINGS_PT = ("coração", "corações", "personagem", "personagens", "selvagem", "selvagens", "chope", "cortiço",
                    "limite", "limites", "convite", "convites", "apetite", "palpite", "palpites", "satélite", "satélites",
                    "biscoite", "elite")
_MASC_A_ES = set("""día días mapa mapas problema problemas sistema sistemas planeta planetas clima climas tema temas programa programas
idioma idiomas cometa cometas poema poemas teorema teoremas drama dramas diploma diplomas esquema esquemas pijama pijamas atleta
atletas pirata piratas poeta poetas profeta profetas astronauta astronautas dentista dentistas periodista periodistas artista
artistas turista turistas científico papa papas monarca monarcas patriarca patriarcas jesuita jesuitas cinema cinemas aroma
aromas dilema dilemas emblema emblemas enigma enigmas estigma estigmas lema lemas panorama panoramas paradigma paradigmas prisma
prismas trauma traumas magma plasma puma pumas gorila gorilas koala koalas panda pandas gramo gramos kilo kilos guía guías
colega colegas atlas""".split())
_FEM_ES = set("""vez veces noche noches muerte muertes mujer mujeres madre madres ley leyes parte partes fase fases clase clases
fuente fuentes torre torres frase frases llave llaves nave naves ave aves piel pieles flor flores sal luz luces voz voces cruz
cruces raíz raíces paz nube nubes serpiente serpientes frente mente mentes imagen imágenes especie especies serie series
superficie superficies tarde tardes sede suerte suertes carne carnes calle calles gente mano manos foto fotos moto motos radio
tribu tribus catedral catedrales capital capitales""".split())
_FEM_ENDINGS_ES = ("ción", "ciones", "sión", "siones", "dad", "dades", "tad", "tades", "tud", "tudes", "umbre", "umbres", "ez",
                   "eza", "ezas", "sis")

# words that follow a number but are not what it counts: articles, prepositions,
# common verbs ("em 1994 a inflação", "2 era o limite", "o preço chegava")
_NOT_A_NOUN = set("""a as à às da das na nas para pra pela pelas ela elas contra agora ainda nunca fora embora apenas cerca era eram
estava estavam ficava ficavam seria seriam será serão tinha tinham havia valia valiam custava custavam chegava chegavam passava
passavam virava viravam dava davam fica ficam vira viram custa custam chega chegam passa passam sobra sobram falta faltam faltava
restava resta soma somava la las entonces ahora nunca fuera apenas estaba estaban sería serían tenía tenían había valía costaba
llegaba pasaba daba queda quedan llega llegan pasa pasan cuesta cuestan""".split())


def is_feminine(word: str, lang: str = "pt") -> bool:
    w = re.sub(r"[^\wÀ-ÿ-]", "", (word or "").lower())
    if not w or not w[0].isalpha() or w in _NOT_A_NOUN or w.endswith(("ava", "avam", "aba", "aban")):
        return False
    if lang == "pt":
        if w.endswith(("ía", "íam")):  # "caía", "saíam": verbs
            return False
        if w in _FEM_PT:
            return True
        if w in _MASC_A or w.endswith(_MASC_ENDINGS_PT):
            return False
        return w.endswith(("a", "as")) or w.endswith(_FEM_ENDINGS_PT)
    if lang == "es":
        if w in _FEM_ES:
            return True
        if w in _MASC_A_ES:
            return False
        return w.endswith(("a", "as")) or w.endswith(_FEM_ENDINGS_ES)
    return False
