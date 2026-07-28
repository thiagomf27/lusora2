# Milestones

> **STATUS 2026-07-19: ALL MILESTONES M0–M9 ARE BUILT AND DEMONSTRATED**
> (one commit each — see `git log`). Real-provider E2E verified:
> deepseek script+planner, ai33 narration, library+Pexels+AI sourcing,
> ffmpeg AND Remotion renders. See [00-status.md](../00-status.md) for
> how to run everything and the short list of remaining gaps.

Build order for Claude Code. Each milestone ends **demonstrable** and
each depends only on earlier ones.

## M0 — Skeleton (nothing runs, everything checks)
Monorepo scaffold per Repository Structure; `contracts/` package with all
draft schemas as real files; docker-compose with Postgres; CI: schema
validation, typecheck, lint boundaries, empty test suites green.
**Demo:** clone → `docker compose up` → CI green.

## M1 — Control plane
DB migrations (full schema); API: auth, roles, channels CRUD
(schema-validated config), videos CRUD, enqueue with pre-flight +
cfg snapshot, events/costs read endpoints. Minimal UI: login, channels,
queue creation. **Demo:** create channel + video in the browser; row
appears QUEUED with a cfg snapshot.

## M2 — Worker walks the folder
Worker claims QUEUED atomically, creates folder, materializes uploads,
runs stage loop with STUB stages (touch artifacts), emits video_events +
heartbeat; ERROR + resume path works. Pipeline screen shows it live.
**Demo:** enqueue → watch stages tick → kill mid-run → re-queue resumes.

## M3 — First real video (manual creative, real render)
Real TTS + Whisper stages; manual beats.json accepted; compiler v1
(narration beats → plan, SRT alignment, min/max hold enforcement);
validators (beat + plan, collect-all); **ffmpeg renderer v1** (cuts,
Ken Burns, crossfade, plain captions, audio mix) + fixture contract test.
**Demo:** hand-written beat sheet → finished MP4, near-$0.

## M4 — The creative core goes AI
Beat planner agent (style pack + catalog in prompt) + repair loop; script
agent + generator strategies; cost_events from all providers + budget
gate; price table. **Demo:** title in → finished simple video out,
untouched; cost visible per video.

## M5 — Assets get smart
Source policy resolution: library adapter (search, min_score, mark_used,
license filter — includes the library's license migration), stock adapter
+ search cache, ai_image budget-gated; asset provenance into plan +
asset_usage. **Demo:** same video, three policies → visibly different
sourcing + costs.

## M6 — Premium path
Theme runtime; 4–5 catalog components; catalog generation + CI drift
check; Remotion renderer (tracks, transitions/handles, caption presets);
router (auto/pin/capability-fail). **Demo:** overlay-rich video renders
via Remotion in the channel's theme; simple video still routes to ffmpeg.

## M7 — Operate it
Videos grid + video page (stream, review transitions, notes, assets
used); Monitoring (events, provider health, storage, costs); Admin
(users, grants, provider health); retention job. **Demo:** an Editor-role
user reviews and approves on their granted channel only.

## M8 — Edit it
Beat editor (subject, overlay text, re-roll, split/merge) with per-beat
recompile + preview; timeline v1 (trims, transforms, overlay moves) with
lock/provenance; engine Player integration (parity preview). **Demo:**
change beat 12's subject → only its clip changes; manual trim survives a
beat edit.

## M9 — Talk to it
Editor chat agent (beat ops + plan patches, propose→validate→apply);
Library screens over the library API; Panel dashboard; docker-compose
production profile for the VPS. **Demo:** "make the middle faster and add
a map when he mentions the route" → validated diff → apply → re-render.

## M10 — Say it better (prompt packs) ✅ BUILT 2026-07-27
Prompts became data: `contracts/prompts/` + schema + CI gate + mirrored
loaders, the editable/welded split, resolution order (video → channel →
style pack → default) with the resolved text snapshotted into `cfg.json`;
Prompts screen (list, editor with variable palette, composed preview,
costed test run); the two component menus reconciled; script target
length into the style pack (D45). **Demo:** two channels, same pipeline,
visibly different narration voice — changed in the UI, no deploy.

Deferred out of M10: the catalog `when_to_use` copy pass (a taste job on
28 components, not plumbing — do it on the Overlays screen now that the
chat agent reads the same text).

Candidates queued behind it, in value order (see
[LLM Usage](../02-components/llm-usage.md#7-beyond-prompts--more-stages-not-more-autonomy)):
beat sheet v1.1 (`queries[]`, `preferred_sources[]`, `hero`), a metadata
stage, a review pass, a research stage, and `planner.llm = agent` as an
alternative planner strategy (agent-authored beat sheet, same validator,
same pipeline — D2 intact).

## M11 — Look it different (presentation tokens) ✅ BUILT 2026-07-27
Theme gains `surface` + `motion` (D46): schema, resolvers in the theme
runtime, `TemplateOverlay` converted first, then core components in
clusters; per-component motion overrides; theme + style-pack file import
in the UI, copying the `PackImport` pattern. **Demo:** one channel, one
catalog, one style pack, two themes — the same FactCard slides in with
square corners for the serious cut and pops in rounded for the punchy
one, changed in the UI with no deploy.

Deferred out of M11: motion roles (D47 — build when two themes carry
override maps longer than ~6 entries).

## M12 — Hear it (sound) ✅ BUILT 2026-07-28
Sound becomes the fourth data layer (D48–D50). A **sound pack** ships the
files and the cue/bed vocabulary; the **theme** gains `sound` (which cue
for which entrance, mood→bed, the gain numbers); the **style pack** gains
`sfx`/`music` (how often, how long); the channel keeps the master
switches. The compiler places every cue and bed as a concrete plan item,
computes a ducking `gain_envelope` from the real per-sentence TTS
timings, and a new `resolve_audio` stage copies the bytes in. Both
renderers gained sfx support and a `loudnorm` pass to -14 LUFS; the
editor gained an audio lane with the envelope drawn over its bed.

`beat.mood` — in the schema since v1, written by the planner, and read by
nothing — becomes the one thing the model contributes to sound.

**Demo:** the same script on two channels. `doc-slow` + `history-dark`
renders with no cues at all and a somber bed 18 dB under the narration
that lifts in every pause; `breakdown-blitz` + `clean-punchy` renders the
same beats with a tight pop on each counter, capped at 8 a minute, over a
tense bed. Both arrive at -14 LUFS. Neither needed a deploy.

Shipped with SYNTHESIZED placeholder audio (`contracts/sound-packs/build.mjs`)
so the mix is testable offline at $0 — see that folder's README for
swapping in real CC0 recordings, which needs no code change.

## Sequencing notes

- M3 before M4 on purpose: the deterministic spine must produce a real
  video before any AI touches it — every later AI failure then has a
  working manual fallback.
- The library service itself is EXISTING work: only its adapter (M5),
  license migration (M5) and screens (M9) are in scope here.
- After M4 the system already earns its keep (real videos, near-zero
  cost); M5–M9 add quality, control and comfort in that order.
