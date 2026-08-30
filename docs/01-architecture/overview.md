# Overview

Five parts, one machine, one docker-compose.

```
┌───────────────────────────────────────────────────────────────┐
│                        MONOREPO                               │
│                                                               │
│  ┌────────────┐   HTTP/JSON    ┌─────────────────────────┐    │
│  │  PLATFORM   │◄─────────────►│  POSTGRES (+pgvector)   │    │
│  │  web UI +   │               │  control plane:         │    │
│  │  API (TS)   │               │  users, channels, queue,│    │
│  └─────┬──────┘               │  events, costs, usage    │    │
│        │ reads/writes          └───────────▲─────────────┘    │
│        │ beat sheet & plan                 │ polls queue,     │
│        ▼ via API                           │ writes events    │
│  ┌─────────────── video folder ────┐ ┌─────┴────────┐         │
│  │ data plane: script, audio, srt, │ │  WORKER (Py) │         │
│  │ beats.json, edit_plan.json,     │◄┤  the stage   │         │
│  │ clips/, final.mp4, logs, costs  │ │  pipeline    │         │
│  └───────────────▲─────────────────┘ └──┬───────┬───┘         │
│                  │ files only            │       │ HTTP        │
│           ┌──────┴──────┐               │       ▼             │
│           │ ENGINE (TS) │◄──────────────┘  ┌──────────────┐   │
│           │ ffmpeg +    │  CLI subprocess  │ BROLL LIBRARY │   │
│           │ Remotion    │                  │ (existing     │   │
│           │ + catalog   │                  │  service, Py) │   │
│           └─────────────┘                  └──────────────┘   │
└───────────────────────────────────────────────────────────────┘
```

| Part | Language | Role |
|---|---|---|
| **platform** | TypeScript | Web UI (all screens), HTTP API, auth/roles, DB-backed job queue, beat editor + timeline editor, chat agent host |
| **worker** | Python | The deterministic stage pipeline: script → TTS → beats → compile → resolve → validate → render → deliver. Bounded LLM agents INSIDE creative stages only |
| **engine** | TypeScript | Rendering package: ffmpeg renderer (default), Remotion renderer (premium), component catalog, theme system. Consumed as a CLI by the worker and as an npm package by the platform's editor (preview parity) |
| **broll library** | Python | broll-engine (`library/`, a submodule), connected via its HTTP API. Persistent, tagged, vector-searchable asset library — preferred over stock, preferred over generation |
| **postgres** | — | One container: control plane for the platform + pgvector for the library |

## What is deliberately NOT here

- No Trello, no Google Drive (delivery = local/VPS folder; both can return
  later as adapters).
- No microservices, no message broker, no Kubernetes. The queue is a
  Postgres table. Scale ceiling of this design: several thousand
  videos/month on one strong VPS — far beyond current needs.
- No agent-as-orchestrator. LLMs are used inside three bounded roles
  (script writer, beat planner, editor chat agent), each capped and
  validated. Control flow is code and costs zero per video.
