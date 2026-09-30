# Slice briefs: read this first

These briefs let a fresh chat, on any model, build the rest of the
[documentary pipeline plan](../documentary-pipeline-plan.md) without the
conversation that designed it. Each brief is one bounded task. **Read this file,
then your brief, then only the files the brief names.** Don't redesign
anything a brief decides; if something in it is wrong, stop and say so.

## The order

| Brief | Size | Needs first | Model |
|---|---|---|---|
| [13 · delivery](slice-13-delivery.md) | S | — | Sonnet |
| [14a · the documentary preset](slice-14a-preset.md) | S | — | Sonnet |
| [11a · Gemini, fallback chains, quota ledger](slice-11a-gemini-chains.md) | M | — | Sonnet |
| [11b · Nano Banana images and an image chain](slice-11b-images.md) | M | 11a | Sonnet |
| [11c · Codex CLI for text, vision and images](slice-11c-codex-cli.md) | M | 11a, 11b; the user installs and logs in to `codex` | Sonnet |
| [11d · agy (Antigravity CLI)](slice-11d-agy.md) | M | 11a, 11b; the user installs and logs in to `agy`, and approves one settings change | Sonnet |
| [12a · patch render](slice-12a-patch-render.md) | L | — | **Opus**, or Sonnet with an Opus review of the diff |
| [12b · visual review](slice-12b-visual-review.md) | M | 12a | Sonnet |
| [14b · comparison and promotion](slice-14b-promotion.md) | S | everything | Sonnet; the verdict is the user's |

Google Flow (Chrome-profile image generation) is **not** briefed: it drives a
logged-in browser through a separate package (`flow_rc/`) and needs its own
design. Ask the user before starting it.

## Rules that never bend

1. **Dark Palace is read-only.** `/home/thiago/darkpalace` and
   `/home/thiago/darkpalace-linux` are the reference. Never write, move,
   delete, or run anything inside them. To run a Dark Palace module (for
   example to record its output as a golden fixture), **copy** the file(s) to
   `$CLAUDE_JOB_DIR/tmp` (or `/tmp/<something>`) first and run the copy. Even
   importing from the original folder writes `__pycache__` there, which counts
   as modifying it.
2. **Secrets.** Never print a value from `.env`. Listing key *names* is fine
   (`grep -oE "^[A-Z0-9_]+=" .env`). Never replace an existing key.
3. **Sound.** The user owns the final sound design. Porting Dark Palace's
   sound behaviour is allowed; retuning cues, gains, the `synth-doc` pack or a
   theme's `sound` block beyond what Dark Palace does is not, unless asked.
4. **Gates are the user's.** Never approve a checkpoint or gate on their
   behalf (no `checkpoints.approve`, no DB edits that pass a gate).
5. **Off by default.** Every new knob defaults to the old behaviour, so a
   video enqueued before it existed re-compiles **byte-identically**
   (Principle 7). Write a test that proves it.
6. **Paid calls.** TTS, image generation and paid LLM APIs cost the user
   money. Unit tests fake them. A real call is allowed only where the brief
   says so, and kept small.
7. **Commit only when every check passes.** One commit for the code and docs
   (`Documentary slice N: <name> (D1xx)`), a second one if you record a
   benchmark. End commit messages with the attribution line your harness gives
   you.

## Where things live

| What | Where |
|---|---|
| Stage list per pipeline | `contracts/pipelines/documentary.yaml` (bump `version` and add a paragraph when a stage is added) |
| Stage registry | `worker/lusora_worker/pipeline/stages.py` (`STEP_REGISTRY`); stage bodies in `pipeline/steps.py` |
| Compiler | `worker/lusora_worker/compiler/` (`core.py`, `sound.py`, `texture.py`, `rhythm.py`, `captions.py`) |
| Providers | `worker/lusora_worker/providers/` (`llm.py`, `tts.py`, `sources.py`) |
| Schemas | `contracts/schemas/*.schema.json`; TypeScript types in `contracts/src/types.ts` |
| Style packs, themes | `contracts/style-packs/*.json`, `contracts/themes/*.json` |
| Prices | `contracts/prices.json` (every provider × operation the budget gate can see) |
| Engine (renderers, components) | `engine/src/` (`renderers/remotion`, `renderers/ffmpeg`, `components/core`, `catalog/registry.ts`) |
| Platform (web UI) | `platform/src/` (channel form: `components/ChannelConfigForm.tsx`) |
| Decisions | `docs/04-decisions/decided.md` (one table row per decision; the last one is D115, so the next is D116) |
| This plan | `docs/05-roadmap/documentary-pipeline-plan.md` (mark the slice `✅ BUILT (D1xx)` with a Built / Not built list, as slices 7–10 do) |
| Benchmark log | `evals/benchmarks/centralia/README.md` (one table row per render) |

