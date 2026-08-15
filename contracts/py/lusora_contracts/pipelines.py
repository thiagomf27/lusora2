"""Pipeline manifests (D60) — the stage list as data.

A manifest declares POLICY: which stages run, in what order, what each
produces, and where a guided run would gate. It never declares MECHANISM —
how a stage decides it is already done lives in the worker's step registry,
keyed by stage name. This module only locates, parses and validates the YAML;
binding a name to a callable is the worker's job.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator

from . import CONTRACTS_ROOT, load_schema

PIPELINES_DIR = CONTRACTS_ROOT / "pipelines"

# The pipeline a cfg.json that names none is run with. Manual-first: a
# hand-written cfg (or one snapshotted before D60) still runs the faceless
# stage list, which is exactly what it ran before pipelines became data.
DEFAULT_PIPELINE = "faceless"


class PipelineError(ValueError):
    """A manifest that cannot be trusted to run: missing, malformed, or
    inconsistent with its own declarations."""


def pipeline_path(name: str) -> Path:
    return PIPELINES_DIR / f"{name}.yaml"


def list_pipelines() -> list[str]:
    if not PIPELINES_DIR.is_dir():
        return []
    return sorted(p.stem for p in PIPELINES_DIR.glob("*.yaml"))


def load_pipeline(name: str) -> dict[str, Any]:
    """Load and validate a manifest by name.

    Same freshness reasoning as `load_schema` and `load_sound_pack`: the worker
    is a long-lived poller, so a manifest edited while it is up must not be
    cached until someone restarts the process.
    """
    path = pipeline_path(name)
    try:
        st = path.stat()
    except FileNotFoundError:
        known = ", ".join(list_pipelines()) or "none"
        raise PipelineError(f"pipeline {name!r} not found in {PIPELINES_DIR} (known: {known})")
    return _load_pipeline(str(path), st.st_mtime_ns, st.st_size)


@lru_cache(maxsize=8)
def _load_pipeline(path: str, _mtime_ns: int, _size: int) -> dict[str, Any]:
    p = Path(path)
    try:
        doc = yaml.safe_load(p.read_text(encoding="utf-8"))
    except yaml.YAMLError as e:
        raise PipelineError(f"{p.name}: not valid YAML: {e}")
    if not isinstance(doc, dict):
        raise PipelineError(f"{p.name}: expected a mapping at the top level")
    validate_pipeline(doc, where=p.name)
    if doc["name"] != p.stem:
        raise PipelineError(f"{p.name}: 'name' is {doc['name']!r}, expected {p.stem!r}")
    return doc


def validate_pipeline(doc: dict[str, Any], where: str = "pipeline") -> None:
    """Schema + the two structural rules the schema cannot express.

    A duplicate stage name would make the run log ambiguous and the future
    checkpoint lookup pick one of two entries; an artifact required by a stage
    that nothing earlier produces is either a typo or a stage in the wrong
    order — both are cheap to catch here and expensive to catch on a video.
    """
    errors = sorted(
        Draft202012Validator(load_schema("pipeline_manifest")).iter_errors(doc),
        key=lambda e: list(e.path),
    )
    if errors:
        detail = "; ".join(f"{'/'.join(str(p) for p in e.path) or '<root>'}: {e.message}" for e in errors)
        raise PipelineError(f"{where}: schema violations: {detail}")

    seen: set[str] = set()
    for stage in doc["stages"]:
        if stage["name"] in seen:
            raise PipelineError(f"{where}: duplicate stage {stage['name']!r}")
        seen.add(stage["name"])

    check_requires(doc, where=where)


# Artifacts that exist before the first stage runs: written at enqueue
# (cfg.json) or uploaded by a human (manual-first, platform UPLOADABLE).
BOOTSTRAP_ARTIFACTS = frozenset(
    {"cfg.json", "script.txt", "audio.mp3", "avatar.mp4", "subtitles.srt", "beats.json", "edit_plan.json"}
)


def check_requires(doc: dict[str, Any], where: str = "pipeline") -> None:
    """Every `requires` is produced by an earlier stage or provided at bootstrap.

    `requires` is advisory at run time in v1 — the orchestrator runs stages in
    manifest order and each stage reads what it needs — but validating it here
    is what makes the declaration worth writing: a manifest whose DAG does not
    close is rejected at load, not discovered mid-video.
    """
    available = set(BOOTSTRAP_ARTIFACTS)
    for stage in doc["stages"]:
        for need in stage.get("requires", []):
            if need not in available:
                raise PipelineError(
                    f"{where}: stage {stage['name']!r} requires {need!r}, "
                    "which no earlier stage produces and nothing provides at bootstrap"
                )
        available.update(stage.get("produces", []))


def stage_names(doc: dict[str, Any]) -> list[str]:
    return [stage["name"] for stage in doc["stages"]]


load_pipeline.cache_clear = _load_pipeline.cache_clear  # type: ignore[attr-defined]
