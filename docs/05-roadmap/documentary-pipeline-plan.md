# Documentary pipeline: Dark Palace's production on LUSORA's architecture

Dark Palace's Doc Geral Studio (DP) is a finished, Windows-only script-to-MP4
documentary app. On the same script (run 01, Centralia) it produced a better
hook, b-roll that stayed on the video's main idea, overlays that land because
each one has a sound, and a film texture that helps. It gets there with
constants in code: one reachable theme, fixed duck levels, no per-channel
sound. LUSORA has the opposite profile.

This plan brings **every DP production feature** into LUSORA as a new pipeline,
`documentary`, without giving up what LUSORA does better: themes, style packs,
prompt packs, validators, identity rules and the snapshot.

**The rule everything here follows: a DP feature enters LUSORA as a STAGE when
it is a decision about content, as a KNOB (style pack, theme, channel config)
when it is a choice of look, sound or pace, and as a PROVIDER when it is a way
of reaching a service. Never as a constant.** Every knob defaults to what
LUSORA draws today, so no existing channel changes until it opts in.

---

## Where this comes from

The comparison lives outside the repo, in `/home/thiago/lusora-vs-darkpalace/`,
because DP must not be touched and LUSORA was only analysed at first.

| File | What it holds |
|---|---|
| `SUMMARY.md` | who leads per area, ranked portable ideas, verified LUSORA bugs |
| `stages/01-broll-sourcing.md` | sources, download, vision selection, 18+ filter, AI-image fallback |
| `stages/02a-editing-planning-graphics.md` | blocks vs beats, planning prompts, graphic vocabulary, number guards |
| `stages/02b-editing-assembly-rhythm.md` | hook, rhythm constants, anti-repetition, texture, captions, visual review |
| `stages/03-music-and-sound.md` | music bed, ducking, SFX bank, loudness |
| `runs/01-centralia.md` | the first same-script run on both pipelines and the user's verdict |
| `darkpalace-manifest.sha256` | the DP version every `file:line` below refers to |

DP code is at `/home/thiago/darkpalace/DOCGERAL_STUDIO` (read-only; a Linux copy
that renders is at `/home/thiago/darkpalace-linux`).

## Decisions taken (2026-09-28, D100)

- **A new manifest, `contracts/pipelines/documentary.yaml`, `stability: test`**,
  starting as a copy of `faceless_v3` and gaining one stage or knob per slice.
  It is promoted when watching says it beats v3 (the D84 rule).
- **No `research` stage.** DP's studio has none; the script comes from the user
  or from LUSORA's `script` stage.
- **Subscription CLIs are an additional provider option, not the default.**
  Codex CLI, Claude CLI and agy (text and vision) and Google Flow (images through a Chrome
  profile) sit beside the API providers. A channel picks them; APIs stay the default.
- **YouTube is one more source in the visual chain**, like `library`, `stock`
  and `ai_image`, and is off unless a channel lists it. The same goes for Wikimedia Commons, archive.org and Pixabay.
- **Centralia is the benchmark.** Every slice re-renders
  `evals/benchmarks/centralia/script.txt` and is watched against the DP render
  and the previous LUSORA render before it is called done.

## Run 01 in one table (why the order below is what it is)

| Area | User's verdict | Root cause in LUSORA |
|---|---|---|
| Hook | DP better | No hook concept in `compile_plan` or `resolve_assets` |
| B-roll | LUSORA drifts from the main idea ("not the exact place, the main idea") | Queries are literal per beat with no video-level thread; split shots repeat one query ("abandoned town grassy streets" ×5); the first hit wins with nobody looking |
| Overlays | Mixed; LUSORA placement improved. DP lands because of the SFX | The theme's `sound.per_component` only maps `Text*`; none of the 8 overlays used had a sound |
| Texture | Helps | `theme.grain` draws a vignette only |

---

## Inventory: every DP feature and where it lands

Kind: **S** = stage, **K** = knob, **P** = provider, **W** = worker or engine.

### Sourcing (b-roll)

