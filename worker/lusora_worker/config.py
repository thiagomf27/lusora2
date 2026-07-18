"""Worker configuration from the shared repo-root .env (D26)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


def _find_repo_root() -> Path:
    d = Path(__file__).resolve().parent
    for _ in range(6):
        if (d / "pnpm-workspace.yaml").exists():
            return d
        d = d.parent
    return Path.cwd()


REPO_ROOT = _find_repo_root()
load_dotenv(REPO_ROOT / ".env")


@dataclass(frozen=True)
class WorkerConfig:
    database_url: str
    videos_root: Path
    worker_id: str
    poll_seconds: float
    engine_cli: Path
    library_api_url: str

    @staticmethod
    def from_env() -> "WorkerConfig":
        db = os.environ.get("DATABASE_URL")
        if not db:
            raise RuntimeError("missing required env var DATABASE_URL")
        videos_root = Path(os.environ.get("VIDEOS_ROOT") or REPO_ROOT / "data/videos")
        if not videos_root.is_absolute():
            videos_root = REPO_ROOT / videos_root
        engine_cli = Path(os.environ.get("ENGINE_CLI") or REPO_ROOT / "engine/src/cli.ts")
        return WorkerConfig(
            database_url=db,
            videos_root=videos_root,
            worker_id=os.environ.get("WORKER_ID", "worker-1"),
            poll_seconds=float(os.environ.get("WORKER_POLL_SECONDS", "3")),
            engine_cli=engine_cli,
            library_api_url=os.environ.get("LIBRARY_API_URL", "http://localhost:8500"),
        )
