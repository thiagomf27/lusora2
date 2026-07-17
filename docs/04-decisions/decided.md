# Decision Log

What's settled, and why. Changing any of these requires a new entry with
the reason.

| # | Decision | Why (short) |
|---|---|---|
| D1 | Greenfield monorepo; old repos are reference material | Contract drift between repos was experienced directly; one commit = contract + both sides |
| D2 | Deterministic orchestrator; LLMs only as 3 bounded agents (script, beat planner, editor chat) | Farm economics: control flow must cost $0/video and be reproducible; OpenMontage's agent-as-orchestrator taxes every video and can't run unattended |
| D3 | DB = control plane (Postgres), files = data plane | Roles/queue/costs need queries; media needs a filesystem; folder-as-truth keeps resume/manual-first |
| D4 | Postgres + pgvector, docker-compose, identical local/VPS | Library already requires it; concurrent writers (API + worker) rule out SQLite |
| D5 | Beat sheet → deterministic compiler → strict edit plan | AI does judgment, code does arithmetic; solves LLM-format pain; Kinema (beats) and OpenMontage (scene_plan→edit_decisions) independently converge on it |
| D6 | Strict schema'd edit plan retained as THE render artifact | Modularity keystone: any planner × any editor × multiple renderers; rejected: code-gen per video, imperative-only editing, native OTIO |
| D7 | ffmpeg is the DEFAULT renderer; Remotion is the premium path; routing by plan capability | Render compute is the main per-video cost; most farm videos are simple; parity trade-off accepted for simple videos |
| D8 | Effects = catalog components with when_to_use rules + semantic props; theme tokens own ALL appearance | Removes the LLM's weakest skill (consistent taste) from its job; brand consistency by construction; hallucinated effects can't pass validation |
| D9 | Pacing/density are NUMBERS in style packs, enforced by compiler/validator | Turns pacing from advice into a guarantee; enables per-video "more/fewer animations" as a config dial |
| D10 | Personalization = 4 data layers (channel, source policy, theme+style pack, component packs); only packs are code, shipped via git | Channels differ by data, not deploys; UI code upload rejected (security + catalog integrity) |
| D11 | Library stays a separate service behind its HTTP API; beats' visual_intent is the search query | Persistent library beats per-project corpora on cost; two consumers (worker+UI) need one API; boundary already proven |
| D12 | Source policy = ordered chain + filters per asset class, min_score fallthrough, chain-exhausted = fail loud | Order expresses all combinations without enums; honest fallback needs a threshold; silent placeholders reach review unnoticed |
| D13 | Cost lifecycle estimated→reserved→actual + pre-spend budget gate | A budget you check after spending is an alarm, not a budget (pattern adopted from OpenMontage) |
| D14 | Editor = beat panel (semantic) + timeline (precise) over the same video; per-beat recompile; manual edits set locked; recompile skips locked items | Two representations require an explicit sync rule or they destroy each other's work |
| D15 | Chat agent proposes validated operations; apply is an explicit second step | Same constrain/validate principle with the human as final gate |
| D16 | Statuses include a review flow (rendered→in_review→approved/sent_back→posted) tied to the Editor role | The human checkpoint, mapped from OpenMontage's approval checkpoints to a farm-shaped workflow |
| D17 | No Trello/Drive in v1; both may return as queue/storage adapters | Simplification now; adapter seams kept so the door stays open |
| D18 | Secrets in env, never in DB; Admin UI shows provider health only | Plaintext secrets in DB rejected; encryption infra not worth it at this scale |
| D19 | Retention: clips/ deleted after render; final.mp4 N days after POSTED; beats/plan/cfg/logs/costs kept forever | Re-render and audit stay possible for kilobytes; video bytes are the only real storage cost |
| D20 | Tools screen deferred; when built, it's a route group over provider endpoints, not a repo | New repos = new deployment units, not menu items |
| D21 | Project name: **lusora** (closes OQ-1) | Chosen by owner; packages are `@lusora/*`, Python module `lusora_*` |
| D22 | Platform = Next.js full-stack (closes OQ-2) | One app for UI+API, fastest for a 1-person team; routes follow the OpenAPI contract |
| D23 | Tooling: pnpm workspaces (TS) + uv (Py), one CI workflow (closes OQ-3) | As recommended in Repository Structure |
| D24 | Library vendored into `library/` (closes OQ-4) | One clone, one CI; placeholder dir until the code is copied in |
| D25 | Auth = cookie sessions + bcrypt, single-tenant (closes OQ-5) | Simple, enough for local/VPS; JWT only if external consumers appear |
| D26 | One shared `.env` for platform + worker per deployment (closes OQ-6) | Fewer files to drift; secrets never in DB (D18) |
| D27 | Worker wake-up = poll every 3–5s (closes OQ-7) | Dead simple; LISTEN/NOTIFY trivial to add later |
