# Data Flow — one video, end to end

The running example: a history channel (doc style, slow pacing), script
mentions "By 1943, nearly 70% of the city's factories…".

1. **Enqueue (platform).** A Manager creates a video on the Queue screen:
   picks channel, optionally uploads script/audio/avatar video, optionally
   overrides source policy / captions / overlay density. Pre-flight
   validation runs per video (channel set? voice exists? inputs
   readable?). On "send to production": config merges into an immutable
   `cfg.json`, a `videos` row gets status QUEUED, the working folder is
   created, uploads are materialized into it.

2. **Pickup (worker).** The worker polls the queue table, claims the row
   (status PRODUCING, atomic UPDATE … WHERE status='QUEUED'), and from
   here on decides everything by files in the folder.

3. **Script.** Missing `script.txt` → the script agent runs (generator
   strategy + LLM provider from cfg; persona/style text from the
   channel's style pack). Cost event recorded.

4. **Narration.** Missing `audio.mp3` → TTS (channel voice). Missing
   `subtitles.srt` → produced by the TTS adapter or local Whisper (if the
   input was an uploaded avatar video, audio is extracted first).

5. **Beat planning (the creative core).** Missing `beats.json` → the
   planner agent gets: the script, the style pack (pacing numbers, arc,
   overlay density), the component catalog (when_to_use rules), and the
   channel's content rules. It outputs a beat sheet: N beats, each =
   script span + visual_intent + mood + data anchors + optional overlay
   suggestion. Validator checks it (schema, coverage of the whole script,
   density in range, anchors exist in text); violations go back for
   repair, max 3 attempts.

6. **Compile.** Deterministic: align each beat's text to the SRT → exact
   timings; enforce min/max hold (auto-split at sentence boundaries);
   resolve place names → coordinates for map components; apply channel
   defaults (transitions, caption style); emit strict `edit_plan.json`.
   By construction it passes structural validation.

7. **Resolve assets.** For each visual item, walk the source policy
   chain: library API (filters + min_score) → stock (cached searches) →
   AI image (budget-gated: estimate → reserve → generate → actual).
   `mark_used` to the library; provenance (source, id, license) written
   into the plan; files land in `clips/`.

8. **Validate (full).** Every asset present, every component + props in
   the catalog, timing coherence, one voiceover matching real audio
   duration. All violations collected. Fail → status ERROR with
   actionable events; fix and re-queue resumes from the missing artifact.

9. **Route + render.** The router inspects the plan: only
   cuts/crossfades/Ken Burns/plain captions → **ffmpeg**; anything with
   catalog components or styled captions → **Remotion** (theme injected).
   Engine invoked as CLI, writes `final.mp4` atomically, exits non-zero
   with one actionable reason on failure.

10. **Review (platform).** Status RENDERED → IN_REVIEW. An Editor watches
    it on the Video screen, opens the editor if needed (beat panel for
    semantic changes, timeline for precise ones, chat agent for both),
    approves or sends back. Approved → POSTED is set manually after
    upload; retention policy then thins the folder (clips/ first,
    final.mp4 after N days; beats, plan, cfg, logs, costs kept forever).

Every step wrote `video_events` rows (stage, status, message) and
`cost_events` rows — that's what the Pipeline, Monitoring and cost
screens read. No screen ever tails a log file.
