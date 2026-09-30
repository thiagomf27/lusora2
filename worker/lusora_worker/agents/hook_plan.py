"""Hook plan — the hook's moments on screen, in varied forms.

D107 (documentary plan, slice 6a). Dark Palace's "Manchetes" hook puts two to
five moments of the opening on screen, each in a different form, landing on
the words that say it: a date or a number in big type, the subject's name as
one giant word, a line of the narration with one word marked, two number
cards. The model picks the moments; code keeps only the ones that obey every
rule (`manchetes_do_hook`), because a headline that shows a fact the narration
never said is the one mistake a hook cannot afford.

Every form is an existing catalog component, so a theme restyles all of them:
headline and word are a HammerStatement, phrase a HighlightedPassage anchored
on a verbatim quote of the beat, cards a FactSheet of two rows.
"""

from __future__ import annotations

import json
from typing import Any, Callable

import lusora_contracts
from lusora_contracts import prompts as prompt_packs

from ..compiler.textmatch import compare_key, tokenize
from ..context import StageContext
from ..costs import budget_gate
from ..providers import llm
from ..validators import check_prop_value, unspoken_numbers

STAGE = "hook_plan"
ROLE = "hook_plan"
FORMS = ("headline", "word", "phrase", "cards", "satellite", "matchcut")
PAPER = {"word", "phrase", "cards", "satellite", "matchcut"}   # full-frame moments: never two in a row
# the most visual forms are placed first when two compete for a beat
PRIORITY = {"matchcut": 0, "satellite": 1, "word": 2, "cards": 3, "phrase": 4, "headline": 5}
MAX_MOMENTS = 5


def _keys(text: str) -> list[str]:
    return [compare_key(w) for w in tokenize(text) if compare_key(w)]


def _contains(haystack: list[str], needle: list[str]) -> bool:
    return bool(needle) and any(haystack[k:k + len(needle)] == needle
                                for k in range(len(haystack) - len(needle) + 1))


def render_beats(hook_beats: list[dict[str, Any]], graphic: set[str]) -> str:
    """The hook, beat by beat, with every beat a moment may not use marked —
    the graphic beats AND their neighbours (a moment there would collide).
    Marking only the graphics had the model spend its whole answer on beats
    the rules then dropped: on the first 6b run, three of three."""
    ids = [str(b["id"]) for b in hook_beats]

    def mark(i: int) -> str:
        if ids[i] in graphic:
            return " (GRAPHIC — never put anything here)"
        if any(ids[j] in graphic for j in (i - 1, i + 1) if 0 <= j < len(ids)):
            return " (next to a graphic — only a satellite dive may go here)"
        return ""

    return "\n".join(f"[{b['id']}]{mark(i)} {str(b.get('script_text') or '').strip()}"
                     for i, b in enumerate(hook_beats))


