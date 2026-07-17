# Edit Plan (`edit_plan.json`) — Draft v1 (carries proven v2 design)

The strict, compiled timeline. Produced by the compiler (normal path), a
human, or chat-agent patches — always validated before render. This is
the renderer's ONLY input besides asset files.

## Track model

| Track | Contents | Rules |
|---|---|---|
| `visual` | base items: broll / image / avatar, each with motion + transition_out | **contiguous, non-overlapping, starts at 0** |
| `overlays` | catalog component instances AND media overlays (PiP: media item + transform scale/position) | may overlap each other and the base |
| `captions` | subtitle items + style preset ref | imported from SRT once at compile; plan is then the source of truth |
| `audio` | exactly one voiceover + music/sfx (volume, loop, fades) | voiceover defines total duration |

Fixed track set; richness lives in items. Transitions consume handles,
never move narrative cuts; freeze-frame fallback.

## Item provenance + lock (the editor-sync rule)

Every item carries:

```json
{ "beat_id": "b12", "locked": false,
  "asset": { "source": "library", "id": "seg_8841", "license": "cc-by", "path": "clips/b12.mp4", "score": 0.71 } }
```

- `beat_id` — which beat produced this item (null for hand-added items).
- `locked` — set true automatically by any manual timeline edit.
- **Recompilation is per-beat and skips locked items.** Editing beat 12
  regenerates only b12's unlocked items; human timeline work is never
  wiped. The chat agent's plan patches follow the same rule.
- `asset` provenance feeds the Video screen's "assets used", license
  checks, and `mark_used` bookkeeping.

## Rejected alternatives (recorded so we don't re-litigate)

- AI generates render code per video → unvalidatable, uneditable, breaks
  parity, security surface.
- Imperative tool-call editing with no artifact → nothing to validate,
  diff, resume, review or open in an editor.
- OTIO/EDL as the native format → generic + heavy; revisit only if
  pro-NLE handoff becomes a feature (an OTIO exporter can be written FROM
  this plan at any time).

Even fully-agentic OpenMontage converges on a schema'd edit-decisions
JSON — the artifact approach is the industry-convergent answer; our
addition is the beat layer that makes it cheap for AI to produce.
