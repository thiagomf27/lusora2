"""Score a beat sheet's overlay decisions against a human's ground truth.

The four numbers this produces are the only way the overlay work can claim a
prompt change helped. They are deliberately cheap to compute and impossible to
game by accident: `score()` is pure, does no I/O, calls no model, and reads
nothing but the two documents handed to it.

MATCHING IS BY WORDS, NEVER BY TIME. A case's script is narrated by OUR TTS, so
the reference video's timings do not transfer to our beats — a mark at 01:23 in
the reference has no relationship to 01:23 in our render. Each mark instead
names a verbatim span of the script (`source_words`), and the beat that covers
that span is the beat the mark is about. The normalisation used to find it is
`textsplit.normalize`, the same one `validate_beat_sheet` uses for its verbatim
check, so a span the validator considers present cannot be a span the scorer
considers missing.

The four scores:

    recall              of the moments that SHOULD carry a graphic, how many did
    precision           of the overlays placed, how many landed on such a moment
    restraint           of the moments that should NOT, how many were left alone
    component_accuracy  of the moments correctly carrying a graphic, how many
                        chose a component the ground truth calls defensible

`restraint` is the one this work is trying to move, and it is the reason
`no_graphic` marks carry `near_miss`: a negative on a span with no anchor in it
is free, because the anchor gate already refuses to put a graphic there. Only a
negative on a span the pipeline WOULD have been allowed to decorate is evidence
of judgement.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from ..textsplit import normalize


class EvalCaseError(Exception):
    """The ground truth does not fit the script it is supposed to describe.

    Always a bug in the case, never a bad result: a mark whose words are not in
    the script has nothing to be right or wrong about, so the scorer refuses
    rather than quietly recording it as a miss the planner never had a chance
    to avoid.
    """


@dataclass(frozen=True)
class Scores:
    """The four axes, plus the counts they were computed from.

    A score is `None` when its denominator is empty — a case with no
    `no_graphic` marks has no restraint to report, and reporting 1.0 there
    would read as a perfect score for a question nobody asked.
    """

    recall: float | None
    precision: float | None
    restraint: float | None
    component_accuracy: float | None

    graphic_marks: int = 0
    graphic_marks_hit: int = 0
    no_graphic_marks: int = 0
    no_graphic_marks_respected: int = 0
    overlays_placed: int = 0
    overlays_on_a_graphic_mark: int = 0
    components_defensible: int = 0
    # excluded, and why — visible so a case cannot lose half its marks silently
    unmappable_marks: int = 0
    unscorable_negatives: int = 0
    unscorable_overlays: int = 0

    misses: tuple[str, ...] = ()
    restraint_failures: tuple[str, ...] = ()
    wrong_components: tuple[tuple[str, str], ...] = ()

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


# ---------------- spans ----------------


@dataclass
class _Span:
    start: int
    end: int


def _locate(needle: str, haystack: str, what: str) -> _Span:
    """Find `needle` in `haystack` exactly once, both already normalised."""
    first = haystack.find(needle)
    if first < 0:
        raise EvalCaseError(
            f"{what}: {needle!r} does not appear in the script. A mark that "
            "names words the narration never says cannot be scored — fix the "
            "mark, or the script.txt the case was written against."
        )
    if haystack.find(needle, first + 1) >= 0:
        raise EvalCaseError(
            f"{what}: {needle!r} appears more than once in the script, so which "
            "moment it means is ambiguous. Lengthen source_words until the span "
            "is unique."
        )
    return _Span(first, first + len(needle))


def _beat_spans(beats: list[dict[str, Any]], script_norm: str) -> dict[str, _Span]:
    """Where each narration beat sits in the script, by text rather than index.

    Locating beats by their words is what makes the scores independent of the
    ORDER of the beats array: reshuffling the list cannot move a beat's span,
    so it cannot move a number.
    """
    spans: dict[str, _Span] = {}
    cursor = 0
    for beat in beats:
        if beat.get("kind") != "narration":
            continue
        text = normalize(str(beat.get("script_text", "")))
        if not text:
            continue
        at = script_norm.find(text, cursor)
        if at < 0:
            # Not necessarily a repeat: a sheet whose beats are shuffled has a
            # cursor pointing past them, so fall back to a search from the top.
            at = script_norm.find(text)
        if at < 0:
            raise EvalCaseError(
                f"beat {beat.get('id')}: script_text is not a verbatim span of the "
                "script. This sheet would not have passed validate_beat_sheet, so "
                "scoring it would measure the wrong failure."
            )
        spans[str(beat.get("id"))] = _Span(at, at + len(text))
        cursor = at + len(text)
    return spans


def _covering_beat(mark: _Span, spans: dict[str, _Span]) -> str | None:
    """The beat whose span contains the mark's, by greatest overlap.

    A mark can straddle a beat boundary — the planner chose where to cut and the
    marker did not — so "contains" is too strict to be honest. The beat that
    holds most of the marked words is the beat that had the chance.
    """
    best, best_overlap = None, 0
    for beat_id, span in spans.items():
        overlap = min(mark.end, span.end) - max(mark.start, span.start)
        if overlap > best_overlap:
            best, best_overlap = beat_id, overlap
    return best


# ---------------- scoring ----------------


def score(
    marks_doc: dict[str, Any],
    beats_doc: dict[str, Any],
    script: str | None = None,
) -> Scores:
    """Score one beat sheet against one case's marks.

    `script` defaults to the narration beats concatenated, which
    `validate_beat_sheet` guarantees equals the script for any sheet the
    pipeline accepted. Pass the case's real `script.txt` when you have it: a
    mark that fits the script but not this sheet is then reported as the
    fixture bug it is, rather than as a scoring miss.
    """
    beats = list(beats_doc.get("beats") or [])
    narration = [b for b in beats if b.get("kind") == "narration"]
    if script is None:
        script = " ".join(str(b.get("script_text", "")) for b in narration)
    script_norm = normalize(script)
    spans = _beat_spans(beats, script_norm)

    # what each beat was marked as. A beat can hold several marks; which of them
    # an overlay on that beat answers to is decided below, once, so that recall
    # and restraint can never both claim the same placement.
    graphic_by_beat: dict[str, list[dict[str, Any]]] = {}
    negative_by_beat: dict[str, list[dict[str, Any]]] = {}
    unmappable_beats: set[str] = set()
    unmappable = 0

    for mark in marks_doc.get("marks") or []:
        verdict = mark.get("verdict")
        words = normalize(str(mark.get("source_words", "")))
        span = _locate(words, script_norm, f"mark {mark.get('id')}")
        beat_id = _covering_beat(span, spans)
        if verdict == "unmappable":
            unmappable += 1
            if beat_id:
                unmappable_beats.add(beat_id)
            continue
        if beat_id is None:
            raise EvalCaseError(
                f"mark {mark.get('id')}: its words are in the script but no beat "
                "covers them. The sheet does not cover its own script."
            )
        if verdict == "graphic":
            _check_ideal(mark)
            graphic_by_beat.setdefault(beat_id, []).append(mark)
        elif verdict == "no_graphic":
            negative_by_beat.setdefault(beat_id, []).append(mark)

    overlay_beats = {
        str(b.get("id")): b["overlay"]
        for b in beats
        if isinstance(b.get("overlay"), dict) and b.get("overlay")
    }

    # --- recall and component accuracy: did the graphic moments get a graphic?
    hits, defensible, misses = 0, 0, []
    wrong: list[tuple[str, str]] = []
    graphic_total = sum(len(v) for v in graphic_by_beat.values())
    for beat_id, marks in graphic_by_beat.items():
        overlay = overlay_beats.get(beat_id)
        for mark in marks:
            if overlay is None:
                misses.append(str(mark.get("id")))
                continue
            hits += 1
            chosen = str(overlay.get("component", ""))
            if chosen in (mark.get("acceptable") or []):
                defensible += 1
            else:
                wrong.append((str(mark.get("id")), chosen))

    # --- restraint: were the moments marked "leave it alone" left alone?
    #
    # A negative sharing its beat with a positive is NOT scorable: at beat
    # granularity an overlay there is attributable to the positive, so counting
    # it either way would be inventing a result. Excluded and counted, the same
    # way an unmappable mark is — a metric that quietly absorbs its ambiguous
    # cases is a metric that reports a number for nothing.
    respected, negatives, unscorable_negatives, failures = 0, 0, 0, []
    for beat_id, marks in negative_by_beat.items():
        if beat_id in graphic_by_beat:
            unscorable_negatives += len(marks)
            continue
        for mark in marks:
            negatives += 1
            if beat_id in overlay_beats:
                failures.append(str(mark.get("id")))
            else:
                respected += 1

    # --- precision: of the overlays placed, how many landed on a graphic mark?
    #
    # An overlay on a beat nobody marked at all is not evidence either way —
    # the marker looked at the reference, not at every beat our planner would
    # invent — so only beats carrying a verdict are counted.
    on_target, placed, unscorable_overlays = 0, 0, 0
    for beat_id in overlay_beats:
        if beat_id in graphic_by_beat:
            placed += 1
            on_target += 1
        elif beat_id in negative_by_beat:
            placed += 1
        elif beat_id in unmappable_beats:
            unscorable_overlays += 1

    return Scores(
        recall=_ratio(hits, graphic_total),
        precision=_ratio(on_target, placed),
        restraint=_ratio(respected, negatives),
        component_accuracy=_ratio(defensible, hits),
        graphic_marks=graphic_total,
        graphic_marks_hit=hits,
        no_graphic_marks=negatives,
        no_graphic_marks_respected=respected,
        overlays_placed=placed,
        overlays_on_a_graphic_mark=on_target,
        components_defensible=defensible,
        unmappable_marks=unmappable,
        unscorable_negatives=unscorable_negatives,
        unscorable_overlays=unscorable_overlays,
        misses=tuple(misses),
        restraint_failures=tuple(failures),
        wrong_components=tuple(wrong),
    )


def _check_ideal(mark: dict[str, Any]) -> None:
    acceptable = mark.get("acceptable") or []
    ideal = mark.get("ideal")
    if ideal is not None and ideal not in acceptable:
        raise EvalCaseError(
            f"mark {mark.get('id')}: ideal {ideal!r} is not one of acceptable "
            f"{acceptable!r}. JSON Schema cannot express membership, so it is "
            "checked here — a best choice that is not an allowed choice means "
            "the mark says two different things."
        )


def _ratio(hit: int, total: int) -> float | None:
    return None if total == 0 else hit / total


# ---------------- cases and CLI ----------------


def load_case(case_dir: Path) -> tuple[dict[str, Any], str]:
    """Read a case's ground truth and the script it was written against."""
    marks_path, script_path = case_dir / "marks.json", case_dir / "script.txt"
    for path in (marks_path, script_path):
        if not path.exists():
            raise EvalCaseError(f"{case_dir.name}: missing {path.name}")
    marks = json.loads(marks_path.read_text(encoding="utf-8"))
    if marks.get("case") != case_dir.name:
        raise EvalCaseError(
            f"{case_dir.name}/marks.json declares case {marks.get('case')!r}; "
            "the field and the directory name must agree, or a result cannot be "
            "traced back to what produced it."
        )
    return marks, script_path.read_text(encoding="utf-8")