| DP feature | DP source | LUSORA home | Kind | Slice |
|---|---|---|---|---|
| Subjects pass over the whole narration: 30–70 subjects, each with its own queries, plus the hook end and the title | `diretor.py:263` `ASSUNTOS_REGRA`, `planejar` | new stage `subjects` → `subjects.json`; beats reference a `subject` id | S | 2 |
| Different shots of one subject use different queries | subject query lists, `YT_DOIS` | `resolve_assets` rotates through the subject's queries on split shots | K | 2 |
| YouTube download: whole videos up to 20 min, a section otherwise; amount presets `muita / normal / pouca` | `diretor.py:45-57, 440-615` | source `youtube` in the chain, downloading through the library's ingest so it keeps what it fetches; `footage_amount` in channel config | S+K | 4 |
| Commons and archive.org photos with licence allow-list, junk-title regex, size floor | `fontes_reais.py` | source `archive` (providers `commons`, `archive_org`) | K | 4 |
| Pixabay video and photos | `estoque.py` | `stock` gains provider `pixabay` | K | 4 |
| Shots cut at scene changes, shown to a vision model on contact sheets and rated 1–5 | `diretor.py:649-733` | new stage `pick_shots` | S | 3 |
| Photos chosen by a vision model per subject | `diretor.py:837-900` | `pick_shots` | S | 3 |
| Logo-corner crop, letterbox strip | `LOGO_CROP`, `recorte` | `pick_shots` writes a crop per asset; the renderers honour it | K+W | 3 |
| Portrait photos framed on the top third | `doc_pecas._enquadra` | a focal field on photo assets | W | 7 |
| 18+ filter: word list in ~25 languages, then vision (text-only judge as last resort); unjudged photos are dropped | `filtro_adulto.py`, `diretor.py:769` | `pick_shots` safety pass, `safety` block in channel config | K | 4 |
| AI images only for what is still missing, started early while downloads run | `codex_cedo`, `gerador_imagens.py` | `ai_image` stays last in the chain; slice 11 adds the subscription providers | P | 11 |
| Credits file with licences | `entrega.py` | `finalize` writes `credits.txt` from `asset_usage` | W | 13 |

### Planning and graphics

| DP feature | DP source | LUSORA home | Kind | Slice |
|---|---|---|---|---|
| Every number on a chart or counter must be spoken (±2%) | `diretor.py:364` `conferir` | the existing `edithints._check_spoken_number` called from `validate_beat_sheet` | W | 5 |
| Hook forms: headline cards, satellite dive, match cut, paper cards, title card with hit + riser | `diretor.py:1030-1320`, `doc_engine.py:245-460`, `satelite.py` | new stage `hook_plan`; components `MatchCut`, `PaperCard`; `SatelliteLocate` gains an imagery resolver (NASA GIBS) and an online geocoder behind `geo.lookup` | S+W | 6 |
| Hook mode per channel (`classico / manchetes`) | `opcoes.hook` | `style_pack.hook.mode` | K | 6 |

### Assembly and rhythm

| DP feature | DP source | LUSORA home | Kind | Slice |
|---|---|---|---|---|
| Hook ≤ ¼ of narration and ≤ 300 words, ends on a paragraph start, opens on footage, cuts every ~2.2 s on word onsets, teaser shots of other subjects | `diretor.py:196-253, 960-981`, `montar` | `style_pack.pacing.hook {max_share, max_words, cut_s, open_on: footage}`; compiler marks the hook items; resolve asks for distinct assets | K | 5 |
| No still over 6 s, ~1 shot per 5 s, graphic over 9 s (7 s in hook) becomes cuts, two graphics in a row: the second becomes footage | `diretor.py:982-985`, `montar` | `style_pack.pacing.rhythm {max_still_s, shot_s, max_graphic_s, max_graphic_hook_s, no_graphic_pairs}` | K | 8 |
| Graphics over running footage for the pieces that allow it | `CLIPBG_OK` | a catalog flag `over_footage: true` + a compiler rule | K | 8 |
| Perceptual anti-repetition, 30 s window, on by default | `diretor.py:986-1028` | `dedup` defaults change (`min_hamming_distance` ~10, window in seconds), hash the frame actually shown | K | 8 |
| One source video in ≤3 blocks, never two in a row | `montar` | `dedup.max_uses_per_source`; the library exposes a segment's parent video | K | 8 |
| Captions as short phrases on the spoken word (≤40 chars / 8 words) | `doc_engine.py:139-174` | `style_pack.captions.chunk {max_chars, max_words}` | K | 8 |
| Cuts snapped to word onsets | `_cortes` | `_enforce_hold_ceiling` snaps to `word_timeline` | W | 8 |
| Story turns get a light leak; flashback passages get a vintage grade, CRT on footage | `efeitos.py`, `diretor.py:1323` | new stage `narrative_marks` → `marks.json`; transition kind `light_leak`; texture layer | S+K | 7 |
| Dust over everything, VHS tape on footage | `efeitos.py`, `vhs_fita.py` | `theme.texture {dust, tape, vintage}` with assets in the engine | K | 7 |
| Effects placement mode `narrativa / contagem / desligado` | `DG_EFEITOS` | `style_pack.texture.placement` | K | 7 |
| Vision review after render (2 frames per block), fix and re-render only broken blocks | `revisor.py` | new stage `visual_review`; needs per-segment rendering first | S+W | 12 |
| Never an empty frame: a missing picture takes a neighbour's | `imagem_de_reserva` (note: dead for plain scenes in DP, `doc_engine.py:530`) | a named degrade in `resolve_assets`, logged | W | 12 |