def check(
    proposed: list[dict[str, Any]],
    hook_beats: list[dict[str, Any]],
    graphic: set[str],
) -> tuple[list[dict[str, Any]], list[str]]:
    """The moments that obey every rule, mapped to components, and why each
    other one was dropped. Nothing is repaired: a moment that breaks a rule is
    a moment the hook does without (Dark Palace's rule, and the safe one)."""
    order = [str(b["id"]) for b in hook_beats]
    text_of = {str(b["id"]): str(b.get("script_text") or "") for b in hook_beats}
    hook_text = " ".join(text_of.values())
    hook_words = set(_keys(hook_text))
    kept: list[dict[str, Any]] = []
    dropped: list[str] = []
    used_beats: set[str] = set()
    used_forms: set[str] = set()
    paper_at: list[int] = []

    def drop(m: dict, why: str) -> None:
        dropped.append(f"{m.get('form', '?')} on {m.get('beat', '?')}: {why}")

    ranked = sorted((m for m in proposed if isinstance(m, dict)),
                    key=lambda m: PRIORITY.get(str(m.get("form")), 9))
    for m in ranked:
        beat_id, form = str(m.get("beat") or ""), str(m.get("form") or "")
        if form not in FORMS:
            drop(m, f"unknown form '{form}'")
            continue
        if beat_id not in text_of:
            drop(m, "not a hook beat")
            continue
        if beat_id in graphic:
            drop(m, "the beat already carries a graphic")
            continue
        index = order.index(beat_id)
        neighbours = [order[j] for j in (index - 1, index + 1) if 0 <= j < len(order)]
        # the dive is the exception (the user's call): it is the hook's
        # strongest form, and a neighbouring graphic moves after it instead
        if form != "satellite" and any(n in graphic for n in neighbours):
            # graphics hold ~3.5-6 s, across beat lines, and two on screen at
            # once is one too many: on the first 6a runs a CENTRALIA card
            # pushed the next beat's "1,000 -> 5" split off, and a headline was
            # trimmed away under the previous beat's counter
            drop(m, "a neighbouring beat carries a graphic, and the two would collide")
            continue
        if beat_id in used_beats:
            drop(m, "the beat already has a moment")
            continue
        if form in PAPER and form in used_forms:
            drop(m, f"a {form} is used once")
            continue
        if form in PAPER and any(abs(index - j) <= 1 for j in paper_at):
            drop(m, "two full-frame cards in a row read as a slideshow")
            continue
        beat_text = text_of[beat_id]
        says = str(m.get("says") or "").strip()
        if not 1 <= len(says.split()) <= 3 or not _contains(_keys(beat_text), _keys(says)):
            drop(m, f"'{says}' is not said in that beat, so it would never land")
            continue

        moment: dict[str, Any] = {"beat_id": beat_id, "form": form, "says": says}
        if form == "headline":
            text = str(m.get("text") or "").strip()
            if not 1 <= len(text.split()) <= 4 or len(text) > 34:
                drop(m, "a headline is 1-4 words")
                continue
            if unspoken_numbers({"text": text}, beat_text):
                drop(m, f"'{text}' shows a number the beat does not say")
                continue
            moment.update(component="HammerStatement",
                          props={"text": text, "align": "center", "emphasis": "accent"})
        elif form == "word":
            word = str(m.get("word") or "").strip()
            caption = str(m.get("caption") or "").strip()
            key = compare_key(word)
            if len(word.split()) != 1 or not 2 <= len(key) <= 12 or key not in hook_words:
                drop(m, f"'{word}' must be one word of at most 12 letters the hook says")
                continue
            if caption and (len(caption.split()) > 4 or unspoken_numbers({"c": caption}, hook_text)):
                caption = ""   # a caption is optional; a wrong one is not
            props = {"text": word, "align": "center", "emphasis": "accent"}
            if caption:
                props["kicker"] = caption
            moment.update(component="HammerStatement", props=props)
        elif form == "phrase":
            text = str(m.get("text") or "").strip()
            highlight = str(m.get("highlight") or "").strip()
            if not 3 <= len(text.split()) <= 10 or not _contains(_keys(beat_text), _keys(text)):
                drop(m, "a phrase is 3-10 words copied in order from its beat")
                continue
            marks = ([{"phrase": highlight, "style": "underline"}]
                     if highlight and compare_key(highlight) in _keys(text) else [])
            moment.update(component="HighlightedPassage", props={"text": text, "marks": marks}, quote=text)
        elif form == "matchcut":
            # D111: photos of one KIND of place, aligned — gathered and judged
            # in plan(), after the rules, so a moment the rules drop costs nothing
            search = " ".join(str(m.get("search") or "").split()[:5])
            if not 1 <= len(search.split()) <= 4:
                drop(m, "a match cut needs a 1-4 word search for a kind of place or thing")
                continue
            moment.update(component="MatchCut", props={"photos": []}, search=search)
        elif form == "satellite":
            # D110: a dive from space onto the first exact place the hook names
            from ..compiler import geo

            place = " ".join(str(m.get("place") or "").split()[:12])
            coords = (geo.lookup(place) or geo.lookup(place.split(",")[0])) if place else None
            if coords is None:
                drop(m, f"'{place}' could not be found on the map")
                continue
            name = place.split(",")[0].strip()
            if not 1 <= len(name.split()) <= 6:
                drop(m, "the place's name is 1-6 words before the first comma")
                continue
            moment.update(component="SatelliteLocate",
                          props={"place_name": name, "label": name, "lat": coords[0], "lng": coords[1],
                                 "zoom": "neighbourhood", "framing": "full", "dive": True},
                          place=name)
        else:  # cards
            title = str(m.get("title") or "").strip()
            rows = []
            for it in (m.get("items") or [])[:2]:
                if not isinstance(it, dict):
                    continue
                value, label = str(it.get("value") or "").strip(), str(it.get("label") or "").strip()
                if (value and len(value) <= 12 and any(ch.isdigit() for ch in value)
                        and not unspoken_numbers({"v": value}, hook_text) and 1 <= len(label.split()) <= 3):
                    rows.append({"label": label, "value": value})
            if len(rows) != 2:
                drop(m, "cards are exactly two numbers the hook says, each with a 1-3 word label")
                continue
            if not 1 <= len(title.split()) <= 6 or unspoken_numbers({"t": title}, hook_text):
                drop(m, "cards need a 1-6 word title with no unspoken number")
                continue
            moment.update(component="FactSheet", props={"title": title, "rows": rows})

        entry = lusora_contracts.catalog_component(moment["component"]) or {"props": {}}
        bad = [e for name, value in moment["props"].items()
               if (e := check_prop_value(entry["props"].get(name, {}), name, value))]
        if bad:
            drop(m, "; ".join(bad))
            continue
        kept.append(moment)
        used_beats.add(beat_id)
        if form in PAPER:
            used_forms.add(form)
            paper_at.append(index)
        if len(kept) >= MAX_MOMENTS:
            break
    kept.sort(key=lambda mo: order.index(mo["beat_id"]))
    return kept, dropped


