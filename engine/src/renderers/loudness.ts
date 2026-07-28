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
export function normalizeLoudness(file: string): boolean {
  const tmp = file.replace(/\.mp4$/, ".loud.mp4");
  const proc = spawnSync(
    "ffmpeg",
    [
      "-y", "-hide_banner", "-loglevel", "error",
      "-i", file,
      "-af", LOUDNORM_FILTER,
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