### Sound

| DP feature | DP source | LUSORA home | Kind | Slice |
|---|---|---|---|---|
| A sound on every animated piece, timed to the motion | `webdoc_anim.py:55-74`, `doc_engine._sons` | `theme.sound.per_component` covers the whole catalog; a cue can name its offset | K | 1 |
| A generated SFX bank (27 sounds, numpy), no licensing | `sfx_lib.py` | a generated sound pack `synth-doc` built by `contracts/sound-packs/build.mjs`, licence `own` | K | 1 |
| Music bed: track loudness normalized, head and tail trimmed, seamless loop, 7 s crossfades | `musica.py:36-84` | `compile_music` + mastering | W | 9 |
| Ducking on the real voice waveform, 10 ms blocks, hold 0.35 s, rises in every pause | `musica.py:86-108` | narration stage writes `speech_windows.json`; `duck_envelope` reads it | S+K | 9 |
| Hook music lift (+6 dB) | `aplicar_respiro` | `style_pack.music.hook_lift_db` | K | 9 |
| Voice normalized before the mix | `motor.py` loudnorm | mastering: voice first, then two-pass mix loudnorm with a −1.5 dBTP limiter | W | 9 |

### Narration

| DP feature | DP source | LUSORA home | Kind | Slice |
|---|---|---|---|---|
| Numbers rewritten as spoken words before TTS (pt/es/en) | `falavel.py`, `extenso.py`, `fala.py` | narration pre-pass, per language | W | 10 |
| Whisper hears each chunk and re-generates what came out wrong | `revisor_voz.py` | narration `review: true` knob (faster-whisper is already optional) | K | 10 |
| Speed 0.9 for every voice | `fish.velocidade()` | `voice.speed` in channel config | K | 10 |

### Providers and worker

| DP feature | DP source | LUSORA home | Kind | Slice |
|---|---|---|---|---|
| LLM through subscriptions: Codex CLI, Claude CLI, agy, Gemini key, DeepSeek | `llm.py`, `*_esp.py` | `PROVIDERS` gains `codex_cli`, `claude_cli`, `agy`; a `vision` capability flag | P | 11 |
| Failover: an engine that fails hands the call to the next at once; quota tracked until the time the engine reports | `llm.py`, `gemini_cota.json` | a per-role chain (`llm: [a, b, c]`) and a quota ledger | P | 11 |
| AI images: Flow through a Chrome profile, Codex, Nano Banana | `flow_esp.py`, `codex_img.py`, `agy_esp.py` | `ai_image` providers `flow`, `codex`, `nano_banana` | P | 11 |
| Next video prepares while one renders; one render at a time | `trava_render.py` | worker concurrency (overlaps the throughput plan) | W | later |
| GPU encode detection (NVENC/AMF/QSV, VAAPI on Linux) | `render_hw.py` | `render.ts` encoder probe | W | later |
| Subscribe CTA widget | `motor.py:82` `cta_widget` | a catalog component + a style-pack placement rule | K | 13 |
| MP4 checked before it gets its final name | `entrega.py` | `qa` / `finalize` | W | 13 |

### Deliberately not taken

- DP's constants: they become knobs above.
- DP's known bugs: the dead empty-frame guard, the unreachable `noite` theme,
  VHS on stock contrary to its comment, dead Commons retries, and the −28 dB
  default that its own skill 06 calls too low.
- Anything Windows-only (process-tree kill, `msvcrt` locks, `.cmd` lookups).

---

