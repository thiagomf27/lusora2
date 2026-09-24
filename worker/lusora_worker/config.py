"""Worker configuration from the shared repo-root .env (D26)."""

from __future__ import annotations

import os
import socket
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


def parallelism(name: str, default: int) -> int:
    """How many network calls of one kind may run at once — deployment config
    (a machine and a rate limit), never channel config: it changes when the
    output arrives, not what it is, so it is not snapshotted into cfg.json.
    Anything unreadable or below 1 means serial."""
    try:
        return max(1, int(os.environ.get(name) or default))
    except ValueError:
        return 1


def videos_root() -> Path:
    root = Path(os.environ.get("VIDEOS_ROOT") or REPO_ROOT / "data/videos")
    return root if root.is_absolute() else REPO_ROOT / root


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
        engine_cli = Path(os.environ.get("ENGINE_CLI") or REPO_ROOT / "engine/src/cli.ts")
        return WorkerConfig(
            database_url=db,
            videos_root=videos_root(),
            # unset or empty -> the hostname, which is unique per container, so
            # `docker compose up --scale worker=N` needs no per-replica config
            worker_id=os.environ.get("WORKER_ID") or socket.gethostname(),
            poll_seconds=float(os.environ.get("WORKER_POLL_SECONDS", "3")),
            engine_cli=engine_cli,
            library_api_url=os.environ.get("LIBRARY_API_URL", "http://localhost:8321"),
        )
