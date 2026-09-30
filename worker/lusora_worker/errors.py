"""Fail loudly with ONE actionable reason (worker error model)."""


class StageError(Exception):
    """A stage failed. The message must say: which stage, which file/provider, why."""

    def __init__(
        self, stage: str, reason: str, marks: list[tuple[str, str]] | None = None
    ) -> None:
        self.stage = stage
        self.reason = reason
        # D116 — (provider, reason) pairs the LLM chain marked out in the
        # quota ledger while answering this call. `chat()`/`see()` have no
        # StageContext to report through, so the mark rides on the exception
        # and the caller that DOES have one reports it.
        self.marks = marks or []
        super().__init__(f"{stage}: {reason}")