## The manifest when every slice is in

```
script (optional / upload)
narration            + spoken numbers, Whisper review, speech_windows.json
transcript
cut_beats
subjects             NEW: subjects.json (subjects, queries, hook end, title)
plan_beats           beats reference subjects
select_overlays
hook_plan            NEW: hook moments and forms
narrative_marks      NEW: story turns, flashbacks
compile_plan         + hook tier, rhythm, dedup, texture, captions
gather_footage       NEW: youtube / archive / pixabay candidates into the library
pick_shots           NEW: vision picks, crops, safety
resolve_assets       + subject-rotated queries, AI images for gaps
resolve_audio        + overlay SFX, waveform duck, hook lift
validate
render
visual_review        NEW: frames per block, targeted fix
qa
finalize             + credits.txt, delivery check
```

Every new stage is a `STEP_REGISTRY` entry in `worker/lusora_worker/pipeline/stages.py`.
So `faceless_v3` can adopt any of them later by listing it, which is the D60
point.

## The preset

Slice 14 ships a theme + style-pack pair (working name `documentary-dark`) that
turns on hook, rhythm, texture and overlay sounds together. That way a channel gets
DP's look by choosing a preset rather than setting twenty knobs. Other channels
on the same pipeline can keep a clean look.

**Shipped (slice 14a, D119).** The theme and pack carry the look and the
behaviour; the channel half ships as [`contracts/presets/documentary.json`](../../contracts/presets/documentary.json):
the pipeline, theme and pack names, captions, music and sfx on, footage and
the shot judge on, DP's dedup rules and the narration settings. The channel
form's "Start from a preset" merges it in; the user reviews and saves.

---

## Slices

The slices still to build each have a self-contained brief in
[briefs/](briefs/README.md), written so a fresh chat can build them without
this plan's history.

Each slice ends the same way: re-render Centralia on `documentary`, write the
viewing notes in the comparison folder's `runs/`, add a decision entry, and
update `00-status.md`.

### Slice 0: benchmark and skeleton (S) ✅ BUILT (`e32fd02`)
`evals/benchmarks/centralia/` holds `script.txt`, a README pointing at the DP
render and at run 01, and a viewing-notes template. `documentary.yaml` = the v3
stage list, `stability: test`. CI's manifest checks and `test_pipelines.py` cover it.

### Tooling: the render window ✅ BUILT
`output.window: {start_s, end_s}` (a per-video override) renders one stretch
of the timeline: `engine render --window`, Remotion `frameRange`, ffmpeg cut
after the fact, QA judged against the window. Every stage before render still
sees the whole video. Benchmark checks of slices that change what is drawn or
heard use `end_s: 75`; b-roll slices and DP comparisons render the whole script.

### Slice 1: overlay sounds (S) ✅ BUILT (D101)
- `theme.sound.per_component` maps every catalog component, not only `Text*`.
  As built: no new offset field was needed; each cue's `lead_s` comes from its
  recipe's peak. Run 01's silence was also config: channel `sfx` off and
  doc-slow `sfx.enabled: false`, so the benchmark enables both (see D101).
- A generated `synth-doc` sound pack (whoosh, swish, pop, tick, thud, hit,
  riser, typewriter, page...) built by `build.mjs` from a port of `sfx_lib.py`, licence `own`.
- Fixes the `/sounds` upload forcing beds to mono (`soundPacks.ts:119`).

### Slice 2: the main idea: `subjects` (M) ✅ BUILT (D102)
- New stage `subjects`: one call over the whole narration returns the subjects,
  each with 2–4 queries across angles, the hook end and a title.
- `plan_beats` and beatcraft answer with a `subject` per beat. Chunks can then run in parallel,
  because the thread no longer depends on the previous chunk.
- `resolve_assets` rotates through a subject's queries across its shots. The
  "×5 same query" failure from run 01 must be gone.
- `plan_beats` today takes ~152 s serially on a 5-minute video; parallel
  chunks should cut that.
- As built: the stage, the beatcraft section and `subject` field, the rotation
  in resolve_assets. Parallel chunks are NOT in this slice (one variable at a
  time); they are the natural follow-up now that each chunk has the thread.

### Slice 3: `pick_shots` with vision, on today's sources (M) ✅ BUILT (D103)
- A `vision` capability on `Provider`, and a vision-capable default (an API
  model; DeepSeek is text-only).
