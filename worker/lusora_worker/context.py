"""Shared stage context: one claimed video, its folder, its cfg snapshot."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .config import WorkerConfig
from .db import Db
from .errors import StageError


@dataclass
class StageContext:
    video: dict[str, Any]
    folder: Path
    cfg: dict[str, Any]
    db: Db
    config: WorkerConfig

    @property
    def video_id(self) -> str:
        return str(self.video["id"])

    @property
    def channel_id(self) -> str:
        return str(self.video["channel_id"])

    def artifact(self, name: str) -> Path:
        return self.folder / name

    def has(self, name: str) -> bool:
        p = self.artifact(name)
        return p.exists() and (p.is_dir() or p.stat().st_size > 0)

    def read_json(self, name: str) -> Any:
        try:
            return json.loads(self.artifact(name).read_text(encoding="utf-8"))
        except FileNotFoundError:
            raise StageError("read", f"{name} missing from {self.folder}")
        except json.JSONDecodeError as e:
            raise StageError("read", f"{name} is not valid JSON: {e}")

    def write_json(self, name: str, data: Any) -> None:
        self.artifact(name).write_text(
            json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )

    def log(self, line: str) -> None:
        with (self.folder / "production.log").open("a", encoding="utf-8") as f:
            f.write(line.rstrip() + "\n")
