"""Control-plane access: claim, events, costs, heartbeat.

The DB never claims an artifact exists (Core Principle 1) — the worker
reports progress here and decides everything by files.
"""

from __future__ import annotations

import json
from typing import Any

import psycopg
from psycopg.rows import dict_row


class Db:
    def __init__(self, database_url: str) -> None:
        self._url = database_url
        self._conn: psycopg.Connection[Any] | None = None

    @property
    def conn(self) -> psycopg.Connection[Any]:
        if self._conn is None or self._conn.closed:
            self._conn = psycopg.connect(self._url, row_factory=dict_row, autocommit=True)
        return self._conn

    def claim_next(self, worker_id: str) -> dict[str, Any] | None:
        """Atomically claim the oldest QUEUED video (the row is the lock)."""
        row = self.conn.execute(
            """
            UPDATE videos SET status = 'producing', updated_at = now()
            WHERE id = (
              SELECT id FROM videos WHERE status = 'queued'
              ORDER BY created_at LIMIT 1
              FOR UPDATE SKIP LOCKED
            )
            RETURNING *
            """
        ).fetchone()
        return row

    def event(self, video_id: str, stage: str, status: str, message: str | None = None) -> None:
        self.conn.execute(
            "INSERT INTO video_events (video_id, stage, status, message) VALUES (%s, %s, %s, %s)",
            (video_id, stage, status, message),
        )

    def set_status(self, video_id: str, status: str, error_reason: str | None = None) -> None:
        self.conn.execute(
            "UPDATE videos SET status = %s, error_reason = %s, updated_at = now() WHERE id = %s",
            (status, error_reason, video_id),
        )

    def set_size(self, video_id: str, size_bytes: int) -> None:
        self.conn.execute(
            "UPDATE videos SET size_bytes = %s, updated_at = now() WHERE id = %s",
            (size_bytes, video_id),
        )

    def cost_event(
        self,
        *,
        video_id: str | None,
        channel_id: str | None,
        provider: str,
        operation: str,
        status: str,
        units: float,
        unit_price_usd: float,
        usd: float,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.conn.execute(
            """
            INSERT INTO cost_events
              (video_id, channel_id, provider, operation, status, units, unit_price_usd, usd, details)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                video_id,
                channel_id,
                provider,
                operation,
                status,
                units,
                unit_price_usd,
                usd,
                json.dumps(details) if details else None,
            ),
        )
        if status == "completed" and video_id:
            self.conn.execute(
                """
                UPDATE videos SET price_usd = (
                  SELECT COALESCE(sum(usd), 0) FROM cost_events
                  WHERE video_id = %s AND status = 'completed'
                ) WHERE id = %s
                """,
                (video_id, video_id),
            )

    def spent_and_reserved(self, video_id: str) -> float:
        row = self.conn.execute(
            """
            SELECT COALESCE(sum(usd), 0) AS total FROM cost_events
            WHERE video_id = %s AND status IN ('completed', 'reserved')
            """,
            (video_id,),
        ).fetchone()
        return float(row["total"]) if row else 0.0

    def release_reservation(self, video_id: str, provider: str, operation: str) -> None:
        """Mark this operation's open reservations refunded (after completion or failure)."""
        self.conn.execute(
            """
            UPDATE cost_events SET status = 'refunded'
            WHERE video_id = %s AND provider = %s AND operation = %s AND status = 'reserved'
            """,
            (video_id, provider, operation),
        )

    def asset_usage(
        self,
        video_id: str,
        beat_id: str,
        source: str,
        asset_id: str | None,
        license: str | None,
        provider: str | None,
    ) -> None:
        self.conn.execute(
            """
            INSERT INTO asset_usage (video_id, beat_id, source, asset_id, license, provider)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (video_id, beat_id, source, asset_id, license, provider),
        )

    def heartbeat(self, worker_id: str, current_video_id: str | None) -> None:
        self.conn.execute(
            """
            INSERT INTO worker_heartbeat (worker_id, last_seen, current_video_id)
            VALUES (%s, now(), %s)
            ON CONFLICT (worker_id) DO UPDATE SET last_seen = now(), current_video_id = EXCLUDED.current_video_id
            """,
            (worker_id, current_video_id),
        )

    def provider_health(self, provider: str, ok: bool, error: str | None = None) -> None:
        if ok:
            self.conn.execute(
                """
                INSERT INTO provider_health (provider, configured, last_success_ts)
                VALUES (%s, TRUE, now())
                ON CONFLICT (provider) DO UPDATE SET configured = TRUE, last_success_ts = now()
                """,
                (provider,),
            )
        else:
            self.conn.execute(
                """
                INSERT INTO provider_health (provider, configured, last_error_ts, last_error)
                VALUES (%s, TRUE, now(), %s)
                ON CONFLICT (provider) DO UPDATE SET last_error_ts = now(), last_error = EXCLUDED.last_error
                """,
                (provider, error),
            )
