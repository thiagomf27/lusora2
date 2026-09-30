# Slice 14b: comparison and promotion (S)

Read [the briefs README](README.md) first. Run this last, after the other
briefs you intend to ship.

## Goal

Decide, **with the user**, whether `documentary` becomes a production
pipeline. You prepare the evidence; the verdict is theirs.

## 1. The comparison

Two scripts, each rendered **full length** (no `output.window`) on both
pipelines, from the same narration so the voice is not a variable:

- **Centralia** (`vid_ebe08ffcb529` is the `faceless_v3` baseline, full
  length). The documentary arm: fork it with `pnpm bench:fork --from vid_ebe08ffcb529 --pipeline documentary`
  and the [14a](slice-14a-preset.md) preset's settings as overrides (read
  `contracts/presets/documentary.json`), **without** a window. That's a full
  run of every stage: vision picks, footage, and a render of about 25 minutes
  for three minutes of video. Tell the user the time before starting.
- **One fresh script.** Ask the user for it (a topic or a text). The
  narration is paid, once. Enqueue it on `documentary`, then use
  `pnpm ab:fork` (see `evals/benchmarks/centralia/README.md`, "For an A/B")
  to make the `faceless_v3` arm share its narration. Read the header of
  `platform/scripts/ab-fork.ts` for its arguments.

For each pair, write viewing notes to
`/home/thiago/lusora-vs-darkpalace/runs/<nn>-<name>.md`. That folder is the
user's comparison record, **not** Dark Palace, so writing there is fine; match
the format of `runs/01-centralia.md`. Cover:
- cost per video: `psql -h /tmp -p 5433 -U lusora -d lusora -c "select provider, operation, status, sum(usd) from cost_events where video_id='<vid>' group by 1,2,3"`;
- wall-clock time per stage (`production.log`);
- QA results;
- a frame sheet at the same timestamps in both;
- a list of what you'd point the user at.

Then **stop and ask the user to watch both pairs.** Don't go on until they
answer.

## 2. Promotion (only on the user's yes)

Read `platform/src/lib/pipelines.ts` around lines 150–180 first. The
resolver picks, for a channel's `production_style`, the production pipelines
of that **category**: the one named exactly like the style, else the
**alphabetically first**. `documentary.yaml` has `category: faceless`, and
`documentary` sorts before `faceless_v3`. So flipping it to
`stability: production` as it stands would silently switch **every channel
whose `production_style` is `faceless`** to the documentary pipeline.

Ask the user which of these they want, and do only that:
- **(a) A new family.** `category: documentary` plus
  `stability: production`. Channels opt in with
  `production_style: documentary`. That value doesn't exist yet: add it to the
  `production_style` enum in `channel_config.schema.json` **and** to the
  `category` enum in `pipeline_manifest.schema.json` (the schema says the two
  must stay identical), then to the TypeScript types and the platform's
  channel form. `faceless_v3` stays the faceless default.
- **(b) Replace v3.** `stability: production` on `documentary` and
  `stability: test` on `faceless_v3` (the reversal note in
  `faceless_v3.yaml`'s description says how v3 took over from `faceless`;
  mirror it).

In either case, remove `bulk_production_accepted: false` only if the user
says bulk runs are fine. Update the manifest description paragraph.

## Docs

- A decision entry with the comparison's numbers, the user's verdict in their
  words, and which option they chose.
- The plan: slice 14 `✅ BUILT`, and a final paragraph on what was not built
  (Flow, GPU encode, the concurrency rows).
- `docs/00-status.md`: the documentary pipeline's status line.
- `evals/benchmarks/centralia/README.md`: the full-length rows.
