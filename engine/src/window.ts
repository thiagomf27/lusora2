/**
 * Render windows — draw only a stretch of the timeline (documentary plan,
 * benchmark renders).
 *
 * A TEST knob: every stage before render still plans, sources and compiles the
 * whole video; only the render draws less, so a slice can be watched in a
 * third of the time. The worker passes `--window <start>-<end>` from the
 * video's `output.window`; seconds are PLAN seconds, and the file's t=0 is the
 * window's start.
 */
import { execFileSync } from "node:child_process";
import { renameSync } from "node:fs";

export interface RenderWindow {
  start_s: number;
  end_s: number;
}

/**
 * Parse `<start>-<end>` (seconds) and clamp it to the plan. Throws one
 * actionable reason: a window that is empty, or starts past the end, is a
 * mistake to stop on rather than a render to shorten silently.
 */
export function parseWindow(raw: string, planDuration: number): RenderWindow {
  const m = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(raw.trim());
  if (!m) throw new Error(`--window must be <start>-<end> in seconds, e.g. 0-75 (got '${raw}')`);
  const start_s = Number(m[1]);
  const end_s = Math.min(Number(m[2]), planDuration);
  if (start_s >= planDuration) {
    throw new Error(`--window starts at ${start_s}s but the plan is only ${planDuration.toFixed(2)}s long`);
  }
  if (end_s <= start_s) throw new Error(`--window ${raw} is empty — end must be after start`);
  return { start_s, end_s };
}

/** The window as a Remotion frameRange: inclusive frame indices. */
export function frameRange(window: RenderWindow, fps: number): [number, number] {
  const first = Math.round(window.start_s * fps);
  const last = Math.max(first, Math.round(window.end_s * fps) - 1);
  return [first, last];
}

/**
 * Cut a finished file down to the window, re-encoding so the cut is frame
 * accurate (a stream copy would snap to the nearest keyframe). Used by the
 * ffmpeg renderer, which draws the whole timeline in one graph; Remotion draws
 * only the window in the first place.
 */
export function trimToWindow(file: string, window: RenderWindow): void {
  const tmp = file.replace(/\.mp4$/, ".window.mp4");
  execFileSync("ffmpeg", [
    "-y", "-v", "error",
    "-ss", window.start_s.toFixed(3), "-to", window.end_s.toFixed(3), "-i", file,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-b:a", "160k",
    "-movflags", "+faststart", tmp,
  ]);
  renameSync(tmp, file);
}
