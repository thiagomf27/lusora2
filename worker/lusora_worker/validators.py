"""Validators (Core Principle 5): constrain, validate, repair.

Both validators collect ALL violations before returning — violation
lists feed the repair loop (M4) and error events. Nothing unvalidated
reaches a renderer.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import jsonschema
import lusora_contracts

from .textsplit import normalize


def _schema_errors(name: str, data: Any) -> list[str]:
    validator = jsonschema.Draft202012Validator(lusora_contracts.load_schema(name))
    return [
        f"schema {'/'.join(str(p) for p in e.absolute_path) or '/'}: {e.message}"
        for e in validator.iter_errors(data)
    ]


# ---------------- beat sheet ----------------


def validate_beat_sheet(
    beats_doc: dict[str, Any],
    script: str,
    cfg: dict[str, Any],
    expected_duration_s: float | None = None,
) -> list[str]:
    violations = _schema_errors("beat_sheet", beats_doc)
    if violations:
        return violations  # structure first; content checks assume shape

    style = cfg.get("style_pack_doc") or {}
    beats = beats_doc.get("beats") or []
    narration = [b for b in beats if b.get("kind") == "narration"]
    script_norm = normalize(script)

    # full coverage, ordered, non-overlapping: concatenated spans == script
    concat = normalize(" ".join(str(b.get("script_text", "")) for b in narration))
    if concat != script_norm:
        if concat and script_norm.startswith(concat):
            violations.append("beats do not cover the end of the script")
        elif concat and concat in script_norm:
            violations.append("beats do not cover the beginning of the script")
        else:
            for b in narration:
                if normalize(str(b.get("script_text", ""))) not in script_norm:
                    violations.append(
                        f"beat {b.get('id')}: script_text is not a verbatim span of the script"
                    )
            violations.append(
                "narration beats concatenated do not equal the script (must cover it in order, no overlap)"
            )

    # anchors: source_words verbatim in the beat's span
    for b in narration:
        span = normalize(str(b.get("script_text", "")))
        for i, anchor in enumerate(b.get("anchors") or []):
            if normalize(str(anchor.get("source_words", ""))) not in span:
                violations.append(
                    f"beat {b.get('id')}: anchor[{i}] source_words {anchor.get('source_words')!r} not found in its span"
                )

    # overlays: catalog existence + allowed_components + anchor types
    allowed = (style.get("overlays") or {}).get("allowed_components")
    overlay_count = 0
    for b in beats:
        overlay = b.get("overlay")
        if not overlay:
            continue
        overlay_count += 1
        name = str(overlay.get("component", ""))
        entry = lusora_contracts.catalog_component(name)
        if entry is None:
            violations.append(f"beat {b.get('id')}: overlay component '{name}' not in catalog")
            continue
        if allowed and name not in allowed:
            violations.append(
                f"beat {b.get('id')}: component '{name}' not in style pack allowed_components {allowed}"
            )
        ref = overlay.get("anchor_ref")
        anchors = b.get("anchors") or []
        if entry["anchor_types"]:
            if ref is None:
                violations.append(
                    f"beat {b.get('id')}: component '{name}' requires an anchor_ref (types {entry['anchor_types']})"
                )
            elif ref >= len(anchors):
                violations.append(f"beat {b.get('id')}: anchor_ref {ref} out of range")
            elif anchors[ref].get("type") not in entry["anchor_types"]:
                violations.append(
                    f"beat {b.get('id')}: component '{name}' cannot attach to anchor type '{anchors[ref].get('type')}'"
                )

    # beat count within pacing-derived range; overlay density
    pacing = style.get("pacing") or {}
    if expected_duration_s and pacing.get("avg_hold_seconds"):
        target = expected_duration_s / float(pacing["avg_hold_seconds"])
        lo, hi = math.floor(target * 0.5), math.ceil(target * 1.8) + 1
        if not (lo <= len(narration) <= hi):
            violations.append(
                f"{len(narration)} narration beats for {expected_duration_s:.0f}s narration is outside "
                f"the pacing range [{lo}, {hi}] (avg_hold {pacing['avg_hold_seconds']}s)"
            )
        density = (style.get("overlays") or {}).get("density", "normal")
        per_minute = {"low": 1.0, "normal": 2.5, "high": 5.0}.get(
            density if isinstance(density, str) else "", float((density or {}).get("per_minute", 2.5)) if isinstance(density, dict) else 2.5
        )
        max_overlays = math.ceil(per_minute * expected_duration_s / 60) + 1
        if overlay_count > max_overlays:
            violations.append(
                f"{overlay_count} overlays exceed density '{density}' (max {max_overlays} for {expected_duration_s:.0f}s)"
            )

    # timed beats must not collide with the narration envelope (v1: leading only)
    for b in beats:
        if b.get("kind") == "timed" and narration:
            t = b.get("timing") or {}
            leading = all(
                float(t.get("start_s", 0)) <= float((other.get("timing") or {}).get("end_s", 0))
                for other in beats
                if other.get("kind") == "timed"
            )
            if not leading:
                violations.append(f"timed beat {b.get('id')} collides with the narration envelope")

    return violations


# ---------------- edit plan (full validation) ----------------


def validate_plan(
    plan: dict[str, Any],
    folder: Path,
    cfg: dict[str, Any],
    audio_duration_s: float | None,
    require_assets: bool = True,
) -> list[str]:
    violations = _schema_errors("edit_plan", plan)
    if violations:
        return violations

    tracks = plan["tracks"]
    visual = tracks["visual"]

    # visual: contiguous, non-overlapping, starts at 0
    if visual and abs(float(visual[0]["start_s"])) > 1e-6:
        violations.append(f"visual track starts at {visual[0]['start_s']}s, must start at 0")
    for a, b in zip(visual, visual[1:]):
        if abs(float(a["end_s"]) - float(b["start_s"])) > 1e-3:
            violations.append(
                f"visual items {a['id']} -> {b['id']} not contiguous ({a['end_s']} vs {b['start_s']})"
            )
    for item in visual:
        if float(item["end_s"]) <= float(item["start_s"]):
            violations.append(f"visual item {item['id']} has non-positive duration")

    # assets present and readable
    if require_assets:
        for item in visual:
            path = str(item["asset"].get("path", ""))
            if not path:
                violations.append(f"visual item {item['id']}: asset not resolved (empty path)")
            elif not (folder / path).exists():
                violations.append(f"visual item {item['id']}: asset file missing: {path}")
        for m in tracks["audio"].get("music") or []:
            if not (folder / str(m["path"])).exists():
                violations.append(f"music file missing: {m['path']}")

    # overlays: catalog + props
    for item in tracks["overlays"]:
        if item.get("kind") == "component":
            name = str(item.get("component", ""))
            entry = lusora_contracts.catalog_component(name)
            if entry is None:
                violations.append(f"overlay {item['id']}: component '{name}' not in catalog")
                continue
            props = item.get("props") or {}
            for pname, spec in entry["props"].items():
                if spec.get("required") and pname not in props:
                    violations.append(f"overlay {item['id']}: missing required prop '{pname}'")
                if pname in props:
                    v = props[pname]
                    if spec.get("type") == "number" and not isinstance(v, (int, float)):
                        violations.append(f"overlay {item['id']}: prop '{pname}' must be a number")
                    if "enum" in spec and v not in spec["enum"]:
                        violations.append(f"overlay {item['id']}: prop '{pname}'={v!r} not in {spec['enum']}")
                    if spec.get("min") is not None and isinstance(v, (int, float)) and v < spec["min"]:
                        violations.append(f"overlay {item['id']}: prop '{pname}'={v} below min {spec['min']}")
                    if spec.get("max") is not None and isinstance(v, (int, float)) and v > spec["max"]:
                        violations.append(f"overlay {item['id']}: prop '{pname}'={v} above max {spec['max']}")
            unknown = [p for p in props if p not in entry["props"]]
            if unknown:
                violations.append(f"overlay {item['id']}: unknown props {unknown}")
        elif item.get("kind") == "media" and require_assets:
            path = str((item.get("asset") or {}).get("path", ""))
            if not path or not (folder / path).exists():
                violations.append(f"media overlay {item['id']}: asset file missing: {path or '(empty)'}")

    # one voiceover matching real audio duration; total duration coherence
    vo = tracks["audio"]["voiceover"]
    total = float(vo.get("start_s", 0)) + float(vo["duration_s"])
    if audio_duration_s is not None and abs(float(vo["duration_s"]) - audio_duration_s) > 0.75:
        violations.append(
            f"voiceover duration_s {vo['duration_s']} does not match audio.mp3 ({audio_duration_s:.2f}s)"
        )
    if visual:
        vis_end = float(visual[-1]["end_s"])
        if abs(vis_end - total) > 1.0:
            violations.append(
                f"visual track ends at {vis_end}s but voiceover ends at {total:.2f}s"
            )
    for item in tracks["overlays"]:
        if float(item["end_s"]) > total + 0.75:
            violations.append(f"overlay {item['id']} ends after the video ({item['end_s']}s > {total:.2f}s)")

    return violations
