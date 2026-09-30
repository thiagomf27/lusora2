/**
 * Output loudness normalization (D48), shared by both render paths.
 *
 * -14 LUFS is YouTube's target: deliver at it and the platform's own
 * normalization leaves the mix alone, so what is heard is what was mixed. It is
 * also most of the perceptual gap between "auto-generated" and "produced" — a
 * video that arrives 8 dB quiet than the one before it in the feed reads as
 * amateur before a word is spoken.
 *
 * The ffmpeg renderer folds loudnorm into its existing mux filter chain (one
 * pass, no extra encode). The Remotion renderer has no filter chain of its own,
 * so it calls this afterwards: a remux that re-encodes audio only, leaving the
 * video stream copied.
 */
import { spawnSync } from "node:child_process";
import { renameSync, unlinkSync } from "node:fs";

/** Single-pass loudnorm args. Two-pass costs a full extra decode for a
 *  difference the ear cannot hear at this precision. */
export const LOUDNORM_FILTER = "loudnorm=I=-14:TP=-1.5:LRA=11";

/**
 * Normalize `file` in place, copying the video stream.
 *
 * Failure is deliberately non-fatal: a finished video that is 3 dB quiet is
 * worth shipping, and a render that took ten minutes should not be thrown away
 * over its last step. Returns whether the pass actually applied.
 */
export function normalizeLoudness(file: string, mode: "single" | "two_pass" = "single"): boolean {
  const tmp = file.replace(/\.mp4$/, ".loud.mp4");
  const filter = mode === "two_pass" ? twoPassFilter(file) ?? LOUDNORM_FILTER : LOUDNORM_FILTER;
  const proc = spawnSync(
    "ffmpeg",
    [
      "-y", "-hide_banner", "-loglevel", "error",
      "-i", file,
      "-af", filter,
      "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
      "-movflags", "+faststart",
      tmp,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  if (proc.status !== 0) {
    console.warn(
      `[loudness] normalization skipped: ${(proc.stderr || "").trim().split("\n").slice(-3).join(" ")}`
    );
    try {
      unlinkSync(tmp);
    } catch {
      // nothing to clean up
    }
    return false;
  }
  renameSync(tmp, file);
  return true;
}

/**
 * D114 — the second pass of a two-pass loudnorm: measure the whole mix, then
 * apply ONE linear gain to the target (loudnorm falls back to dynamic only if
 * that gain would break the true-peak ceiling). A single dynamic pass rides
 * the gain through the video, which undoes the balance of voice, bed and cues
 * the plan set; this keeps it. Null when the measurement fails, so the caller
 * falls back to the single pass.
 */
export function twoPassFilter(file: string): string | null {
  const proc = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-i", file, "-af", `${LOUDNORM_FILTER}:print_format=json`, "-f", "null", "-"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  const err = proc.stderr || "";
  const open = err.lastIndexOf("{");
  const close = err.lastIndexOf("}");
  if (proc.status !== 0 || open < 0 || close < open) return null;
  try {
    const m = JSON.parse(err.slice(open, close + 1)) as Record<string, string>;
    if (!Number.isFinite(Number(m.input_i))) return null;
    return (
      `${LOUDNORM_FILTER}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}` +
      `:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`
    );
  } catch {
    return null;
  }
}
