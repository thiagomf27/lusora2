-- The library keeps its own database in the same cluster: one Postgres to run,
-- two schemas that never join. The image is pgvector/pgvector, so the extension
-- the library needs is available here; broll-engine creates it itself on first
-- connect, along with its tables.
--
-- Runs ONLY on an empty data volume (docker-entrypoint-initdb.d semantics). On
-- a cluster that already exists, create it by hand once:
--   docker compose exec postgres createdb -U lusora broll
SELECT 'CREATE DATABASE broll'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'broll')\gexec
