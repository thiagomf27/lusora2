-- lusora control plane — initial schema (contracts/db is the source of truth)

CREATE TYPE user_role AS ENUM ('admin', 'manager', 'editor');
CREATE TYPE video_status AS ENUM (
  'draft', 'queued', 'producing', 'rendered', 'in_review',
  'approved', 'sent_back', 'posted', 'error'
);
CREATE TYPE event_status AS ENUM ('started', 'progress', 'done', 'failed');
CREATE TYPE cost_status AS ENUM ('estimated', 'reserved', 'completed', 'failed', 'refunded');
CREATE TYPE asset_source AS ENUM ('library', 'stock', 'ai');

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          user_role NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE channels (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  language       TEXT NOT NULL,
  video_type     TEXT NOT NULL,
  theme          TEXT NOT NULL,
  style_pack     TEXT NOT NULL,
  component_pack TEXT,
  config         JSONB NOT NULL,          -- full channel config doc (schema-validated)
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_channel_grants (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, channel_id)
);

CREATE TABLE videos (
  id           TEXT PRIMARY KEY,
  channel_id   TEXT NOT NULL REFERENCES channels(id),
  title        TEXT NOT NULL,
  status       video_status NOT NULL DEFAULT 'draft',
  cfg          JSONB,                     -- the immutable snapshot (set at enqueue)
  folder_path  TEXT,
  youtube_id   TEXT,
  price_usd    NUMERIC NOT NULL DEFAULT 0, -- denormalized SUM of completed cost_events
  size_bytes   BIGINT,
  error_reason TEXT,
  created_by   TEXT NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX videos_status_idx ON videos (status, created_at);
CREATE INDEX videos_channel_idx ON videos (channel_id, created_at DESC);

CREATE TABLE video_events (
  id       BIGSERIAL PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  stage    TEXT NOT NULL,
  status   event_status NOT NULL,
  message  TEXT,
  ts       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX video_events_video_idx ON video_events (video_id, ts);

CREATE TABLE cost_events (
  id             BIGSERIAL PRIMARY KEY,
  video_id       TEXT REFERENCES videos(id) ON DELETE SET NULL,
  channel_id     TEXT REFERENCES channels(id) ON DELETE SET NULL,
  provider       TEXT NOT NULL,
  operation      TEXT NOT NULL,
  status         cost_status NOT NULL,
  units          NUMERIC NOT NULL DEFAULT 0,
  unit_price_usd NUMERIC NOT NULL DEFAULT 0,
  usd            NUMERIC NOT NULL DEFAULT 0,
  ts             TIMESTAMPTZ NOT NULL DEFAULT now(),
  details        JSONB
);
CREATE INDEX cost_events_video_idx ON cost_events (video_id, ts);
CREATE INDEX cost_events_channel_idx ON cost_events (channel_id, ts);

CREATE TABLE asset_usage (
  id       BIGSERIAL PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  beat_id  TEXT NOT NULL,
  source   asset_source NOT NULL,
  asset_id TEXT,
  license  TEXT,
  provider TEXT,
  ts       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX asset_usage_video_idx ON asset_usage (video_id);

CREATE TABLE notes (
  id       BIGSERIAL PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id),
  text     TEXT NOT NULL,
  ts       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE provider_health (
  provider        TEXT PRIMARY KEY,
  configured      BOOLEAN NOT NULL DEFAULT FALSE,
  last_success_ts TIMESTAMPTZ,
  last_error_ts   TIMESTAMPTZ,
  last_error      TEXT
);

CREATE TABLE worker_heartbeat (
  worker_id        TEXT PRIMARY KEY,
  last_seen        TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_video_id TEXT REFERENCES videos(id) ON DELETE SET NULL
);
