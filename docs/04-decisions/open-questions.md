# Open Questions

The plan of what must be decided or clarified, in the order they block
work. Each has options and a recommendation — decide these in review
sessions, record outcomes in the Decision Log.

## Blocking M0–M1 — ALL DECIDED 2026-07-17 (see D21–D27)

**OQ-1 — Project name.** ✅ DECIDED (D21): **lusora**.

**OQ-2 — TS framework.** ✅ DECIDED (D22): Next.js full-stack.

**OQ-3 — Tooling.** ✅ DECIDED (D23): pnpm workspaces + uv + one CI workflow.

**OQ-4 — Library repo placement.** ✅ DECIDED (D24): vendored into `library/`.

**OQ-5 — Auth.** ✅ DECIDED (D25): cookie sessions + bcrypt, single-tenant.

**OQ-6 — Secrets handling detail.** ✅ DECIDED (D26): one shared `.env`
per deployment for platform + worker; var list documented in `.env.example`.

**OQ-7 — Worker wake-up.** ✅ DECIDED (D27): poll every 3–5s.

## Blocking the creative core (M4–M6) — ALL DECIDED 2026-07-18 (D28–D34)

**OQ-8 — Beat schema edges.** Confirm the `timed` beat variant; decide
whether music-bar-relative beats enter v1 (recommendation: NO — defer
until a music-driven channel exists); minimum beat granularity (can one
beat span < 1 sentence? recommendation: sub-sentence allowed only via
manual split, not planner output).

**OQ-9 — Model per agent role.** Planner: cheap reasoning model
(DeepSeek-class) — confirm; Script: per-channel choice; Chat agent:
mid-tier. Needs a small eval once M4 runs: 10 scripts → beat sheets →
count repair loops per model.

**OQ-10 — Theme token final list.** ✅ DECIDED twice. First at the draft
list (D30, 2026-07-18: colors(4), typography(2+caption preset),
motion_feel, grain — "nothing yet earned an addition"). **Reopened and
re-closed 2026-07-27 (D46)**: presentation style earned it. The theme
gains `surface` (radius, fill, accent_rule) and `motion` (entrance,
easing, per_component) — six optional enums, defaults equal to today's
hardcoded values. Still open in spirit and still answered "no": gradient
/ secondary accent, logo/watermark slot. See
[Theme & Style Packs](../03-contracts/theme-and-style.md).

**OQ-11 — Exact ffmpeg capability boundary.** Draft: cuts, crossfade,
fade-to-black, Ken Burns, static, plain caption preset, audio mix.
Decide: is ONE plain caption style enough for ffmpeg-path videos, or two
(white/boxed)? Each addition is filter-graph work.

**OQ-12 — Pacing numbers per video type.** doc/explainer/breakdown/
listicle need avg/min/max hold + density defaults. This is YOUR taste:
watch 2–3 reference videos per type, count the cuts, write the numbers.
(OpenMontage's tone table is a starting point: elegiac 4.0s → urgent
1.2s.)

**OQ-13 — Library license field.** Confirm the migration (segments.license
+ ingest capture + search filter) and the license vocabulary
(cc0/cc-by/cc-by-sa/owned/stock-licensed/unknown). "unknown" allowed in
which channels?

**OQ-14 — Initial catalog set.** Draft proposes 7 components. Cut to the
4–5 the FIRST channel actually needs; every component must earn its
maintenance.

## Blocking polish (M7+) — DECIDED 2026-07-18 (D35–D40) except OQ-21

**OQ-15 — Price table source + values.** Collect current prices for the
chosen providers (LLM per-token, TTS per-char, image per-unit); decide
update cadence.

**OQ-16 — Local TTS tier.** Piper vs Kokoro as the free voice tier;
per-language voice availability for pt-BR must be tested before
promising it. *(Interim, M3: ffmpeg's built-in flite filter is the
`local` provider — offline, $0, English only. Piper/Kokoro still the
candidates for pt-BR.)*

**OQ-17 — Whisper hosting.** CPU (slow, free) vs small GPU on the VPS.
Measure: minutes of audio per real-time minute on the target VPS.

**OQ-18 — Retention numbers.** N days for final.mp4 after POSTED
(draft: 30); disk alert thresholds for Monitoring.

**OQ-19 — Lock semantics detail.** Which timeline actions set `locked`
(recommendation: any manual change to timing/asset/transform; NOT volume
tweaks); UI affordance to unlock/relock a beat's items.
*(M8 implements the recommendation as written: set_timing / set_transform /
move_overlay lock; set_music_volume does not. Unlock UI still to design.)*

**OQ-20 — UI language.** pt-BR, en, or i18n from day 1
(recommendation: hardcode ONE language now, extract strings later).

