# Database — Draft v1 (control plane only)

Postgres, one instance, two databases: `platform` (below) and the
library's existing DB. Migrations live in `contracts/db/` — the schema is
a contract like any other.

```sql
users            (id, email, name, password_hash, role ENUM(admin,manager,editor),
                  created_at, active)
user_channel_grants (user_id, channel_id)         -- managers/editors scope

channels         (id, name, language, video_type, theme, style_pack,
                  component_pack, config JSONB,   -- full channel config doc
                  active, created_at)

videos           (id, channel_id, title, status ENUM(draft,queued,producing,
                  rendered,in_review,approved,sent_back,posted,error),
                  cfg JSONB,                      -- the immutable snapshot
                  folder_path, youtube_id NULL,
                  price_usd NUMERIC DEFAULT 0,    -- aggregate of cost_events
                  size_bytes NULL, error_reason NULL,
                  created_by, created_at, updated_at)

video_events     (id, video_id, stage, status ENUM(started,progress,done,failed),
                  message, ts)                    -- feeds Pipeline/Monitoring UI

cost_events      (id, video_id NULL, channel_id NULL, provider, operation,
                  status ENUM(estimated,reserved,completed,failed,refunded),
                  units, unit_price_usd, usd, ts, details)

asset_usage      (id, video_id, beat_id, source ENUM(library,stock,ai),
                  asset_id, license, provider, ts) -- "broll used" + audits

notes            (id, video_id, user_id, text, ts)

provider_health  (provider PK, configured BOOL, last_success_ts,
                  last_error_ts, last_error)       -- Admin/Monitoring view

worker_heartbeat (worker_id PK, last_seen, current_video_id NULL)
```

## Rules

- **The queue is `videos`**: worker claims with
  `UPDATE … SET status='producing', … WHERE id = (SELECT id FROM videos
  WHERE status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP
  LOCKED) RETURNING *` — atomic, no broker needed. Wake-up: poll every
  few seconds; LISTEN/NOTIFY later if wanted (OQ-7).
- The DB never stores artifacts or claims they exist — `folder_path` +
  events only. Beat sheet and plan are served THROUGH the API from files,
  not mirrored into tables.
- `price_usd` is a denormalized SUM of the video's completed cost_events
  (updated by the worker after each event) — cheap reads for the grid.
- Editor-role writes are restricted to: status transitions among
  rendered/in_review/approved/sent_back/posted, and `notes`.