- Adapters return their top N instead of downloading the first hit.
- Contact sheets per ~6 beats: the beat's intent plus the video's main idea on
  one side, numbered thumbnails on the other. The model returns a pick, a rating
  and a logo corner.
- Crop, letterbox strip and portrait framing.
- Also fixes: try the next hit when one download fails
  (`sources.py:301-303, 425-427`), and fall through on an image error (`:632`).
- As built:
  - The default vision provider is `claude_cli`, the Claude CLI on the
    operator's login. It is the only vision provider this machine has
    credentials for, so part of slice 11 moved here. `anthropic` and `openai`
    can see images too, through `llm.see()`.
  - Only the Pexels adapter offers candidates. The library adapter has no
    thumbnail endpoint to judge by yet, so library shots keep the plain search.
  - Crops are baked into the clip file, and the renderers are unchanged.
  - A shot the judge could not rate falls back to the plain search.
  - Portrait framing moves to slice 4, where Commons and archive photos arrive.
    Pexels video is landscape.
- Knobs: `source_policy.visual.pick {enabled, llm, model,
  candidates_per_shot, shots_per_sheet, min_rating}`. It is off by default,
  and the Centralia benchmark turns it on.

### Slice 4: `gather_footage`, the internet sources (L) ✅ BUILT (D104)
- Sources `youtube` and `archive`, and `stock` provider `pixabay`, in the
  channel-config schema. All go through the library's ingest (`POST /jobs`)
  so the library keeps what it fetches and every video makes the next one
  cheaper.
