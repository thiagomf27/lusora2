/**
 * The A/B fork (docs/05-roadmap/directed-edit-test.md, slice 5): a second video
 * that differs from its source in ONE thing, the pipeline.
 *
 * The fork is not re-enqueued from the channel. Its cfg snapshot is the
 * source's own, with `pipeline` and `pipeline_doc` swapped, so a channel edit
 * between the two runs cannot become a second variable. The narration is not
 * re-made either: the four files below are copied, so both arms cut, craft and
 * compile against the same audio and the same timings.
 *
 * Pure apart from the file system: the database half lives in
 * scripts/ab-fork.ts, so this module is testable with neither.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { PipelineManifest } from "@lusora/contracts";

/** What the fork shares with its source, in copy order. `tts_timings.json` is
 *  not uploadable, and without it the fork would compile from the SRT while
 *  the source compiled from the TTS timings — a confound nobody would see. */
export const FORK_FILES = ["script.txt", "audio.mp3", "subtitles.srt", "tts_timings.json"] as const;
/** The ones a fork cannot run without. Timings are optional: a voice that
 *  returns none leaves both arms compiling from the SRT, which is still fair. */
export const REQUIRED_FORK_FILES = ["script.txt", "audio.mp3", "subtitles.srt"] as const;

/** Snapshot keys the fork is allowed to differ in. */
export const FORK_VARIABLE = ["pipeline", "pipeline_doc"] as const;

export const FORK_RECORD = "ab_fork.json";

/** The fork's snapshot: the source's, with only the pipeline swapped. */
export function forkSnapshot(
  source: Record<string, unknown>,
  manifest: PipelineManifest
): Record<string, unknown> {
  const snapshot = structuredClone(source);
  snapshot.pipeline = manifest.name;
  snapshot.pipeline_doc = manifest;
  return snapshot;
}

/** Key order must not count as a difference: Postgres JSONB reorders keys. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Top-level snapshot keys that differ beyond the pipeline. Empty = a clean pair. */
export function snapshotDifferences(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys]
    .filter((k) => !(FORK_VARIABLE as readonly string[]).includes(k))
    .filter((k) => canonical(a[k]) !== canonical(b[k]))
    .sort();
}

/** The same narration, ignoring line endings and the trailing newline. */
export function sameNarration(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\r\n?/g, "\n").trim();
  return norm(a) === norm(b);
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Which of the shared files the source is missing, required ones only. */
export function missingForkFiles(sourceFolder: string): string[] {
  return REQUIRED_FORK_FILES.filter((f) => !existsSync(join(sourceFolder, f)));
}

/**
 * Copy the shared files into the fork's folder, byte for byte — AFTER anything
 * else wrote there, so a paste that re-wrote script.txt with its own trailing
 * newline cannot make the two arms' scripts differ by a byte.
 */
export function copyForkFiles(sourceFolder: string, forkFolder: string): Record<string, string> {
  const missing = missingForkFiles(sourceFolder);
  if (missing.length) throw new Error(`the source has no ${missing.join(", ")} — let it run past transcript first`);
  mkdirSync(forkFolder, { recursive: true });
  const hashes: Record<string, string> = {};
  for (const file of FORK_FILES) {
    const from = join(sourceFolder, file);
    if (!existsSync(from)) continue;
    copyFileSync(from, join(forkFolder, file));
    hashes[file] = sha256File(from);
  }
  return hashes;
}

export interface ForkRecord {
  from: string;
  from_pipeline: string;
  pipeline: string;
  files: Record<string, string>;
  created_at: string;
}

/** ab_fork.json in the fork's folder: what the report pairs by. */
export function writeForkRecord(forkFolder: string, record: ForkRecord): void {
  writeFileSync(join(forkFolder, FORK_RECORD), JSON.stringify(record, null, 2) + "\n");
}
