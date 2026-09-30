# Slice 14a: the documentary preset (S)

Read [the briefs README](README.md) first.

## Goal

One file that gives a channel Dark Palace's whole setup at once, so nobody
has to set twenty knobs by hand. Slices 8–10 left their channel-level values
"for the preset"; this is where they land.

The plan's "preset" is a theme plus a style pack (`documentary-dark` +
`documentary`). Those already exist and already carry the look, pacing,
texture, captions-as-phrases, rhythm and mix. What is missing is the
**channel-level** half: settings that live in `channel_config`, which a style
pack cannot carry (captions on, music on, dedup, footage, pick, voice).

Done = a preset file, validated by `validate:schemas`, that the channel form
can apply; a test; D117 (or the next free number).

## Design (decided; don't change it)

- New folder `contracts/presets/`, one JSON per preset. A preset is a
  **partial channel config**: any subset of `channel_config` fields, plus a
  `"description"` string. It is deep-merged over a channel's config: objects
  merge key by key, arrays and scalars from the preset replace.
- It never carries what belongs to one channel: no `channel_id`, `name`,
  `language`, `voice.provider`, `voice.voice_id` or `budget`.
  `validate:schemas` must fail if one of those appears.
- `scripts/validate-schemas.mjs` validates each preset: deep-merge it onto
  `contracts/fixtures/channel_config.json` and validate the result against
  `channel_config.schema.json` (mirror how themes are checked around line 154).
- The platform lists presets next to themes and style packs in
  `platform/src/app/api/config-options/route.ts` (reuse `listNames("presets")`).
  `ChannelConfigForm.tsx` gets a "Start from a preset" select at the top of the
  form. Choosing one deep-merges it into the form's current value; the user
  still reviews and saves. Nothing is applied to existing channels
  automatically.

## `contracts/presets/documentary.json`

Every value below comes from a decision already made. Look each one up and
don't invent any:

| Field | Value | From |
|---|---|---|
| `pipeline` | `"documentary"` | the plan |
| `theme` | `"documentary-dark"` | slice 7, D112 |
| `style_pack` | `"documentary"` | slices 1–9 |
| `captions.enabled` | `true` | DP shows captions; D113 |
| `source_policy.sfx.enabled` | `true` | slice 1 |
| `source_policy.music.enabled` | `true` | D114 |
| `source_policy.visual.footage` | `{"enabled": true, "amount": "normal"}` | D104 |
| `source_policy.visual.pick` | `{"enabled": true}` | D103 (leave `llm` to the channel) |
| `source_policy.visual.dedup` | `{"reuse_window_s": 30, "min_hamming_distance": 13, "max_beats_per_source": 3, "source_in_adjacent_beats": false}` | D113 |
| `voice.speakable` | `true` | D115 |
| `voice.speed` | `0.9` | D115 |
| `voice.review` | `{"enabled": true, "takes": 3}` | D115 (every extra take is paid: say so in `description`) |

Before writing it, open `data/videos/vid_dfd49c6c34e4/bench_fork.json`. That
is the benchmark's working override and the best evidence of a setup that
renders. Where a value there differs from the table, the table wins, but
mention the difference in your report.

`source_policy.visual.chain` stays out of the preset: which sources a channel
may use is a licensing choice. Say that in `description`.

## Tests

- `platform/test/`: a test that every preset merged onto the fixture validates,
  and that a preset carrying `voice.voice_id` is rejected. Put the merge and
  forbidden-keys logic in a small `platform/src/lib/presets.ts` so the route,
  the form and the test share it.
- `validate:schemas` fails on a deliberately broken copy (try it, then delete
  the copy).

## Benchmark

None needed. The benchmark's overrides already are this setup.

## Docs

- Next free D number in `decided.md`: the design above, and that the preset
  carries the channel half while the theme and pack carry the rest.
- `docs/03-contracts/channel-config.md`: a "Presets" section.
- The plan's "The preset" section: say it shipped, and link the file.
