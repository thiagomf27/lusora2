/**
 * Sound packs live as a folder per name under contracts/sound-packs — a
 * manifest.json plus the audio files it names. The same folders the worker
 * snapshots into cfg.json at enqueue (lib/videos.ts) and copies from in the
 * resolve_audio stage. There is no sound_packs table; these helpers are the
 * whole storage layer, exactly like lib/themes.ts.
 *
 * The one rule worth stating twice: `duration_s` is always PROBED from the
 * real file, never taken from the client. The compiler sizes one-shot cue
 * items from it, so a wrong value makes a cue end early or overrun its window
 * and nothing complains until someone listens.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { SoundPack } from "@lusora/contracts";
import { repoRoot } from "./env.ts";

/** The name is also the folder name, so it must be a safe slug. */
export const SOUND_PACK_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
/** Cue and bed keys are slugs too — they become filenames in the video folder. */
export const SOUND_ENTRY_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export const SOUND_NAME_HINT =
  "name must be lowercase letters, digits and dashes (e.g. doc-restrained)";

/** Formats the renderers can actually decode, and browsers can play back. */
export const AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".ogg", ".flac"];

export function soundPacksDir(): string {
  return join(repoRoot(), "contracts", "sound-packs");
}

export function soundPackDir(name: string): string {
  if (!SOUND_PACK_NAME_RE.test(name)) throw new Error(SOUND_NAME_HINT);
  return join(soundPacksDir(), name);
}

export function manifestPath(name: string): string {
  return join(soundPackDir(name), "manifest.json");
}

export function listSoundPacks(): string[] {
  const dir = soundPacksDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "manifest.json")))
    .map((e) => e.name)
    .sort();
}

export function readSoundPack(name: string): SoundPack {
  return JSON.parse(readFileSync(manifestPath(name), "utf8")) as SoundPack;
}

export function serializeSoundPack(pack: unknown): string {
  return JSON.stringify(pack, null, 2) + "\n";
}

export function writeSoundPack(name: string, pack: SoundPack): void {
  writeFileSync(manifestPath(name), serializeSoundPack(pack));
}

/**
 * Real duration in seconds, from ffprobe.
 *
 * Returns null when the file is not decodable audio, which is also how upload
 * validates what it was handed: a .mp3 extension on a JPEG probes to nothing.
 */
export function probeDuration(file: string): number | null {
  const proc = spawnSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "a:0", "-show_entries", "format=duration",
     "-of", "default=nw=1:nk=1", file],
    { encoding: "utf8" }
  );
  if (proc.status !== 0) return null;
  const seconds = Number(String(proc.stdout).trim());
  return Number.isFinite(seconds) && seconds > 0 ? Number(seconds.toFixed(3)) : null;
}

/** Peak in dBFS, for the cue normalization below. */
function probePeak(file: string): number | null {
  const proc = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "volumedetect", "-f", "null", "-"],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const m = /max_volume:\s*(-?[\d.]+) dB/.exec(proc.stderr ?? "");
  return m ? Number(m[1]) : null;
}

/** Cues are peak-normalized, beds loudness-normalized (see the pack README). */
export const CUE_PEAK_DBFS = -6;
export const BED_LUFS = -24;

/**
 * Normalize an uploaded file in place, by kind.
 *
 * Cues by PEAK and beds by LOUDNESS, which is not an inconsistency: EBU R128
 * integrated loudness of a 0.4s transient is close to meaningless (its gating
 * discards most of it), so loudnorm would push a swoosh until it is
 * clipping-hot while the measured number still read quiet. Normalizing every
 * cue to one ceiling is what makes a theme's `gain.sfx` a predictable trim
 * across the pack rather than a per-file guess.
 *
 * Returns false when the pass could not run; the caller keeps the original,
 * because an un-normalized sound is still a usable sound.
 */
export function normalizeAudio(file: string, kind: "cue" | "bed"): boolean {
  const tmp = file.replace(/(\.[a-z0-9]+)$/i, ".norm$1");
  let filter: string;
  if (kind === "bed") {
    filter = `loudnorm=I=${BED_LUFS}:TP=-3:LRA=7`;
  } else {
    const peak = probePeak(file);
    if (peak === null) return false;
    filter = `volume=${(CUE_PEAK_DBFS - peak).toFixed(2)}dB`;
  }
  const proc = spawnSync(
    "ffmpeg",
    ["-y", "-hide_banner", "-loglevel", "error", "-i", file, "-af", filter, "-ac", "1", tmp],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
  );
  if (proc.status !== 0 || !existsSync(tmp)) return false;
  writeFileSync(file, readFileSync(tmp));
  try {
    unlinkSync(tmp);
  } catch {
    // best-effort cleanup; a leftover .norm file is cosmetic, not a failure
  }
  return true;
}

export function isAudioExtension(name: string): boolean {
  return AUDIO_EXTENSIONS.includes(extname(name).toLowerCase());
}

/**
 * Every cue/bed name a theme references, as `pack -> name -> theme names`.
 *
 * This is what makes deleting safe: a theme naming a cue that no longer exists
 * is a hard compile error on the next video, so the UI has to be able to say
 * "history-dark uses this" before anyone removes it.
 */
export function soundUsage(): Record<string, Record<string, string[]>> {
  const out: Record<string, Record<string, string[]>> = {};
  const themesDir = join(repoRoot(), "contracts", "themes");
  if (!existsSync(themesDir)) return out;

  for (const file of readdirSync(themesDir).filter((f) => f.endsWith(".json"))) {
    let theme: { name?: string; sound?: Record<string, unknown> };
    try {
      theme = JSON.parse(readFileSync(join(themesDir, file), "utf8"));
    } catch {
      continue;
    }
    const sound = theme.sound;
    const pack = sound?.pack as string | undefined;
    if (!sound || !pack) continue;
    const themeName = theme.name ?? file.replace(/\.json$/, "");

    const note = (value: unknown) => {
      if (typeof value !== "string" || !value || value === "none") return;
      out[pack] ??= {};
      out[pack][value] ??= [];
      if (!out[pack][value].includes(themeName)) out[pack][value].push(themeName);
    };
    note(sound.entrance);
    note(sound.transition);
    for (const group of ["per_entrance", "per_component", "mood_beds"] as const) {
      const map = sound[group];
      if (map && typeof map === "object") Object.values(map).forEach(note);
    }
  }
  return out;
}
