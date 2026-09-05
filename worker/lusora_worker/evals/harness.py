"""Running an eval case through the real stages, cheaply and visibly.

Two things this exists for, both learned the expensive way.

**Cost has to be visible.** The earlier harnesses used a test double for the
database, so every eval run threw its cost events away — the control plane
recorded $0.25 across all history while roughly $4 had been billed. `EvalDb`
writes real `cost_events` rows with `video_id` NULL, tagged with the case and
arm, so a test arm shows up wherever a video's spend shows up. Eval runs are
not videos and must not create video rows; the column is nullable for exactly
this kind of use.

**Most of a tuning run is waste.** Tuning the overlay prompt re-ran the whole
planner to regenerate beats that could not have changed — 3.3 calls to rebuild
the input, then 1 call for the thing under test. `BeatsCache` keeps the beats
per case and arm, so an overlay iteration costs one call instead of four. It
also removes the planner's own variance from the comparison, which makes the
measurement better as well as about four times cheaper.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from ..costs import token_rates


class EvalDb:
    """A database handle that records real spend and nothing else.

    Cost events go to Postgres so a tuning session is as visible as a video.
    Stage events and provider health are kept in memory: they are about a
    video's progress, and an eval run is not a video.
    """

    def __init__(self, case: str, arm: str, dsn: str | None = None) -> None:
        self.case = case
        self.arm = arm
        self.events: list[tuple[str, str, str | None]] = []
        self.cost_events: list[dict[str, Any]] = []
        self._conn = None
        dsn = dsn or os.environ.get("DATABASE_URL")
        if dsn:
            try:
                import psycopg

                self._conn = psycopg.connect(dsn, autocommit=True)
            except Exception as exc:  # a missing DB must not stop a measurement
                print(f"    (spend not recorded to the database: {exc})", flush=True)

    # ---- the part that matters ----

    def cost_event(self, **kw: Any) -> None:
        self.cost_events.append(kw)
        if self._conn is None or kw.get("status") != "completed":
            return
        details = dict(kw.get("details") or {})
        details.update({"eval_case": self.case, "eval_arm": self.arm})
        self._conn.execute(
            """
            INSERT INTO cost_events
              (video_id, channel_id, provider, operation, status, units, unit_price_usd, usd, details)
            VALUES (NULL, NULL, %s, %s, %s, %s, %s, %s, %s)
            """,
            (kw["provider"], kw["operation"], "completed", kw["units"],
             kw["unit_price_usd"], kw["usd"], json.dumps(details)),
        )

    def spend(self) -> float:
        return sum(float(e["usd"]) for e in self.cost_events if e["status"] == "completed")

    # ---- the rest: in memory, because an eval run is not a video ----

    def spent_and_reserved(self, video_id: str) -> float:
        return sum(float(e["usd"]) for e in self.cost_events
                   if e["status"] in ("completed", "reserved"))

    def release_reservation(self, video_id: str, provider: str, operation: str) -> None:
        for e in self.cost_events:
            if e["status"] == "reserved" and e["provider"] == provider:
                e["status"] = "refunded"

    def event(self, video_id: str, stage: str, status: str, message: str | None = None) -> None:
        self.events.append((stage, status, message))
        if message and "rejected" in message:
            print(f"    {message[:500]}", flush=True)

    def provider_health(self, provider: str, ok: bool, error: str | None = None) -> None:
        pass


class BeatsCache:
    """Beats reused across runs that could not have changed them.

    Keyed by case, arm and run, so run 2 of an overlay-tuning session reuses
    run 2's beats rather than run 1's — the point is to hold the planner
    constant, not to collapse three runs into one.

    Invalidate by deleting the directory. It is deliberately dumb about what
    the beats depend on: a cache that tried to guess when a prompt had changed
    would eventually be wrong in the direction that silently invalidates a
    measurement.
    """

    def __init__(self, root: Path, arm: str) -> None:
        self.dir = root / "beats-cache" / arm
        self.dir.mkdir(parents=True, exist_ok=True)

    def path(self, case: str, run: int) -> Path:
        return self.dir / f"{case}.{run}.json"

    def get(self, case: str, run: int) -> dict[str, Any] | None:
        p = self.path(case, run)
        if not p.exists():
            return None
        return json.loads(p.read_text(encoding="utf-8"))

    def put(self, case: str, run: int, beats: dict[str, Any]) -> None:
        self.path(case, run).write_text(
            json.dumps(beats, indent=2, ensure_ascii=False), encoding="utf-8"
        )


def call_cost(provider: str, operation: str, model: str | None,
              input_tokens: int, output_tokens: int) -> float:
    """What one call really cost, at the published per-direction rates."""
    in_rate, out_rate = token_rates(provider, operation, model)
    return input_tokens * in_rate + output_tokens * out_rate
