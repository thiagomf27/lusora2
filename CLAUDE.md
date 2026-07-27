# LUSORA — Development Documentation

> Working name; see open question OQ-1.

An automated, multi-channel YouTube video production platform. One person
queues an idea; the system scripts, narrates, plans, sources assets,
renders and delivers a finished video — cheaply, reproducibly, and with
human review points. Runs on one machine (laptop or VPS) via
docker-compose.

**Design goals, in priority order: personalization, modularity, low cost.**

## Reading order

### 00 — Status ★ read first when resuming work
- [Implementation Status](00-status.md) — what is BUILT (all of M0–M9),
  how to run it on this machine, providers wired, gotchas, known gaps.
  The docs below describe the design; that file describes reality.

### 01 — Architecture
- [Overview](01-architecture/overview.md) — the five parts and the one diagram
- [Core Principles](01-architecture/core-principles.md) — 7 rules everything follows
- [Repository Structure](01-architecture/repository-structure.md) — the monorepo
- [Data Flow](01-architecture/data-flow.md) — one video traced end to end

### 02 — Components
- [Platform](02-components/platform.md) — web UI, API, roles, screens
- [Worker Pipeline](02-components/worker-pipeline.md) — the production stages
- [LLM Usage](02-components/llm-usage.md) — every prompt, what its output
  must guarantee, known gaps, and the prompt-pack plan ★ read before
  editing any prompt
- [Engine](02-components/engine.md) — renderers, component catalog, themes
- [B-roll Library](02-components/broll-library.md) — the existing service and its boundary

### 03 — Contracts (the actual spec)
- [Beat Sheet](03-contracts/beat-sheet.md) — the AI's output format ★ core
- [Edit Plan](03-contracts/edit-plan.md) — the compiled, strict timeline
- [Theme & Style Packs](03-contracts/theme-and-style.md) — personalization as data
- [Channel Config & Source Policy](03-contracts/channel-config.md)
- [Component Catalog](03-contracts/component-catalog.md) — the effects menu
- [Database](03-contracts/database.md) — the control plane schema
- [API Surface](03-contracts/api.md)
- [Renderer Interface & Routing](03-contracts/renderer-interface.md)
- [Cost Tracking](03-contracts/costs.md)

### 04 — Decisions
- [Decision Log](04-decisions/decided.md) — what's settled and WHY
- [Open Questions](04-decisions/open-questions.md) — what must be decided, with options ★ read before building

### 05 — Roadmap
- [Milestones](05-roadmap/milestones.md) — build order for Claude Code

### 07 — Authoring
- [Authoring Guide](07-authoring.md) — ready-made prompts for adding a
  component, a theme or a style pack, with the files to attach as models

## Conventions

- **Decided** — settled in the Decision Log; changing it requires a new entry.
- **Draft** — the contract is written but fields may still move (marked per section).
- **OQ-n** — references an open question.
