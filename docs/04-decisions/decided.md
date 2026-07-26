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
| D28 | Beat schema: `timed` variant confirmed; music-bar-relative beats NOT in v1; sub-sentence beats only via manual split (closes OQ-8) | As recommended — no music-driven channel exists yet |
| D29 | Models per role: planner + script default `deepseek` (cheap); chat agent deepseek (anthropic optional via env); per-channel override stays (closes OQ-9) | Cheap by default; eval revisit once real usage accumulates |
| D30 | Theme tokens frozen at the draft list: colors(4), typography(2+caption preset), motion_feel, grain (closes OQ-10) | Every token is forever; nothing yet earned an addition |
| D31 | ffmpeg caption capability = ONE plain preset; anything styled routes to Remotion (closes OQ-11) | Each addition is filter-graph work; Remotion covers styled cheaply |
| D32 | Pacing numbers per video type (see style-packs/): doc 4.0/2.5/8.0 normal, explainer 3.2/2.0/6.0 normal, breakdown 2.6/1.6/5.0 high, listicle 2.2/1.4/4.5 high (closes OQ-12) | Starting numbers from the OpenMontage tone table scale; tune per channel with real videos |
| D33 | License vocabulary cc0/cc-by/cc-by-sa/owned/stock-licensed/unknown; library migration shipped (column+ingest capture+search filter); `unknown` is excluded unless a channel lists it explicitly (closes OQ-13) | Omission = forbidden matches source-policy semantics (D12) |
| D34 | ~~superseded by D41~~  Initial catalog = 5 components: TitleCard, LowerThird, AnimatedPercentage, ComparisonBars, AnimatedMap; QuoteCard/TimelineStrip deferred until a channel needs them (closed OQ-14) | Every component must earn its maintenance |
| D35 | Price table = contracts/prices.json, versioned in git, updated manually when a provider/rate changes; ai33 charges opaque credits — recorded in cost details, per-char USD estimated (closes OQ-15) | Unknown provider+operation stays a hard error |
| D36 | Local TTS tier = ffmpeg flite (en, $0); other languages (incl. pt-BR) via the ai33 aggregator's edge/minimax voices (closes OQ-16) | flite ships inside ffmpeg — zero extra install; ai33 already integrated |
| D37 | Whisper = faster-whisper on CPU, optional dep, used only for human-provided audio without SRT (closes OQ-17) | TTS adapters emit exact timings, so Whisper is the exception path |
| D38 | Retention numbers: final.mp4 30 days after POSTED; storage warning threshold 20 GB on Monitoring (closes OQ-18) | Draft confirmed |
| D39 | Lock semantics as recommended: timing/asset/transform edits lock; volume tweaks don't (closes OQ-19) | Implemented in M8 |
| D40 | UI language: English hardcoded; extract strings when a second language is actually needed (closes OQ-20) | i18n now is pure cost |
| D41 | Core catalog = the 26-component `core` pack (five clusters: titles/statements, cards/lists, quantities, sources/exhibits, time/place); the original five move to `components/example_lib` as unregistered reference copies (supersedes D34) | The five covered the contract, not the channels — a documentary needs quotes, documents, dossiers and dated events, and each was becoming a special case. Sibling disambiguation now lives in `when_not_to_use`; RegionHighlight stays editor-only until a polygon source exists |
