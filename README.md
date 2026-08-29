# lusora

Automated, multi-channel YouTube video production platform. One person
queues an idea; the system scripts, narrates, plans, sources assets,
renders and delivers a finished video — cheaply, reproducibly, and with
human review points. Runs on one machine via docker-compose.

Full documentation: [docs/](docs/) (start at [CLAUDE.md](CLAUDE.md)).
**Resuming work? Read [docs/00-status.md](docs/00-status.md) first** —
everything (M0–M9) is built; that file says how to run it and what's left.

## Layout

| dir | what |
|---|---|
| `contracts/` | THE source of truth: JSON Schemas, DB migrations, component catalog + packs, themes, style packs, prices, API types (TS + Py) |
| `platform/` | Next.js web UI + HTTP API + auth/roles + DB queue |
| `worker/` | Python stage pipeline (script → TTS → beats → compile → resolve → validate → render) |
| `engine/` | ffmpeg + Remotion renderers, component catalog, themes; CLI + npm package |
| `library/` | broll-engine, the b-roll library — a git submodule (D71); HTTP boundary only |
| `deploy/` | docker-compose |

## Dev setup

```sh
pnpm install
pnpm run ci                      # schemas + boundaries + typecheck + TS tests
cd worker && uv run pytest       # Python tests

cp .env.example .env             # fill DATABASE_URL etc.
pnpm --filter @lusora/platform run db:migrate
pnpm --filter @lusora/platform run db:seed     # creates the admin user
pnpm --filter @lusora/platform run dev         # http://localhost:3000
cd worker && uv run python -m lusora_worker    # start the worker
```

Or with docker: `cd deploy && docker compose up`.
