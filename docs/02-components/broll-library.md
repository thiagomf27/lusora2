# B-roll Library

The existing broll-lib-maker service, kept as-is (own code, own API, own
pgvector data), connected over HTTP. It is the system's cost advantage:
ingest + exhaustive AI tagging happen ONCE per source; every later search
is a free index hit. Library assets are preferred over stock over
generation in every default source policy.

## Boundary (Decided)

- The worker's `providers/library/` adapter and the platform's Library
  screens both call the SAME HTTP API. No code imports across the
  boundary.
- The engine never talks to the library (files-only).
- Stable contract = the pipeline method surface: `library_search`,
  `search_or_acquire`, `acquire`, `ingest_url`, `ingest_video`,
  `ingest_image`, `ingest_image_url`, `mark_used`. Extend with keyword
  args, never rename/reorder.

## How beats use it

A beat's `visual_intent` IS the search query (written scout-style: rich,
concrete visual descriptions — that's what vector search ranks well, and
the planner prompt teaches this). `resolve_assets` calls
`library_search(query, filters…)` with the channel's source-policy
filters (`tags`, `niches`, `media_type`, `max_duration`, `channel_id`,
`include_global`) and falls through to stock/AI when the best hit is
below `min_score`. On selection: `mark_used` (per-channel overuse
tracking; hard-block within the same project) and provenance recorded
into the plan.

## Required library changes (small)

1. **`license` field per segment** (from source metadata at ingest) — the
   basis of the channels' anti-copyright rules; filterable in search.
   (OQ-13)
2. Search response should include `score` explicitly (for min_score
   fallthrough) — verify; add if missing.
3. Optional later: usage report endpoint (per channel/per project) for
   the Monitoring screen.

Everything else (profiles, dedup, serial ingest worker, proxy rules,
Streamlit UI as internal tool) stays untouched. Whether the repo is
vendored into the monorepo or kept separate as a submodule: OQ-4.
