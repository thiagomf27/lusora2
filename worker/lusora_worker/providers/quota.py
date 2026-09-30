"""The LLM quota ledger (D116) — Dark Palace's `_motores_fora.json`, ported.

One JSON file, shared by every video on this machine:
`<videos_root>/../llm_quota.json`. A provider that fails for quota or login
is marked out until the time its own message gave (or a default), so the
NEXT call — this video or another one, this process or another worker
thread — skips it instead of failing against it again.

Shape: `{"<provider>": {"out_until": <unix time>, "reason": "..."}}`.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from ..config import videos_root

_LOCK = threading.Lock()

SIX_HOURS = 6 * 3600.0


def _path() -> Path:
    # Same trick sources.py uses for stock-cache: videos_root() already falls
    # back to REPO_ROOT/data/videos when VIDEOS_ROOT is unset or empty, so a
    # test with no config lands in the repo's own data/ instead of crashing.
    return videos_root().parent / "llm_quota.json"


def _read() -> dict:
    try:
        raw = _path().read_text(encoding="utf-8")
    except FileNotFoundError:
        return {}
    try:
        doc = json.loads(raw)
    except ValueError:
        return {}
    return doc if isinstance(doc, dict) else {}


def _write(doc: dict) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), prefix=".llm_quota.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, indent=1)
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def mark_out(provider: str, reason: str, seconds: float) -> None:
    """`provider` may not be tried again until `seconds` from now."""
    with _LOCK:
        doc = _read()
        doc[provider] = {"out_until": time.time() + max(0.0, float(seconds)), "reason": str(reason)[:300]}
        _write(doc)


def out_reason(provider: str) -> str:
    """'' = `provider` may be tried now; otherwise why it may not."""
    entry = _read().get(provider) or {}
    if float(entry.get("out_until") or 0) > time.time():
        return str(entry.get("reason") or "out")
    return ""


# ---------------- classifying a failure (Dark Palace's gemini_esp.py) ----------------

_QUOTA_WORDS = re.compile(r"quota|rate limit|usage limit", re.I)
_AUTH_WORDS = re.compile(r"not logged in|\blogin\b|unauthorized", re.I)
# Dark Palace's `_e_cota_do_dia`: a 429 that is the key's DAILY allowance (or
# `limit: 0` — a model the free tier does not have at all) means "out until
# tomorrow", never "wait 20 seconds".
_DAILY_QUOTA = re.compile(r'limit["\s:]{0,3}0\b|per.?day', re.I)


def _is_daily_quota(text: str) -> bool:
    t = text.lower()
    if _DAILY_QUOTA.search(t):
        return True
    return "quota_exhausted" in t.replace(" ", "") and "perminute" not in t.replace("_", "").replace(" ", "")


def _reset_seconds(text: str) -> float | None:
    """A reset time named IN the failure: `retryDelay: "21s"`, "resets in 3h",
    "try again at 4:26 PM". None when the text names none."""
    m = re.search(r'retry.?delay["\s:]+"?(\d+(?:\.\d+)?)s"?', text, re.I)
    if m:
        return float(m.group(1))
    m = re.search(r"resets?\s+in\s+(\d+(?:\.\d+)?)\s*h", text, re.I)
    if m:
        return float(m.group(1)) * 3600.0
    m = re.search(r"resets?\s+in\s+(\d+(?:\.\d+)?)\s*m(?:in)?\b", text, re.I)
    if m:
        return float(m.group(1)) * 60.0
    m = re.search(r"try again at\s+(\d{1,2}):(\d{2})\s*([AaPp][Mm])", text)
    if m:
        hour, minute, ampm = int(m.group(1)), int(m.group(2)), m.group(3).upper()
        if ampm == "PM" and hour != 12:
            hour += 12
        if ampm == "AM" and hour == 12:
            hour = 0
        now = datetime.now()
        target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if target <= now:
            target += timedelta(days=1)
        return (target - now).total_seconds()
    return None


def _next_midnight_pacific() -> float:
    """Unix timestamp of the next midnight in America/Los_Angeles — where
    Gemini's free-tier daily quota actually resets, not at UTC or the
    server's own midnight."""
    tz = ZoneInfo("America/Los_Angeles")
    now = datetime.now(tz)
    nxt = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return nxt.timestamp()


def classify(provider: str, error_text: str, http_status: int | None = None) -> tuple[bool, float]:
    """(mark this provider out?, for how many seconds).

    A network error or a 5xx is weather, not quota — the chain still moves on
    for THIS call, but the provider is not marked out for the next one."""
    text = error_text or ""
    if http_status == 429 or _QUOTA_WORDS.search(text):
        seconds = _reset_seconds(text)
        if seconds is None:
            seconds = (
                _next_midnight_pacific() - time.time()
                if provider == "gemini" and _is_daily_quota(text)
                else SIX_HOURS
            )
        return True, max(1.0, seconds)
    if http_status in (401, 403) or _AUTH_WORDS.search(text):
        return True, SIX_HOURS
    return False, 0.0