def plan(
    ctx: StageContext,
    hook_beats: list[dict[str, Any]],
    graphic: set[str],
    chat_fn: llm.ChatFn = llm.chat,
    progress: Callable[[str], None] | None = None,
    see_fn: llm.SeeFn = llm.see,
) -> dict[str, Any]:
    """One call over the hook, then the rules. `mock` plans nothing."""
    doc: dict[str, Any] = {"version": "1.0", "video_id": ctx.video_id, "mode": "headlines",
                           "moments": [], "dropped": []}
    planner = ctx.cfg.get("planner") or {}
    provider = planner.get("llm") or "mock"
    chain = llm.chain_of(provider)
    if chain == ["mock"] or not hook_beats:
        return doc
    gate_provider = llm.gate_provider(chain)
    prompt = (ctx.cfg.get("prompts") or {}).get(ROLE)
    model = None if isinstance(provider, list) else (planner.get("model") or (prompt or {}).get("model_hint"))
    subjects_doc = ctx.read_json("subjects.json") if ctx.has("subjects.json") else {}
    system, user = prompt_packs.compose(ROLE, prompt, {
        "beats": render_beats(hook_beats, graphic),
        "main_idea": str(subjects_doc.get("main_idea") or ""),
        "content_rules": str(ctx.cfg.get("content_rules") or ""),
        "instructions": str((ctx.cfg.get("overrides") or {}).get("instructions") or ""),
    })
    with budget_gate(ctx, stage=STAGE, provider=gate_provider, operation="llm.hook_plan",
                     estimated_units=3000, model=model, details={"beats": len(hook_beats)}) as cost:
        result = chat_fn(provider, model, system, user, int((prompt or {}).get("max_tokens") or 16000),
                         prompt_packs.temperature(ROLE, prompt))
        cost.actual(result.total_tokens, {"input_tokens": result.input_tokens,
                                          "output_tokens": result.output_tokens,
                                          "answered_by": result.provider})
    try:
        answer = llm.extract_json(result.text)
    except (ValueError, json.JSONDecodeError) as exc:
        doc["dropped"].append(f"the answer was not JSON ({exc}) — the hook goes without moments")
        return doc
    proposed = answer.get("moments") if isinstance(answer, dict) else None
    doc["moments"], doc["dropped"] = check(proposed if isinstance(proposed, list) else [], hook_beats, graphic)
    # D111: a match cut kept by the rules still needs six good photos
    for moment in [m for m in doc["moments"] if m["form"] == "matchcut"]:
        from . import match_cut

        built = match_cut.build(ctx, moment["search"], see_fn)
        if built is None:
            doc["moments"].remove(moment)
            doc["dropped"].append(f"matchcut on {moment['beat_id']}: fewer than {match_cut.MIN_PHOTOS} "
                                  f"good photos of '{moment['search']}'")
            continue
        moment["props"] = {"photos": built["photos"], "says": moment["says"]}
        moment["credits"] = built["credits"]
    if progress:
        progress(f"hook moments: {len(doc['moments'])} kept"
                 + (f" ({'; '.join(m['form'] + ' on ' + m['beat_id'] for m in doc['moments'])})" if doc["moments"] else "")
                 + (f"; {len(doc['dropped'])} dropped" if doc["dropped"] else ""))
    return doc


def merge_into_selection(
    beats_doc: dict[str, Any],
    selection: dict[str, Any] | None,
    hook_doc: dict[str, Any] | None,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """The moments as overlay selections, for beats that carry none. A phrase
    adds a quote anchor to its beat: it IS a verbatim span of the narration,
    which is what a quote anchor is. Returns (beats_doc, selection)."""
    moments = (hook_doc or {}).get("moments") or []
    if not moments:
        return beats_doc, selection
    selection = json.loads(json.dumps(selection)) if selection else {
        "version": "1.0", "video_id": str(beats_doc.get("video_id", "")), "selections": [], "declined": []}
    taken = {str(s.get("beat_id")) for s in selection.get("selections") or []}
    beats = [dict(b) for b in beats_doc.get("beats") or []]
    by_id = {str(b.get("id")): b for b in beats}
    for m in moments:
        beat = by_id.get(str(m["beat_id"]))
        if beat is None or str(m["beat_id"]) in taken:
            continue
        sel: dict[str, Any] = {"beat_id": m["beat_id"], "component": m["component"], "props_hint": m["props"]}
        if m.get("quote") or m.get("place"):
            # a phrase is a verbatim quote; a dive lands on the words naming a
            # place — each is the anchor its component attaches to
            anchor = ({"type": "quote", "value": m["quote"], "source_words": m["quote"]} if m.get("quote")
                      else {"type": "place", "value": m["place"], "source_words": m["says"]})
            anchors = list(beat.get("anchors") or [])
            anchors.append(anchor)
            beat["anchors"] = anchors
            sel.update(role="anchor", anchor_ref=len(anchors) - 1)
        else:
            sel["role"] = "emphasis"
        selection["selections"].append(sel)
        taken.add(str(m["beat_id"]))
    return {**beats_doc, "beats": beats}, selection
