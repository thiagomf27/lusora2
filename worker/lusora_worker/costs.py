"""Cost lifecycle + the budget gate (D13).

estimate -> reserve -> run -> complete|fail (-> refund reservation).
A budget you check after spending is an alarm, not a budget: the gate
runs BEFORE the operation.
"""

from __future__ import annotations

import threading
from contextlib import contextmanager
from typing import Any, Iterator

import lusora_contracts

from .context import StageContext
from .errors import StageError

# One per process: budget_gate's read-then-reserve must not interleave.
_GATE_LOCK = threading.Lock()


def _entry(provider: str, operation: str) -> dict[str, Any]:
    """Unknown provider+operation is a hard error, never a silent $0 (D13)."""
    prices = lusora_contracts.load_prices()["prices"]
    try:
        return prices[provider][operation]
    except KeyError:
        raise StageError(
            "costs",
            f"no price for provider '{provider}' operation '{operation}' in contracts/prices.json — add it before spending",
        )


def token_rates(provider: str, operation: str, model: str | None = None) -> tuple[float, float]:
    """(usd per input token, usd per output token) for one LLM call.

    Billed per DIRECTION because a reasoning model emits three to five times
    more output than input and its reasoning tokens bill as OUTPUT. A single
    blended rate under-reported real spend by roughly an order of magnitude —
    the table said $0.25 where about $4 had been billed — and a budget gate
    that cannot see the money cannot stop anything.

    Priced per MODEL too: v4-pro output is three times v4-flash's, so a channel
    that switches model changes what a video costs by more than any prompt
    change in this repo.
    """
    entry = _entry(provider, operation)
    rates = entry
    by_model = entry.get("by_model")
    if by_model:
        name = model or entry.get("default_model")
        rates = by_model.get(str(name))
        if rates is None:
            raise StageError(
                "costs",
                f"no price for model '{name}' under {provider}.{operation} in "
                f"contracts/prices.json — known: {sorted(by_model)}. Add it before spending.",
            )
    return (
        float(rates.get("input_per_1m", 0.0)) / 1_000_000,
        float(rates.get("output_per_1m", 0.0)) / 1_000_000,
    )


def unit_price(provider: str, operation: str) -> float:
    """The per-unit price for a NON-token operation (a char, a second, an image)."""
    entry = _entry(provider, operation)
    if "unit_price_usd" not in entry:
        raise StageError(
            "costs",
            f"{provider}.{operation} is priced per direction (input/output tokens) — "
            "use token_rates(), not unit_price()",
        )
    return float(entry["unit_price_usd"])


@contextmanager
def budget_gate(
    ctx: StageContext,
    *,
    stage: str,
    provider: str,
    operation: str,
    estimated_units: float,
    details: dict[str, Any] | None = None,
    model: str | None = None,
) -> Iterator["CostRecorder"]:
    """Estimate + reserve before running; complete with actuals after.

    Raises StageError (stopping the video with an actionable reason)
    if the estimate would exceed cfg.budget.max_usd_per_video.

    An `llm.*` operation is billed per direction from the recorder's actual
    input/output split; everything else keeps one price on its own unit. The
    ESTIMATE cannot know the split, so it prices the reservation at the OUTPUT
    rate — the expensive side, and the one a reasoning model spends most of.
    """
    tokens = operation.startswith("llm.")
    in_rate, out_rate = token_rates(provider, operation, model) if tokens else (0.0, 0.0)
    price = out_rate if tokens else unit_price(provider, operation)
    estimate = estimated_units * price
    budget = float((ctx.cfg.get("budget") or {}).get("max_usd_per_video", float("inf")))

    common = dict(
        video_id=ctx.video_id,
        channel_id=ctx.channel_id,
        provider=provider,
        operation=operation,
        unit_price_usd=price,
    )
    # Read-then-reserve is one step: two calls running in parallel (overlay
    # chunks, TTS parts) would otherwise both read the same spend, both fit,
    # and together pass a budget neither could have passed alone.
    with _GATE_LOCK:
        spent = ctx.db.spent_and_reserved(ctx.video_id)
        ctx.db.cost_event(
            **common, status="estimated", units=estimated_units, usd=estimate, details=details
        )
        if spent + estimate > budget:
            raise StageError(
                stage,
                f"{operation} estimate ${estimate:.4f} would exceed budget ${budget:.2f} "
                f"(spent+reserved ${spent:.4f}) — raise the budget, change the source policy, or edit the input, then re-queue",
            )
        reservation = ctx.db.cost_event(
            **common, status="reserved", units=estimated_units, usd=estimate, details=details
        )

    recorder = CostRecorder(ctx, common, details, in_rate, out_rate, tokens)
    try:
        yield recorder
    except Exception:
        ctx.db.release_reservation(ctx.video_id, provider, operation, event_id=reservation)
        ctx.db.cost_event(**common, status="failed", units=0, usd=0, details=details)
        raise
    else:
        ctx.db.release_reservation(ctx.video_id, provider, operation, event_id=reservation)
        actual_units = recorder.actual_units if recorder.actual_units is not None else estimated_units
        ctx.db.cost_event(
            **common,
            status="completed",
            units=actual_units,
            usd=recorder.usd(actual_units, price),
            details=recorder.detail_overrides or details,
        )


class CostRecorder:
    def __init__(
        self,
        ctx: StageContext,
        common: dict[str, Any],
        details: dict[str, Any] | None,
        in_rate: float = 0.0,
        out_rate: float = 0.0,
        per_direction: bool = False,
    ) -> None:
        self._ctx = ctx
        self._common = common
        self._in_rate = in_rate
        self._out_rate = out_rate
        self._per_direction = per_direction
        self.actual_units: float | None = None
        self.detail_overrides: dict[str, Any] | None = None

    def usd(self, actual_units: float, fallback_price: float) -> float:
        """The real cost, from the direction split when the caller reported one.

        Falls back to the flat rate when it did not — an adapter that reports
        only a total is charged at the OUTPUT rate rather than a blended one,
        because under-reporting is the failure that let $4 look like $0.25.
        """
        split = self.detail_overrides or {}
        if self._per_direction and "input_tokens" in split and "output_tokens" in split:
            return float(split["input_tokens"]) * self._in_rate + float(
                split["output_tokens"]
            ) * self._out_rate
        return actual_units * fallback_price

    def actual(self, units: float, details: dict[str, Any] | None = None) -> None:
        self.actual_units = units
        if details:
            self.detail_overrides = details
