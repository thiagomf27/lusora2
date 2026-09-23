"""Per-stage wall time, read off a video folder's production.log.

    uv run python -m lusora_worker.stage_times <video_id | folder> [--all]

The folder is the data plane of record, so this reads the log rather than
video_events: it works on a copied folder, with the database down, and on a
video made against another database. Only the orchestrator's own lines count —
`stage <name> done in <s>s` and `stage <name> failed after <s>s` — so a stage
that was skipped as already-present does not appear, and a log written before
lines were stamped reports nothing rather than guessing.

By default only the LAST run is shown (a run starts at `claimed by`): a video
resumed after a review gate or a crash has several, and adding them up would
charge one video for work it did twice.
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

from .config import videos_root

_STAMP = r"(?P<ts>\d{4}-\d{2}-\d{2}T\S+) "
_CLAIM = re.compile(_STAMP + r"claimed by ")
_STAGE = re.compile(_STAMP + r"stage (?P<name>\S+) (?P<how>done in|failed after) (?P<s>[\d.]+)s$")


@dataclass
class Run:
    started: str
    stages: list[tuple[str, float, bool]] = field(default_factory=list)  # name, seconds, failed

    @property
    def total(self) -> float:
        return sum(s for _n, s, _f in self.stages)


def parse(lines: list[str]) -> list[Run]:
    runs: list[Run] = []
    for line in lines:
        line = line.rstrip("\n")
        if m := _CLAIM.match(line):
            runs.append(Run(started=m["ts"]))
        elif (m := _STAGE.match(line)) and runs:
            runs[-1].stages.append((m["name"], float(m["s"]), m["how"] == "failed after"))
    return runs


def format_run(run: Run) -> str:
    rows = [f"run claimed {run.started}"]
    total = run.total or 1.0
    width = max((len(n) for n, _s, _f in run.stages), default=5)
    for name, seconds, failed in run.stages:
        mark = "  FAILED" if failed else ""
        rows.append(f"  {name:<{width}}  {seconds:8.1f}s  {100 * seconds / total:5.1f}%{mark}")
    rows.append(f"  {'total':<{width}}  {run.total:8.1f}s")
    return "\n".join(rows)


def _folder(arg: str) -> Path:
    path = Path(arg)
    if path.is_dir():
        return path
    return videos_root() / arg


def main(argv: list[str]) -> int:
    args = [a for a in argv if not a.startswith("--")]
    if len(args) != 1:
        print(__doc__.strip().splitlines()[2].strip(), file=sys.stderr)
        return 2
    log = _folder(args[0]) / "production.log"
    if not log.exists():
        print(f"no production.log at {log}", file=sys.stderr)
        return 1
    runs = [r for r in parse(log.read_text(encoding="utf-8").splitlines()) if r.stages]
    if not runs:
        print(f"{log}: no timed stages (the log predates stage timings, or nothing ran)")
        return 0
    shown = runs if "--all" in argv else runs[-1:]
    print("\n\n".join(format_run(r) for r in shown))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
