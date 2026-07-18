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

**OQ-10 — Theme token final list.** The draft has colors(4), typography
(2+caption preset), motion_feel, grain. Decide: gradient/secondary
accent? lower-third background style? logo/watermark slot? Keep the list
SHORT — every token is forever.

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

All other open questions (OQ-1..20) are closed — see D21–D40 in the
Decision Log.