**A new LLM prompt role** must be registered in all of: `contracts/prompts/roles.json`,
`contracts/prompts/<role>/default.json`, `contracts/prompts/welded/<role>.{system,user}.txt`,
the `prompt.schema.json` enum, `ROLES` in `contracts/py/lusora_contracts/prompts.py`,
`PROMPT_ROLES` in `platform/src/lib/prompts.ts`, `PromptRole` in `contracts/src/types.ts`,
the prompts slot in `channel_config.schema.json`, `platform/test/prompts.test.ts`,
and a price entry `llm.<role>` next to every `llm.hook_plan` in `contracts/prices.json`.
Slice 7's `narrative_marks` (commit `362395a`) is a complete example: `git show 362395a --stat`.

**A new core component** must be registered in all of: the file in
`engine/src/components/core/`, `COMPONENTS` in `engine/src/components/index.ts`,
`CORE_COMPONENTS` in `engine/src/catalog/registry.ts` (then run
`pnpm --filter @lusora/engine run catalog`), sample props in
`engine/src/catalog/sample-props.json`, and `theme.sound.per_component` in any theme that
should give it a sound. If the `lusora-overlay-authoring` skill is available, load it
first: it has the theming rules (no literals except frame proportions).

## The checks (all must pass before a commit)

```bash
cd /home/thiago/lusora
pnpm -s run validate:schemas            # "All contracts valid."
pnpm -s run catalog:check               # "catalog in sync."
pnpm -s -r typecheck                    # no output = clean
(cd worker && uv run pytest -q)         # was 880 passed, 3 skipped after slice 10
(cd engine && node --experimental-strip-types --test test/*.test.ts)   # was 109 pass
(cd platform && pnpm -s test)           # was 216 pass
```

`ruff` is not installed; don't try to run it.

## The worker service

The pipeline runs in a systemd user service. After changing worker code, restart
it or it keeps running the old code:

```bash
systemctl --user stop lusora-worker; systemctl --user reset-failed lusora-worker
systemd-run --user --unit=lusora-worker --working-directory=/home/thiago/lusora/worker \
  --setenv=PATH="/home/thiago/.nvm/versions/node/v22.23.1/bin:/home/thiago/.local/bin:/usr/local/bin:/usr/bin:/bin" \
  --setenv=REMOTION_BROWSER_EXECUTABLE=/home/thiago/lusora/node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell \
  --setenv=HOME=/home/thiago /home/thiago/.local/bin/uv run python -m lusora_worker
```

Follow a video with `tail -f data/videos/<vid>/production.log`. The database
is `psql -h /tmp -p 5433 -U lusora -d lusora` (table `videos`: `id, status,
error_reason, cfg, ...`). A failed video is re-queued with
`UPDATE videos SET status='queued', error_reason=NULL, updated_at=now() WHERE id='<vid>'`
(what the platform's retry does). Don't restart the worker while a render is
running unless the brief says so.

## The Centralia benchmark: a fork without paying again

Every slice is watched on the Centralia script. The latest render is
**`vid_dfd49c6c34e4`** (slice 9): documentary v1.6, a 0–60 s window, music on,
captions on, the slice 8 dedup rules. A fork copies what it can so only your
slice's stages re-run:

```bash
cd /home/thiago/lusora
systemctl --user stop lusora-worker
# 1. overrides = the last fork's, plus your change
python3 - <<'EOF' > /tmp/ov.json
import json
o = json.load(open('data/videos/vid_dfd49c6c34e4/bench_fork.json'))['overrides']
# o[...] = ...   # your slice's override, if any
print(json.dumps(o))
EOF
pnpm -s bench:fork --from vid_c300f762d63b --pipeline documentary \
  --overrides "$(cat /tmp/ov.json)" --title "Centralia slice N: <name>"
# prints the new id, e.g. vid_xxxxxxxxxxxx
```

Then copy the upstream artifacts from `vid_dfd49c6c34e4` into the new folder
**in stage order, with a gap of more than a second between files**. Freshness is
decided by modification time, so files written in the same second look stale.
Rewrite `video_id` inside each JSON:

```bash
N=vid_new; S=vid_dfd49c6c34e4; cd data/videos
cp -al $S/footage $N/footage
python3 - <<EOF
import json, time
for f in ['beat_cuts.json','subjects.json','footage_check.json','beats.json','overlays.json',
          'hook_plan.json','marks.json','footage.json','shot_picks.json']:
    d = json.load(open('$S/' + f))
    if isinstance(d, dict) and 'video_id' in d: d['video_id'] = '$N'
    json.dump(d, open('$N/' + f, 'w'), indent=2, ensure_ascii=False)
    time.sleep(1.1)
EOF
```

Copy only what your slice does **not** change: stop the list before the
first stage your slice touches (drop `shot_picks.json` if you change the shot
list, since picks are keyed by shot id). Then start the worker (command above).
A 60 s window renders in about 8–9 minutes. The automatic QA must pass. Look at
the result: extract a few frames (`ffmpeg -ss <t> -i final.mp4 -frames:v 1 f.jpg`)
and read them, and measure what your slice promises. Record one row in
`evals/benchmarks/centralia/README.md` like the rows for slices 7–9.

## When to stop and ask the user

- The brief's design doesn't fit what you find in the code.
- A check fails and the fix would change something outside your brief.
- A paid call beyond what the brief allows would be needed.
- Anything involving logins, browsers, or installing software system-wide.
