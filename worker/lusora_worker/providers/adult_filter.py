"""The 18+ word filter (D104) — Dark Palace's `filtro_adulto.py`, layer 1.

Every title, description and category text gather_footage reads goes through
this BEFORE anything is downloaded: nudity, sex and graphic extreme violence,
in ~25 languages. Only terms that almost always mean adult content are here; a
word that also names ordinary things ("XXX" as thirty, "snuff box", "blue
tits") is left to layer 2, the pick_shots judge, whose welded rule rates adult
content 1. A dark or sad subject is NOT adult content — ruins, disasters,
skeletons, battles without gore pass both layers.

Latin, Cyrillic and Greek entries are regex fragments matched as WHOLE words
("Sussex" never matches "sex"); Chinese, Japanese, Korean, Thai, Arabic,
Persian, Hebrew and Hindi are matched as substrings. Accents and case never
matter. The word lists are data copied from Dark Palace unchanged.
"""

from __future__ import annotations

import re
import unicodedata

_PALAVRAS = {
    "en": r"""porn\w* pornograph\w* nsfw nude nudes nudity nudist\w* naked topless bottomless bare\s?breast\w* breasts boobs?
            nipples? genital\w* penis\w* vaginas? vulvas? phallus phallic priapus erotic\w* erotica sex sexual\w* sexy sexting
            intercourse orgy orgies orgasm\w* masturbat\w* bdsm bondage strippers? striptease strip\s?clubs? lap\s?dance
            lingerie escort\s?(?:girl|service)s? prostitut\w* brothels? lupanar onlyfans playboy playmates? hentai camgirls?
            adult\s(?:film|video|movie|content|entertainment|site)s? x\s?rated (?<!oilseed\s)rape(?!\s?(?:seed|field|oil)s?)
            raped rapes rapist\w* sexual\s?assault\w* molest\w* pedophil\w* paedophil\w* child\s?abuse incest\w* behead\w*
            decapitat\w* firing\s?squads? shot\s?dead lynching\w* lynched hanged\s(?:man|men|woman|women|body|bodies)
            guillotined severed\s?heads? mutilat\w* dismember\w* gory gore\s?(?:video|footage|photos?) gruesome
            graphic\s(?:violence|content|footage|images?) corpses?(?!\s?(?:flower|lily|road|reviver)) cadavers?
            dead\s?bod(?:y|ies) autops(?:y|ies) murder\s?scenes? crime\s?scenes? snuff\s?(?:film|movie|video)s? self\s?harm""",
    "pt": r"""porno\w* pornografi\w* nua nuas nudez nudismo nudista\w* pelad[oa]s? despid[oa]s? sem\s?roupa seios mamilos?
            genitais genitalia erotic[oa]s? erotismo sexo sexual sexuais transando prostitut\w* prostibulo bordel putaria
            safadeza nudes estupr\w* abuso\s?sexual pedofil\w* incesto decapitad[oa]s? decapitac\w* degolad\w* degolac\w*
            cabeca\s?cortada fuzilament\w* fuzilad[oa]s? enforcad[oa]s? linchament\w* mutilad[oa]s? mutilac\w*
            esquartejad\w* cadaver(?:es)? corpos?\s?sem\s?vida autopsias?""",
    "es": r"""porno\w* pornografi\w* desnud[oa]s? desnudez sin\s?ropa senos pezon(?:es)? genitales erotic[oa]s? erotismo sexo
            sexual(?:es)? prostitut\w* burdel(?:es)? violador(?:es)? abuso\s?sexual pedofil\w* incesto decapitad[oa]s?
            decapitacion(?:es)? degollad[oa]s? fusilamientos? fusilad[oa]s? ahorcad[oa]s? linchamientos? mutilad[oa]s?
            cadaver(?:es)? autopsias?""",
    "fr": r"""porno\w* pornographi\w* nue nues tout\s?nus? a\s?poil denude\w* nudite nudiste\w* seins tetons erotique\w*
            sexe sexuel\w* prostitu\w* bordels? violee?s? pedophil\w* decapit\w* fusill\w* pendus? pendue\w* lynchage\w*
            mutil\w* cadavres? autopsies?""",
    "de": r"""porno\w* nackt\w* nacktheit bruste busen nippel genital\w* erotik erotisch\w* sex sexuell\w* prostitu\w*
            bordell\w* vergewaltig\w* enthauptung\w* enthauptet\w* erschiessung\w* verstummel\w* leiche leichen leichnam
            obduktion\w*""",
    "it": r"""porno\w* pornografi\w* nud[oaie] nudita senza\s?vestiti seni capezzol[oi] erotic[oaihe]+ erotismo sesso
            sessual[ei] prostitu\w* bordell[oi] stupr\w* pedofil\w* decapitat\w* decapitazion[ei] fucilazion[ei]
            fucilat[oaie] impiccat[oaie] linciaggi\w* mutilat\w* cadaver[ei] autopsi[ae]""",
    "nl": r"""porno\w* naakt\w* borsten tepels? erotisch\w* seks seksueel\w* prostitu\w* bordeel verkracht\w* onthoofd\w*
            gefusilleerd lijk""",
    "pl": r"""porno\w* pornografi\w* nagie nagosc piersi erotyk\w* erotyczn\w* seks seksualn\w* prostytu\w* burdel\w* gwałt\w*
            gwalt\w* pedofil\w* sciec\w* sciet\w* rozstrzelan\w* zwłoki zwloki""",
    "ru": r"""порно\w* порнограф\w* голая голые голыи обнажен\w* нагая нагие нагишом эроти\w* секс\w* проститу\w* бордел\w*
            изнасил\w* педофил\w* обезглав\w* расстрел\w* повешен\w* расчлен\w* труп\w* мертвец\w*""",
    "uk": r"""оголен\w* гола голі еротик\w* зґвалт\w* розстріл\w* трупи?""",
    "tr": r"""porno\w* ciplak\w* cıplak\w* erotik\w* seks\w* cinsel\w* fuhus genelev\w* tecavuz\w* kafa\s?kes\w* ceset\w*""",
    "id": r"""porno\w* bugil telanjang seks seksual\w* erotis pelacur\w* pemerkosaan perkosa\w* pemenggalan penggal\w* mayat""",
    "vi": r"""khoa\s?than tinh\s?duc khieu\s?dam hiep\s?dam chặt\s?đầu chat\s?đau xac\s?chet""",
    "sv": r"""porr\w* naken nakna nøgen erotisk\w* sex prostitu\w* valdtakt\w* voldtægt\w* halshugg\w*""",
    "cs": r"""porno\w* nahy nahota erotick\w* sex znasilnen\w* mrtvol\w*""",
    "ro": r"""porno\w* nud[aăe]? erotic\w* sex sexual\w* decapitat\w* cadavr\w*""",
    "hu": r"""porno\w* meztelen\w* szex\w* erotikus nemi\s?eroszak lefejez\w* holttest\w*""",
    "tl": r"""hubad seks gahasa ginahasa pinugutan bangkay""",
    "el": r"""πορνο\w* γυμνος γυμνη γυμνα γυμνες γυμνοι ερωτικ\w* σεξ βιασμ\w* αποκεφαλισ\w* πτωμα\w*""",
}
# substring languages (no spaces between words, or words that take prefixes and suffixes)
_TRECHOS = {    # multi-word terms joined by "_" (they must appear whole: "cut" or "head" alone never block)
    "zh": "色情 裸体 裸體 裸露 裸照 成人视频 成人影片 成人内容 性爱 做爱 性交 卖淫 賣淫 强奸 強姦 斩首 斬首 砍头 砍頭 枪决 槍決 "
          "尸体 屍體 黄片 淫秽 淫穢 淫乱",
    "ja": "ポルノ ヌード 全裸 裸体 裸の エロ動画 エロ画像 エロい アダルト動画 セックス 性行為 売春 強姦 レイプ 斬首 死体 18禁",
    "ko": "포르노 누드 알몸 나체 섹스 성관계 야동 성매매 강간 참수 시체",
    "th": "โป๊ เปลือย หนังโป๊ เซ็กส์ ข่มขืน ตัดหัว",
    "ar": "إباحي اباحي بورنو عاري عارية عراة دعارة اغتصاب قطع_رأس قطع_الرأس جثة جثث",
    "fa": "پورن برهنه لخت سکس تجاوز_جنسی سر_بریدن",
    "he": "פורנו עירום עירומה סקס אונס עריפת גופה גופות",
    "hi": "पोर्न नग्न नंगा नंगी सेक्स अश्लील बलात्कार सिर_काट लाश",
}


