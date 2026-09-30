# Benchmark: Centralia

The script every slice of the documentary pipeline is watched against
([plan](../../../docs/05-roadmap/documentary-pipeline-plan.md), D100). It is
454 words (~3 minutes). It was written to exercise what the comparison with Dark
Palace found:

| In the script | What it tests |
|---|---|
| An exact place in the opening | the hook; DP's satellite dive |
| Many spoken numbers (60, 1,000 → 5, 2,500, 150 feet, 42 million, 250 years) | counters, the spoken-number check, TTS number reading |
| A named person (Todd Domboski) | the identity rule (D91) |
| An 1800s passage | flashback texture |
| Story turns (1962, 1981, 1992) | light leaks, transitions, music movement |
| "coal town" / "coal towns" | match cut; b-roll staying on the main idea |

## The references

| Render | Where | Notes |
|---|---|---|
| Dark Palace (the target) | `/home/thiago/darkpalace-linux/output/Centralia/Centralia.mp4` | Fish voice at 0.9, YouTube + Commons + Pexels, VHS, narrative effects, no music, no AI images |
| LUSORA `faceless_v3` (the baseline) | `vid_ebe08ffcb529` | `AMHIST_EN_01`, overrides below, Pexels only (library not running) |

The same-script comparison and the user's verdict are in
`/home/thiago/lusora-vs-darkpalace/runs/01-centralia.md`.

## Rendering a slice

Every benchmark render forks the baseline's narration, so no TTS is paid for
and the voice is the same in every render:

```bash
pnpm bench:fork --from vid_ebe08ffcb529 --pipeline documentary \
  --overrides '{"look":{"exclude":{"components":[]}},"output":{"width":1920,"height":1080},"theme":"documentary-dark","style_pack":"documentary","source_policy":{"sfx":{"enabled":true}}}'
```

The first two overrides are the ones the baseline was enqueued with:
`AMHIST_EN_01` normally excludes 29 components and outputs at 720p. From
slice 1 on, the render also uses the preset: the `documentary-dark` theme and
the `documentary` style pack, with the channel's sfx switch turned on (it is
off on `AMHIST_EN_01`). `documentary-dark` has default-editorial's look, so
the picture only changes where a slice changes it. `bench:fork` enqueues
with a fresh snapshot, so the current themes, packs and prompts are used. For
an A/B that must move exactly one variable, use `ab:fork` instead.

**Shorter test renders.** Add `"window":{"end_s":75}` inside `output` in the
overrides to render only the first 75 s (the hook, the counters, the date
stamps, the 1800s passage and the 1962 turn). Every stage still works on the
whole script; only render draws less, about 10 min instead of ~25 capped. Use it
for slices that change what is drawn or heard (1, 5, 7, 8, 9); render the whole
video for the b-roll slices (2-4), where following the main idea only shows
across the story, and for every comparison with DP.

Then run the worker (`cd worker && uv run python -m lusora_worker`). Add a row
to the table below and a notes block using the template.

## Renders