- Subject-driven search, `footage_amount` presets (DP's `muita / normal / pouca`),
  licence allow-list, junk filters, the 18+ filter (words, then vision).
- `finalize` writes `credits.txt`.
- Needs `YTDLP_PROXY` (the library already refuses to run without it).
- Open: the library ingests serially, so this may need a batch ingest endpoint.
- As built (D104):
  - The user chose to fetch directly and copy to the library. The worker
    downloads into the video's folder, and after the render `finalize` hands
    the YouTube videos actually used to the library (`POST /uploads`, best
    effort). No video waits on the library's serial GLM queue.
  - YouTube videos are downloaded whole: video only, 720p at most, up to
    `max_video_seconds`. Section downloads go through ffmpeg, which bypasses
    the SOCKS proxy.
  - The pool is offered through chain sources `youtube` and `archive`.
    `pick_shots` deals candidates round-robin across every offering source.
  - The 18+ filter has two layers: Dark Palace's word lists before any
    download, then a welded judge rule.
  - Knobs: `source_policy.visual.footage {enabled, amount, youtube, photos,
    max_videos, videos_per_subject, max_video_seconds, shots_per_video,
    photos_per_subject, safety, keep_in_library}`.
  - Not built:
    - Pixabay: there was no key to test with.
    - archive.org video: its files are feature-length.
    - Portrait framing: moved to slice 7.
- Follow-up (D105), after the user watched the first render with YouTube
  footage:
  - Each downloaded video is screened once by the judge. Shots with burned-in
    captions, effects, graphics or presenters never enter the pool.
  - Logos are no longer cropped.
  - A stage can request a gate on any video:
    - `footage_check` (documentary v1.4) stops a thin topic after the
      subjects pass;
    - `pick_shots` stops a video whose coverage is under `pick.min_coverage`;
    - in review mode `pick_shots` always stops.
  - Every stop comes with `footage_report.md`.

### Slice 5: the hook tier and number truth (M) ✅ BUILT (D106)
- `style_pack.pacing.hook`: the compiler marks hook items, tightens holds,
  opens on footage and cuts on word onsets; resolve asks for distinct assets.
  A title card closes the hook with hit + riser cues.
- The spoken-number check runs on production beat sheets. Fix the overlay prompt's
  worked example that invents "91 dampers" (`contracts/prompts/overlay/default.json`).
- As built:
  - The hook ends at the subjects pass's `hook_end_cut`, capped at `max_share`
    (a quarter of the narration).
  - Hook shots are marked `hook: true` and held to their own floor.
  - Resolve gives the first hook shot video, never an archive photo.
  - The title card's riser and hit are pinned against the sound budget.
  - Number truth runs in both `validate_overlay_selection` and
    `validate_beat_sheet`, within ±2%, in the beat or a neighbour. On the last
    88 real selections it flags none.
  - Not built: "resolve asks for distinct assets" in the hook. The whole-video
    ledger already refuses a repeat, so there was nothing left to add.
  - Evals: the overlay prompt's example changed, so `evals/BASELINE.md` is to
    be retaken for both arms before any overlay-quality claim.

### Slice 6: hook forms (L) ✅ BUILT (6a D107, 6b D110, 6c D111)
New stage `hook_plan` (DP's `MANCHETES_REGRA`: only what the narration says, no
unspoken number). New `PaperCard` and `MatchCut` components, a GIBS imagery
resolver for `SatelliteLocate`, and an online geocoder behind `geo.lookup`.

Split in three, each benchmarked on its own:
- **6a ✅ BUILT (D107):** `hook_plan` with the headline, word, phrase and cards
  forms, `pacing.hook.mode: headlines`. No `PaperCard` component: each paper
  card is an existing component (HammerStatement, HighlightedPassage,
  FactSheet), so the paper look is a theme decision, per the overlay-authoring
  rule. The place tag waits for 6b.
- **6b ✅ BUILT (D110):** the satellite dive. It uses NASA GIBS plates
  (WMS, plate carrée) for every `SatelliteLocate`, Nominatim behind
  `geo.lookup`, and a `dive` mode that the hook's new `satellite` form uses.
- **6c ✅ BUILT (D111):** the match cut.
  - `hook_plan`'s `matchcut` form: Commons and Pexels photos of one kind of
    place, deduplicated, with alignment points marked by the vision judge.
  - A new `MatchCut` component, `compiler_only`.
  - The per-cut sounds are left to the user.

### Slice 7: texture (M) ✅ BUILT (D112)
New stage `narrative_marks` (one cheap call; with no answer, turns fall back to paragraph starts).
A `light_leak` transition kind, placed on turns (and available to a pack's D95 `section_break`). `theme.texture`
covers dust, tape and vintage, with CRT on flashback footage. `style_pack.texture.placement`
is one of `narrative | count | off`.
- Built: all of the above, drawn procedurally in the engine (no stock overlay
  files), plus portrait framing (`focus_y`, deferred here from slice 4).
- Not built: DP's whole-video tape pass (`vhs_fita.py` over a finished
  video). The tape here is DP's per-footage mode (`filtro_filmagem`), which is
  the one its documentary style uses; captions stay clean on top in both.

### Slice 8: rhythm, repetition, captions (M) ✅ BUILT (D113)
The `pacing.rhythm` knobs, `over_footage` in the catalog, and the new dedup
defaults. The per-source cap needs the library to expose each segment's parent. Captions in
phrases, and ceiling cuts snapped to words.
- Built: `pacing.rhythm {shot_s, max_still_s, snap_to_words, min_graphic_gap_s}`,
  `style_pack.captions.chunk {max_chars, max_words}`, and `dedup {reuse_window_s,
  max_beats_per_source, source_in_adjacent_beats}`. The documentary pack sets
  5 / 6 / on / 2 s and 40 chars / 8 words; the dedup numbers (30 s, 13 bits, 3
  beats, never adjacent) and `captions.enabled` wait for the preset (slice 14).
- Not built: `over_footage` and the long-graphic rule. Every LUSORA graphic is an
  overlay over a visual track that keeps cutting, with a hold the catalog
  already bounds, so there is nothing for them to do (D113). The per-source cap
  counts YouTube uploads only: library segments still do not name theirs.

### Slice 9: the sound mix (M) ✅ BUILT (D114)
`speech_windows.json` and a waveform-driven duck (raise the edit-plan
envelope's 200-point cap), `hook_lift_db`, voice normalization, two-pass mix
loudnorm, and bed craft (trim, loop, crossfade).
- Built: all of the above (`music.one_bed`, `music.duck: waveform` with
  `under_voice_db` / `duck_db` / `hook_lift_db`, `style_pack.mix`), plus
  `synth-doc`'s cue gains set to DP's per-cue levels. `speech_windows.json` is
  written by `compile_plan` rather than the narration stage, so forked and
  uploaded narrations get it too.
- Not built: the user's own music tracks (DP's `musicas/` folder). The
  documentary look plays `synth-doc`'s synthesized beds until a music source
  exists.

### Slice 10: narration quality (M) ✅ BUILT (D115)
A spoken-number pre-pass per language, a Whisper review knob, and `voice.speed`.
- Built: `voice.speakable` (DP's whole `fala.preparar`, not only numbers: six
  languages), `voice.review {enabled, takes}` and `voice.speed`, all off by
  default; the documentary preset (slice 14) turns them on at DP's values.
- Checked on a paid ai33 sample (pt and en, numbers, money, units) rather than
  a Centralia re-narration: nothing in that script changes under the pass.

### Slice 11: subscription providers (L) — 11a ✅ BUILT (D116), 11b ✅ BUILT (D117)
`codex_cli`, `claude_cli` and `agy` for text and vision; `flow`, `codex` and
`nano_banana` for images; fallback chains per role; a quota ledger. Off unless a
channel lists them, and this machine needs the CLIs logged in.

Split in four (see [the slice briefs](briefs/README.md)):
- **11a ✅ BUILT (D116):** the `gemini` provider (text and vision), fallback
  chains for every `llm` field (`["claude_cli", "gemini", "deepseek"]`, a
  `/model` suffix on any element), and the shared quota ledger
  (`llm_quota.json`) that marks a provider out on quota or login failure until
  it should be tried again. A plain string still compiles, plans and calls
  exactly as before.
- **11b ✅ BUILT (D117):** `nano_banana` (Gemini's image model) for `ai_image`, and a provider
  chain there (`["nano_banana", "openai"]`) on the same quota ledger. Not usable on
  this machine yet: the Gemini key is free-tier, which has no image quota
  (`429 limit: 0`); it works as soon as billing is enabled, at Google's image price.
- **11c:** Codex CLI for text, vision and images. Needs `codex` installed and
  logged in.
- **11d:** `agy` (Antigravity CLI). Needs `agy` installed and logged in, plus
  one settings change.

### Slice 12: `visual_review` (L) — 12a ✅ BUILT (D120)
Per-segment render first (today LUSORA re-renders the whole video), then
review 2 frames per block and repair only what failed. The empty-frame degrade
lands here too.
- **12a ✅ BUILT (D120):** the patch render. `engine patch` re-renders only the
  changed seconds of a Remotion render and splices them in frame-exact;
  `pipeline/patch.py` works out those seconds from two plans. Swapping one
  Centralia shot took 174 s against 8–9 minutes for the whole 60 s window.
  Not built: patching an ffmpeg render (the caller re-renders it whole).
- **12b:** the visual review, its first user.

### Slice 13: delivery (S) ✅ BUILT (D118)
Subscribe CTA component and placement, and MP4 checks before the final name.
- Built: `SubscribeButton` (compiler_only) placed by `style_pack.cta` on the first
  spoken "subscribe" in six languages, with a pop and a bell (on in `documentary`);
  `qa.container_problems` on every render (H.264 at the plan's size, audio, a
  clean decode of the first and last 8 s).
- Not built: moving the MP4 to an output folder or deleting intermediates (DP's
  `entregar` / `limpar`): `data/videos/<id>/` stays the record.

### Slice 14: preset and promotion — 14a ✅ BUILT (D119)
- **14a ✅ BUILT (D119):** `contracts/presets/documentary.json`, validated by
  `validate:schemas`, applied from the channel form.
- **14b:** comparison and promotion (below).

Ship `documentary-dark`. Watch Centralia plus one fresh script on `documentary`
vs `faceless_v3`, write the decision entry, then set `stability: production`.

**Order rationale.** Slices 1 and 2 answer the two things the user named first
(overlay sounds, b-roll following the main idea) and are cheap. Slice 3 before
4 separates the two causes of DP's b-roll lead, better picking and more
sources, so each one's effect can be seen on its own. Hook and texture follow,
then the heavier infrastructure (providers, visual review).

---

## Risks

- **YouTube and Content ID.** YouTube is per channel and off by default. DP relies on
  short excerpts plus the VHS look; the tape texture knob (slice 7) and a
  max-excerpt setting keep that choice explicit.
- **Vision cost.** A contact-sheet call per ~6 beats on a 20-minute video is
  ~40 calls. Measure it on the budget gate before making it a default.
- **Library throughput.** The serial ingest queue was built for curation, not
  per-video fetches (slice 4).
- **Evals.** Any planner-prompt change moves `evals/BASELINE.md`. Slices 2 and 5
  retake both arms, as D84 requires.
- **Laptop memory.** Renders run uncapped by default. Fall back to the capped
  scope only if the machine starts killing processes.
