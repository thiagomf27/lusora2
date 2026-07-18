"""Cost lifecycle + the budget gate (D13).

estimate -> reserve -> run -> complete|fail (-> refund reservation).
A budget you check after spending is an alarm, not a budget: the gate
runs BEFORE the operation.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator

import lusora_contracts

from .context import StageContext
from .errors import StageError


def unit_price(provider: str, operation: str) -> float:
    """Price lookup. Unknown provider+operation = hard error, never silent $0 (OQ-15)."""
    prices = lusora_contracts.load_prices()["prices"]
    try:
        return float(prices[provider][operation]["unit_price_usd"])
    except KeyError:
        raise StageError(
            "costs",
            f"no price for provider '{provider}' operation '{operation}' in contracts/prices.json — add it before spending",
        )


@contextmanager
def budget_gate(
    ctx: StageContext,
    *,
    stage: str,
    provider: str,
    operation: str,
    estimated_units: float,
    details: dict[str, Any] | None = None,
) -> Iterator["CostRecorder"]:
    """Estimate + reserve before running; complete with actuals after.

    Raises StageError (stopping the video with an actionable reason)
    if the estimate would exceed cfg.budget.max_usd_per_video.
    """
    price = unit_price(provider, operation)
    estimate = estimated_units * price
    budget = float((ctx.cfg.get("budget") or {}).get("max_usd_per_video", float("inf")))
    spent = ctx.db.spent_and_reserved(ctx.video_id)

    common = dict(
        video_id=ctx.video_id,
        channel_id=ctx.channel_id,
        provider=provider,
        operation=operation,
        unit_price_usd=price,
    )
    ctx.db.cost_event(
        **common, status="estimated", units=estimated_units, usd=estimate, details=details
    )
    if spent + estimate > budget:
        raise StageError(
            stage,
            f"{operation} estimate ${estimate:.4f} would exceed budget ${budget:.2f} "
            f"(spent+reserved ${spent:.4f}) — raise the budget, change the source policy, or edit the input, then re-queue",
        )
    ctx.db.cost_event(
        **common, status="reserved", units=estimated_units, usd=estimate, details=details
    )

    recorder = CostRecorder(ctx, common, details)
    try:
        yield recorder
    except Exception:
        ctx.db.release_reservation(ctx.video_id, provider, operation)
        ctx.db.cost_event(**common, status="failed", units=0, usd=0, details=details)
        raise
    else:
        ctx.db.release_reservation(ctx.video_id, provider, operation)
        actual_units = recorder.actual_units if recorder.actual_units is not None else estimated_units
        ctx.db.cost_event(
            **common,
            status="completed",
            units=actual_units,
            usd=actual_units * price,
            details=recorder.detail_overrides or details,
        )


class CostRecorder:
    def __init__(
        self, ctx: StageContext, common: dict[str, Any], details: dict[str, Any] | None
    ) -> None:
        self._ctx = ctx
        self._common = common
        self.actual_units: float | None = None
        self.detail_overrides: dict[str, Any] | None = None

    def actual(self, units: float, details: dict[str, Any] | None = None) -> None:
        self.actual_units = units
        if details:
            self.detail_overrides = details