def _norm(s: object) -> str:
    """Accents and case out: the text and the terms go through the same door."""
    s = unicodedata.normalize("NFKD", str(s or "")).casefold()
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def _text(s: object) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[_\-./|:;,()\[\]{}#\"'“”«»]+", " ", _norm(s)))


def _compile() -> tuple[re.Pattern, list[str]]:
    frags: list[str] = []
    for block in _PALAVRAS.values():
        frags += [_norm(x) for x in block.split() if x.strip()]
    whole = re.compile(r"(?<![\w])(" + "|".join(sorted(set(frags), key=len, reverse=True)) + r")(?![\w])")
    pieces = sorted({_norm(t).replace("_", " ") for block in _TRECHOS.values() for t in block.split()},
                    key=len, reverse=True)
    return whole, pieces


_WHOLE, _PIECES = _compile()
_AGE = re.compile(r"(?<!\d)18\s?\+|\+\s?18(?!\d)")


def reason(*texts: object) -> str:
    """"" when every text is safe; otherwise the term that matched (for the log)."""
    t = " ".join(_text(x) for x in texts if x)
    if not t.strip():
        return ""
    m = _WHOLE.search(t) or _AGE.search(t)
    if m:
        return m.group(0).strip()
    for term in _PIECES:
        if len(term) >= 2 and term in t:
            return term
    return ""


def safe(*texts: object) -> bool:
    return not reason(*texts)
