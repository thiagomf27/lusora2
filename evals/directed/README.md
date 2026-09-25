# Directed-edit A/B

Does one Claude web pass, which makes the edit decisions for a finished
script, give a better video than faceless_v3 making them itself? The design
and the reasons behind it are in
[directed-edit-test.md](../../docs/05-roadmap/directed-edit-test.md), Part 2.
This file is the procedure.

One pair per script. Each pair has two arms that share the script, the audio,
the subtitles and the TTS timings byte for byte, and differ only in the
pipeline:

- **control**: `faceless_v3`. DeepSeek chooses the overlays.
- **directed**: `faceless_directed`. Your pasted block chooses them.

Both arms run on the `DIRECTED_TEST_01` channel. It uses the `directed-test`
pack and allows basic's seven overlays, with no per-minute limit.

## Running one pair

1. **Directed arm, from the quote page.** Pick `DIRECTED_TEST_01`. Click
   **Copy edit-pass prompt**, paste it into a new Claude chat, then paste your
   script under it. Paste the script and Claude's block into the box. If the
   check fails, send Claude the fix request it shows. When the box says
   **Ready**, submit and enqueue. The box logs every round-trip.
2. **Control arm, as a fork.** Once the directed video has narrated (it has
   `subtitles.srt`), run:
   ```bash
   pnpm ab:fork --from <directed_id> --pipeline faceless_v3
   ```
   This prints the control's id and queues it. Narration and transcript are
   skipped, because their files are already copied.
3. **Wait until both are rendered**, then print the table:
   ```bash
   cd worker && uv run python -m lusora_worker.ab_report <control_id>
   ```
   A fork's id is enough, because its `ab_fork.json` names the other arm. If
   the table ends in **NOT A CLEAN PAIR**, the comparison does not count.
   Find out why before scoring.

The fork also works the other way round:
`pnpm ab:fork --from <v3_id> --pipeline faceless_directed --edit paste.txt`.
Here `paste.txt` holds the same script-plus-block text the box takes. Pass
`--session <id>` to keep a session's round-trips; otherwise they are logged as
a new session of one attempt.

## Blind review

```bash
uv run python -m lusora_worker.ab_report <id> --blind
```

This prints two editor links, **X** and **Y**, and the key moments: where the
block placed its key shots. It writes `evals/directed/<pair>/key.json` and a
blank `scores.json`.

- Review from the two editor links only. The video page names the pipeline,
  so do not open it, and do not open `key.json`.
- Watch both videos in full in the editor preview. It renders the real plan,
  so the overlays, timing and music are what the final render will have.
- Score both **before** looking at anything else about either video.
- Running `--blind` again prints the same links and does not reshuffle.

Score each video from 1 to 5 in `scores.json`:

| key | question |
|---|---|
| `overlay_relevance` | Does each graphic carry something worth putting on screen? Too many graphics count against this score as much as wrong ones. |
| `overlay_timing` | Does each graphic land on the words it is about? |
| `mood_music` | Does the music follow the story, changing where the story changes and not in between? |
| `hook` | Does the opening line, and what is on screen under it, make you want to keep watching? |
| `broll_key_moments` | At each key moment listed, does the shot show what is being said? Score both videos at the same timestamps. |

Then set `publish` to `"X"` or `"Y"`: the one you would put on the channel.
`notes` is free text. Write down anything a number can't hold, such as "the
beat before the ofurô graphic is a two-second orphan".

```bash
uv run python -m lusora_worker.ab_report <id> --unblind   # the table + the scores
```

## How many, and the verdict

- **Five scripts**, on different topics, 1–2 minutes each, with one pair per
  script.
- **Script 1 also gets a noise pair**: the control run twice, with
  `pnpm ab:fork --from <control_id> --pipeline faceless_v3 --noise yes`. Score
  it blind like any other pair. It shows how far the scores move when nothing
  changes except DeepSeek's run-to-run variation. A difference in the real
  pairs smaller than that is not a difference.

To get the verdict over every scored pair:

```bash
uv run python -m lusora_worker.ab_report --summary
```

**Adopt** only if all of these hold:

- The directed arm is preferred on **≥ 4 of 5** scripts.
- The mean score difference (directed minus control) is **≥ +0.5** on
  `overlay_relevance` or on `broll_key_moments`.
- No category's mean difference is ≤ −0.5.
- The directed arm has no more stage failures than the control.
- The edit pass stayed cheap for you:
  - the median is ≤ 1 repair
  - no video needed ≥ 3 round-trips
  - no video took more than ~10 minutes from the first check to submit
  
  The report reads these from the log, not from memory.

**Stop** if the directed arm is preferred on 2 or fewer of the five.

An adopt verdict is not a promotion. First run one 20-minute pair on
descoberta-doc, where chunking, the overlay budgets and the cost table are
exercised for real.

## What lives here

```
evals/directed/<pair>/
  key.json      which letter is which arm (do not open before scoring)
  scores.json   your scores
```

`<pair>` is the two video ids, sorted, so the folder name does not say which
arm is the control. The videos themselves stay in `data/videos/`, and the
table can always be printed again from them.