| Slice | Video | Pipeline | Notes |
|---|---|---|---|
| baseline | `vid_ebe08ffcb529` | faceless_v3 v1.2 | run 01; see the comparison folder |
| 1 | `vid_9b4ac7c35f29` | documentary v1.0 + documentary-dark / documentary / synth-doc | 12 SFX (3 count, 3 whoosh, 2 type, 2 swish, pop, slide); render 22 min capped at 1.5 GB. User: "it is good" (2026-09-28) |
| 2 | `vid_330487f758a1` | documentary v1.1 (+ subjects) | 11 subjects, hook to cut 5; all 35 beats tied to a subject; 36 Pexels shots, none repeated; 7 overlays; render 19 min 21 s (MemoryMax 3000M, concurrency 2); QA passed; $0.058. User: "The broll choices are better now" (2026-09-28) |
| 3 | `vid_d70d9c6757b8` | documentary v1.2 (+ pick_shots, claude_cli sonnet) | slice 2's cuts, subjects, beats and overlays copied in, so only the picking differs from `vid_330487f758a1`. 210 candidates, 8 sheets (6 + a 2-sheet second round for 9 weak shots), 74 s; 30 of 35 judged shots have a 3+. Placed: 22×3, 5×4, 1×5, 7×2, 1 identity scene; none repeated. Render 19 min 34 s; QA passed; $0 (subscription). An earlier run, `vid_3f48e5c44d19`, was stopped on a contact-sheet bug (fixed in `90a0e45`) |
| 4 | `vid_b8be0a2d66c6` | documentary v1.3 (+ gather_footage, chain youtube → archive → stock) | slice 2's cuts, subjects, beats and overlays copied in. Searches name the place ("Centralia 1962 dump fire"): 9 Centralia videos (216 shots) + 10 Commons photos, 11 min; judge: 33 of 35 shots 3+. Placed: 24 Pexels, 9 YouTube, 3 archive; none repeated. Render 17 min; QA passed; $0.009; credits.txt written; library copy skipped (library not running). Known weak spot: Commons full-text search returns off-place photos (Mauna Loa steam was placed). Earlier runs: `vid_2b6aa2c6ae38` stopped (searches did not name the place, `fd41183`); this one first failed on the asset_source enum (`88c2ebb`) and was resumed |
| 4b | `vid_d8d581f1bb7a` | documentary v1.4 (+ footage_check, screening, gates) | same inputs as slice 4. Topic check: 11 of 11 subjects covered (19 s), no stop. Screening dropped 89 of 144 YouTube shots (captions, effects, graphics, off-subject); 6 videos (55 shots) + 10 photos in the pool. Judge: 32 of 35 3+ (over the 80% bar), no stop. Render 18 min; QA passed; credits.txt 30 sources; 6 of 6 videos handed to the library |
| 5 | `vid_208b0d961c5b` | documentary v1.4 + hook tier (documentary pack) | slice 2's beats, 4b's footage pool hard-linked in; **render window 0–60 s**. Hook: 10 shots over the first 27.2 s (1.7–3.2 s each, cuts on word onsets), opening on YouTube footage with no graphic over it, KineticTitle "Centralia: The Town Burning From Below" at 27.2 s with the riser from 25.4 s and the hit on it. Judge: 37 of 40 3+. Render 6 min for the minute; QA passed; credits.txt lists only the 13 sources inside the window. Known: the Mauna Loa Commons photo is still placed in the hook. User (2026-09-29): "the title card feels a bit off, but I think the biggest problem is the sfx, I will fix them later" |
| 6a | `vid_9d12164ff2ef` | documentary v1.5 + hook_plan (headlines mode) | 4b's footage, window 0–60 s. Moments: phrase "It began with a routine job that went wrong" on b6 (a headline on b2 lost to the neighbouring counter; the rule now forbids both neighbours). Stopped at the coverage gate (29/40 at 3+); the user used "search more", then approved. Earlier run `vid_8b0a4e6d2872` stopped: a CENTRALIA word card pushed the 1,000 → 5 split off |
| 6b | `vid_c300f762d63b` | documentary v1.5 + satellite dive (D110) | 4b's footage, window 0–60 s. Satellite dive on "the town of Centralia" (b3) at 12.7–17.5 s on NASA GIBS plates (planet → eastern US → Appalachian ridges → Centralia marker); the 1,000 → 5 split moved after it (17.7–22.7 s), which in turn pushed the b6 phrase off. credits.txt credits NASA. Earlier runs `vid_cbf0148c815c`, `vid_6a4a689ea777` stopped: every moment fell next to a graphic, until the prompt marked neighbours and the user chose that the dive wins |

## Viewing-notes template

```
### Slice N: <name>, <video id>, <date>
Hook (first 20 s):
B-roll on the main idea (count the clearly off-topic shots):
Overlays (placement, sound):
Texture / pace (anything that feels stuck):
Sound (voice, SFX, music):
Better than the previous render? Than DP?
```
