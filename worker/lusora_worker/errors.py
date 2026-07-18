"""Fail loudly with ONE actionable reason (worker error model)."""


class StageError(Exception):
    """A stage failed. The message must say: which stage, which file/provider, why."""

    def __init__(self, stage: str, reason: str) -> None:
        self.stage = stage
        self.reason = reason
        super().__init__(f"{stage}: {reason}")
