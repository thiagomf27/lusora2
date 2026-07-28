# Channel Config & Source Policy — Draft v1

A channel row in the DB, validated against the schema, edited on the
Channels screen. Per-video overrides deep-merge at enqueue; `chain` lists
replace wholesale (no list merging). Result is the immutable `cfg.json`.

```yaml
channel_id: HIST_BR_01
name: "Histórias da Guerra"
language: pt-BR
video_type: doc                    # selects default style pack
theme: history-dark
style_pack: doc-slow
component_pack: null               # or a named engine pack
voice: { provider: ai33, voice_id: "…" }
script: { generator: scriptforge, llm: deepseek }
captions: { enabled: true }        # preset comes from the theme
renderer: auto                     # auto | ffmpeg | remotion (pin)
budget: { max_usd_per_video: 0.80 }
retention: { clips: on_render, final_mp4_days_after_posted: 30 }

source_policy:
  visual:
    chain:
      - source: library
        media_types: [video_clip, image]
        profile: default
        include_global: true
        niches: [history, war]
        tags: []
        licenses: [cc0, cc-by, owned]     # anti-copyright rule (needs OQ-13)
        min_score: 0.55
      - source: stock
        providers: [pexels]
        media_types: [video]
      - source: ai_image
        provider: ai33
        style: "archival photo, desaturated, film grain"
    max_clip_seconds: 12
    orientation: landscape
  sound_pack: doc-restrained          # optional; overrides theme.sound.pack
  music:
    enabled: true                     # master switch for this channel
    default_volume: 1                 # a TRIM on the theme's levels, not the level
  sfx:
    enabled: true                     # master switch
    default_gain: 0.28                # optional; overrides theme.sound.gain.sfx
```

## Semantics (Decided)

- `visual.chain` order = preference; omission = forbidden. Per beat,
  `resolve_assets` walks the chain and stops at the first acceptable
  asset; `min_score` is what makes fallthrough honest (without it the
  library always returns *something*).
- Every library filter maps 1:1 to a `library_search` parameter — the
  policy is stored arguments, not a query language.
- `music.enabled` / `sfx.enabled` are the **master switches for sound**
  (D48): with either false, nothing is produced for it whatever the theme
  and style pack say, and `resolve_audio` no-ops. Both default TRUE. Like
  every config field they deep-merge at enqueue, so silencing one video is
  an override and needs no code.
- `music.default_volume` is a **trim**, not a level: 1 means "as the theme
  mixed it". The absolute levels are `theme.sound.gain.music_duck` /
  `music_lift`, so the mix lives in one place. `music.chain` /
  `audio_library` remain declared and unimplemented — sound comes from the
  sound pack named here or in the theme, not from a source chain.
- Chain exhausted with nothing found → the stage FAILS with the beat id
  and query (consistent fail-loud; placeholder-and-flag rejected — silent
  gaps reach review).
- `budget.max_usd_per_video` is enforced pre-spend by the cost gate (see
  [Costs](costs.md)); a video that would exceed it stops with an
  actionable event before generating.
- overlay density / pacing overrides ride the same merge (they live in
  the style pack section of the snapshot).