**OQ-21 — VPS sizing.** STILL OPEN (the only one). Pick target specs
(CPU cores drive ffmpeg and Remotion concurrency; RAM drives Whisper);
one render worker or N. Measure with M3's fixture on the candidate VPS
before buying — this is a measurement, not a design decision.

All other open questions (OQ-1..20, OQ-22..23) are closed — see D21–D47
in the Decision Log.

## Blocking prompt packs (M10) — ALL DECIDED 2026-07-27 (D42–D45)

**OQ-22 — Prompt pack structure.** ✅ DECIDED as recommended, all four
sub-questions: (a) **one file per prompt, typed by role** (D42);
(b) **files** in `contracts/prompts/`, not DB rows (D42); (c) **yes** —
only the voice/creative half is editable, the contract half is welded
into the code (D43); (d) snapshot the resolved **text** into `cfg.json`
(D44). Resolution order and the per-role variable list are settled with
them — see
[LLM Usage §6](../02-components/llm-usage.md#6-prompt-packs--decided-d42d45).

**OQ-23 — Script length as data.** ✅ DECIDED (D45): **style pack**, with
a per-video override, mirroring `overlays.density`. Unblocks long-form
channels.

## Opened by the editing-quality pass (D51–D59), 2026-08-11

Four questions the work raised and deliberately did not answer. None
blocks anything today; each has a trigger that would make it worth
answering.

**OQ-24 — A locked item whose beat gets absorbed.** The hold floor (D51)
merges a sub-floor beat's visual slot into its neighbour, so that beat
produces no item of its own. A per-beat recompile keeps a locked old item
only when the new plan has an item with the same id, so a human's locked
`v_b7` is dropped if b7 is absorbed on a later compile. It can only happen
when the timings change under an existing plan — re-synthesised audio, a
new SRT — and a beat split has always behaved the same way. **Options:**
(a) leave it (a re-narrated video is a new edit); (b) refuse to absorb a
beat whose old item was locked, by passing the old plan into the compiler,
which makes compilation depend on its own previous output; (c) keep the
dropped item as a hand-added one (`beat_id: null`), which preserves the
work and breaks track contiguity. **Trigger:** the first time someone
loses timeline work this way.

**OQ-25 — Regions for prop-placed components.** 23 of the 26 core entries
declare a `region` (D56). `DateStamp`, `StatTag` and `FactCard` do not,
because where they sit comes from a `position` prop the compiler already
moves out of the caption band — a fixed band would be a lie, so they fall
back to the conservative "assume it reaches the captions". **Options:**
(a) leave it; (b) let a region be declared per enum value of a named prop,
which the catalog schema can express and nothing else needs; (c) have the
compiler derive the band from the prop it just set. **Trigger:** a channel
whose captions visibly jump around corner tags.

**OQ-26 — What `slow` costs.** The short-clip fallback (D55) can ramp
playback instead of looping, and `speed != 1` forces the Remotion route
(D7/D31). One short clip in a video that would otherwise render on ffmpeg
therefore changes the render cost of the whole video, silently. **Options:**
(a) document it and leave the ordering to the channel (today); (b) have the
resolver refuse `slow` when the plan is otherwise ffmpeg-routable; (c) let
the router report the reason as a cost event so the jump is visible in the
numbers rather than only in the bill. **Trigger:** the first month where
render cost moves without an obvious cause.

**OQ-27 — How much of the render QA should look at.** `qa` (D57) samples
N frames and two audio statistics. It cannot see a stutter, a mid-video
black run shorter than the gap between samples, or an overlay that draws
in the wrong place. A full decode (`blackdetect` over the whole file)
would catch runs exactly, at a cost that grows with video length.
**Options:** (a) sampling only (today); (b) sampling plus one full
`blackdetect` pass, since it is one decode and no seeking; (c) a
per-channel `qa.thorough` flag. **Trigger:** the first broken render that
sampling misses.

## Opened by pipelines-as-data (D60), 2026-08-15

**OQ-28 — Who executes the guided checkpoint policy.** ✅ DECIDED (D62):
**the orchestrator, against a file in the video folder.** A video carries
`checkpoint_policy`, overriding the manifest's default, so review mode
stays a POLICY on a pipeline and no `faceless-review.yaml` fork exists.
Under `guided` the loop stops after each gated stage and parks the video
in a new `awaiting_approval` status; the approval is
`approvals/<stage>.json`, which is what lets the worker keep storing no
state of its own — on the re-claim the artifact is present so the stage
skips, the approval is present so the gate passes, and resume ("skip what
exists") covers checkpoints for free. The pending gate is derived (the
first gate with no file) rather than tracked, so nothing can drift.

