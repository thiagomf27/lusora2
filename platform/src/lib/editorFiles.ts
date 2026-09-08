/** Editor file access: beats.json / edit_plan.json served THROUGH the API
 * from the video folder (the DB never mirrors artifacts). */
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { BeatSheet, EditPlan } from "@lusora/contracts";
import { query } from "../db/pool";
import { ApiError } from "./auth";
import { videoFolder, type VideoRow } from "./videos";
import { validateAgainst } from "./validate";
import { overlayPolicy, validateOverlays } from "./overlayRules";
import { transitionPolicy, validateTransitions } from "./transitionRules";

export function readArtifact<T>(videoId: string, name: string): T {
  const p = join(videoFolder(videoId), name);
  if (!existsSync(p)) throw new ApiError(404, `${name} not present in the video folder yet`);
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

export function readBeats(videoId: string): BeatSheet {
  return readArtifact<BeatSheet>(videoId, "beats.json");
}

export function readPlan(videoId: string): EditPlan {
  return readArtifact<EditPlan>(videoId, "edit_plan.json");
}

export function writePlan(videoId: string, plan: EditPlan): void {
  writeFileSync(join(videoFolder(videoId), "edit_plan.json"), JSON.stringify(plan, null, 2));
}

/**
 * Validate an edited beat sheet: schema, verbatim coverage of the script, and
 * the OVERLAY rules the worker's validator applies.
 *
 * The overlay half was missing, and llm-usage.md claimed it was not: an
 * overlay the chat agent invented reached beats.json and stopped the video at
 * compile, with an error about a stage the human never touched. The policy
 * comes from the video's frozen cfg.json, the same snapshot the worker reads,
 * so the editor and the pipeline judge against one set of rules.
 */
export function validateBeats(videoId: string, beats: BeatSheet): string[] {
  const schema = validateAgainst("beat_sheet", beats);
  if (!schema.ok) return schema.errors;
  const errors: string[] = [];

  const cfgPath = join(videoFolder(videoId), "cfg.json");
  const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf8")) : null;
  errors.push(...validateOverlays(beats.beats, overlayPolicy(cfg)));
  errors.push(...validateTransitions(beats.beats, transitionPolicy(cfg)));

  const scriptPath = join(videoFolder(videoId), "script.txt");
  if (existsSync(scriptPath)) {
    const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
    const script = norm(readFileSync(scriptPath, "utf8"));
    const concat = norm(
      beats.beats.filter((b) => b.kind === "narration").map((b) => b.script_text ?? "").join(" ")
    );
    if (concat !== script) {
      errors.push("narration beats must cover the entire script verbatim, in order (split/merge only at existing text)");
    }
  }
  return errors;
}

export function writeBeats(videoId: string, beats: BeatSheet): void {
  writeFileSync(join(videoFolder(videoId), "beats.json"), JSON.stringify(beats, null, 2));
}

/** System re-queue after a validated edit — the worker recompiles per-beat
 * (compile stage staleness) and re-renders. Uses the existing snapshot. */
export async function requeueForRecompile(video: VideoRow, reason: string): Promise<void> {
  await query(
    `UPDATE videos SET status = 'queued', error_reason = NULL, updated_at = now() WHERE id = $1`,
    [video.id]
  );
  await query(
    `INSERT INTO video_events (video_id, stage, status, message) VALUES ($1, 'editor', 'done', $2)`,
    [video.id, reason]
  );
}

/** Re-roll one beat: clear its unlocked items' assets so resolution runs again. */
export function clearBeatAssets(videoId: string, beatId: string): number {
  const plan = readPlan(videoId);
  let cleared = 0;
  for (const track of [plan.tracks.visual, plan.tracks.overlays] as const) {
    for (const item of track) {
      if (item.beat_id === beatId && !item.locked && "asset" in item && item.asset?.path) {
        const file = join(videoFolder(videoId), item.asset.path);
        if (existsSync(file)) unlinkSync(file);
        item.asset = { source: "manual", path: "" };
        cleared++;
      }
    }
  }
  if (cleared > 0) writePlan(videoId, plan);
  return cleared;
}