def check_case(case_dir: Path) -> list[str]:
    """Everything wrong with a case, before a single provider call is made.

    The same rules `docs/10-overlay-marks.md` asks its author to self-check, run
    where the author actually is rather than only in CI: a case is usually
    pasted out of a model's answer, and finding out it names a component that
    does not exist AFTER paying for six planner runs is the expensive order to
    discover it in.

    Returns the problems, empty when the case is sound. Never raises for a case
    fault — the point is to report all of them at once, not the first.
    """
    import jsonschema
    from lusora_contracts import load_catalog, load_schema

    problems: list[str] = []
    marks_path = case_dir / "marks.json"
    script_path = case_dir / "script.txt"
    cfg_path = case_dir / "cfg.json"

    for path in (marks_path, script_path):
        if not path.exists():
            return [f"{case_dir.name}: missing {path.name}"]
    if not cfg_path.exists():
        problems.append(
            f"{case_dir.name}: no cfg.json — the case cannot say what overlay "
            "budget it was scored under, and the budget is what makes a mark a "
            "fair question"
        )

    try:
        marks = json.loads(marks_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return [f"{case_dir.name}/marks.json is not valid JSON: {exc}"]
    script_norm = normalize(script_path.read_text(encoding="utf-8"))

    try:
        jsonschema.validate(marks, load_schema("overlay_marks"))
    except jsonschema.ValidationError as exc:
        problems.append(f"marks.json fails its schema at {list(exc.path)}: {exc.message}")

    if marks.get("case") != case_dir.name:
        problems.append(
            f"marks.json declares case {marks.get('case')!r} but the directory is "
            f"{case_dir.name!r} — they must agree, or a result cannot be traced back"
        )

    cfg = {}
    if cfg_path.exists():
        try:
            cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            problems.append(f"cfg.json is not valid JSON: {exc}")
    overlays_cfg = ((cfg.get("style_pack_doc") or {}).get("overlays") or {})
    allowed = overlays_cfg.get("allowed_components")
    emphasis_on = bool((overlays_cfg.get("emphasis") or {}).get("enabled", False))

    catalog = {c["name"]: c for c in load_catalog()["components"]}

    graphic = negative = near_miss = 0
    for mark in marks.get("marks") or []:
        mid = mark.get("id", "?")
        words = normalize(str(mark.get("source_words", "")))
        first = script_norm.find(words) if words else -1
        if not words:
            problems.append(f"{mid}: no source_words")
        elif first < 0:
            problems.append(f"{mid}: source_words {mark['source_words']!r} is not in script.txt")
        elif script_norm.find(words, first + 1) >= 0:
            problems.append(
                f"{mid}: source_words {mark['source_words']!r} appears more than once — "
                "lengthen it until the span is unique"
            )

        verdict = mark.get("verdict")
        if verdict == "no_graphic":
            negative += 1
            if mark.get("near_miss"):
                near_miss += 1
            continue
        if verdict != "graphic":
            continue

        graphic += 1
        acceptable = mark.get("acceptable") or []
        if mark.get("ideal") is not None and mark["ideal"] not in acceptable:
            problems.append(f"{mid}: ideal {mark['ideal']!r} is not one of acceptable {acceptable}")
        for name in acceptable:
            entry = catalog.get(name)
            if entry is None:
                problems.append(f"{mid}: {name!r} is not a component in the catalog")
                continue
            if allowed and name not in allowed:
                problems.append(
                    f"{mid}: {name!r} is not in this case's allowed_components, so no run "
                    "could ever place it"
                )
            if mark.get("class") == "anchor" and not entry["anchor_types"]:
                problems.append(
                    f"{mid}: {name!r} carries no anchor type, so it can never be "
                    "class 'anchor' — it is an emphasis component (D86)"
                )
        if mark.get("class") == "emphasis" and not emphasis_on:
            problems.append(
                f"{mid}: an emphasis mark, but this case's pack does not set "
                "overlays.emphasis.enabled — the planner is forbidden to place one, "
                "so scoring it would be unfair. Enable the class or mark it unmappable"
            )

    # advisory: a case can be valid and still too small to measure anything
    total = graphic + negative
    if total and total < 20:
        problems.append(
            f"ADVISORY: {total} scorable marks. With {graphic} graphic marks, recall "
            f"moves in steps of {100 / graphic:.0f} points if one changes — write 25-40 "
            "marks so run-to-run noise does not swamp the effect being measured"
            if graphic else f"ADVISORY: only {total} scorable marks"
        )
    if negative and near_miss * 2 < negative:
        problems.append(
            f"ADVISORY: {near_miss} of {negative} negatives carry near_miss. A negative "
            "on a span with no anchor is free — the gate already refuses it — so a case "
            "weighted this way can barely measure restraint"
        )
    return problems


def score_case(case_dir: Path, beats_path: Path) -> Scores:
    marks, script = load_case(case_dir)
    beats = json.loads(beats_path.read_text(encoding="utf-8"))
    return score(marks, beats, script)


def _format(case: str, scores: Scores) -> str:
    def pct(value: float | None) -> str:
        return "  n/a" if value is None else f"{value * 100:5.1f}%"

    lines = [
        f"case: {case}",
        f"  recall             {pct(scores.recall)}   "
        f"({scores.graphic_marks_hit}/{scores.graphic_marks} graphic marks carried a graphic)",
        f"  precision          {pct(scores.precision)}   "
        f"({scores.overlays_on_a_graphic_mark}/{scores.overlays_placed} placed overlays landed on one)",
        f"  restraint          {pct(scores.restraint)}   "
        f"({scores.no_graphic_marks_respected}/{scores.no_graphic_marks} no-graphic marks left alone)",
        f"  component_accuracy {pct(scores.component_accuracy)}   "
        f"({scores.components_defensible}/{scores.graphic_marks_hit} chose a defensible component)",
    ]
    if scores.unmappable_marks or scores.unscorable_negatives or scores.unscorable_overlays:
        lines.append(
            f"  excluded: {scores.unmappable_marks} unmappable, "
            f"{scores.unscorable_negatives} negative(s) sharing a beat with a positive, "
            f"{scores.unscorable_overlays} overlay(s) on an unmappable moment"
        )
    if scores.misses:
        lines.append(f"  missed:   {', '.join(scores.misses)}")
    if scores.restraint_failures:
        lines.append(f"  overdid:  {', '.join(scores.restraint_failures)}")
    if scores.wrong_components:
        lines.append(
            "  wrong:    " + ", ".join(f"{m} chose {c}" for m, c in scores.wrong_components)
        )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m lusora_worker.evals.overlays",
        description="Score a beat sheet's overlay decisions against a case's ground truth.",
    )
    sub = parser.add_subparsers(dest="command", required=True)
    scorer = sub.add_parser("score", help="score one beats.json against one case")
    scorer.add_argument("case_dir", type=Path, help="evals/overlays/<case>")
    scorer.add_argument("beats", type=Path, help="the beats.json a run produced")
    scorer.add_argument("--json", action="store_true", help="machine-readable output")

    checker = sub.add_parser(
        "check", help="validate a case before spending anything on it"
    )
    checker.add_argument("case_dir", type=Path, help="evals/overlays/<case>")

    args = parser.parse_args(argv)
    if args.command == "check":
        problems = check_case(args.case_dir)
        hard = [p for p in problems if not p.startswith("ADVISORY")]
        for problem in problems:
            print(("  ! " if not problem.startswith("ADVISORY") else "  ~ ") + problem)
        if not problems:
            print(f"{args.case_dir.name}: sound")
        elif not hard:
            print(f"{args.case_dir.name}: valid, with {len(problems)} advisory note(s)")
        return 1 if hard else 0
    try:
        scores = score_case(args.case_dir, args.beats)
    except EvalCaseError as exc:
        print(f"eval case error: {exc}", file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps({"case": args.case_dir.name, **scores.as_dict()}, indent=2, default=list))
    else:
        print(_format(args.case_dir.name, scores))
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised through the CLI
    raise SystemExit(main())
