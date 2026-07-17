# library/ — broll-lib-maker (vendored, D24)

Placeholder. Copy the existing broll-lib-maker service into this directory
(its own code, own API, own pgvector data — see
[docs/02-components/broll-library.md](../docs/02-components/broll-library.md)).

Until then:
- the worker's `providers/library/` adapter targets `LIBRARY_API_URL`
  (default http://localhost:8500) and degrades cleanly when unreachable;
- the deploy compose file has a commented-out `library` service.

Required small changes when vendoring (M5):
1. `license` field per segment (ingest capture + search filter) — OQ-13
2. explicit `score` in search responses (verify; add if missing)
