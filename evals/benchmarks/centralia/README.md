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
| 1 | `vid_9b4ac7c35f29` | documentary v1.0 + documentary-dark / documentary / synth-doc | 12 SFX (3 count, 3 whoosh, 2 type, 2 swish, pop, slide); render 22 min capped at 1.5 GB |

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
