# library/ — broll-engine (submodule, D71)

`broll-engine/` is a **git submodule** on
[thiagomf27/broll-engine](https://github.com/thiagomf27/broll-engine), not a
copy. It replaced a hand-vendored snapshot that had drifted in both
directions — gaining four lusora-only endpoints the library never received,
while missing the review stage, uploads, scene detection and purge. A
submodule cannot drift that way: it is a pinned commit, and edits happen in
broll-engine, where the code lives.

```sh
git clone --recurse-submodules …          # fresh clone
git submodule update --init --recursive   # existing clone
```

CI checks out with `submodules: recursive`.

## The boundary

lusora reaches the library **only over HTTP** (D11) — `LIBRARY_API_URL`, the
worker's `LibraryAdapter` and the platform's `/api/library/[...path]` proxy.
Nothing imports across it, and `scripts/lint-boundaries.mjs` now fails the
build on an `import broll` from the worker. The library owns its own
database, its own clip bytes and its own ingest queue.

## Running it

In docker-compose it is the `library` service on port 8321, with its own
database in the shared Postgres and a named volume for clips. Standalone:

```sh
cd library/broll-engine
python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn api:app --host 127.0.0.1 --port 8321   # API + ingest worker
.venv/bin/streamlit run broll_ui.py                      # ingest/review UI
```

It reads its own `.env` (`ZAI_API_KEY` for GLM tagging, `YTDLP_PROXY`,
`BROLL_CLIP_ROOT`); the deployment values lusora needs are documented in
the repo root's `.env.example`. See `broll-engine/CLAUDE.md` for its design
and `docs/05-roadmap/broll-integration.md` for how the two fit together.

## Updating the pin

```sh
cd library/broll-engine && git fetch && git checkout <commit> && cd -
git add library/broll-engine && git commit
```

The pin currently sits on broll-engine's
`claude/lusora-automation-architecture-eh0hpk` branch, which carries the
`mark_used` endpoint, the `licenses` any-of filter and the `sim` field the
worker's adapter requires. **Re-pin to `master` once that branch merges** —
an older commit than this one will not serve this worker.
