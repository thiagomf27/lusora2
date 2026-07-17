# Renderer Interface & Routing — Draft v1

One contract, two implementations (ffmpeg, Remotion), invoked by the
worker as a subprocess:

```
engine render --video-dir <folder> --renderer auto|ffmpeg|remotion
              [--outputs mp4]        # future: otio, shotlist
```

- Inputs: validated `edit_plan.json` (all asset paths filled) + asset
  files + theme (referenced from cfg). Captions from the plan, never from
  the .srt. No network, no DB.
- Output: `final.mp4` written atomically (temp name → rename). Exit 0 =
  success; failure = non-zero + ONE actionable reason on stderr.
- `--renderer auto` applies the routing table
  (see [Engine](../02-components/engine.md)); the chosen renderer is
  reported on stdout and recorded as a video_event.
- Capability profiles: `--renderer ffmpeg` on a plan needing more MUST
  fail with the list of offending items (validation, not degradation).
- Contract test (CI): synthetic fixture rendered by BOTH paths, ffprobe
  asserts duration/resolution/audio.
