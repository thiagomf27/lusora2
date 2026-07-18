/**
 * Video lifecycle helpers: folder layout, upload materialization,
 * pre-flight validation, cfg snapshot, enqueue.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import type { ChannelConfig } from "@lusora/contracts";
import { query, one } from "../db/pool.ts";
import { ApiError } from "./auth.ts";
import { deepMerge } from "./merge.ts";
import { validateAgainst } from "./validate.ts";
import { loadEnv, repoRoot } from "./env.ts";

export function videosRoot(): string {
  loadEnv();
  const root = process.env.VIDEOS_ROOT ?? join(repoRoot(), "data/videos");
  return isAbsolute(root) ? root : join(repoRoot(), root);
}

export function videoFolder(videoId: string): string {
  return join(videosRoot(), videoId);
}

/** Uploadable artifacts (manual-first): field name -> file name in the folder. */
export const UPLOADABLE: Record<string, string> = {
  script: "script.txt",
  audio: "audio.mp3",
  avatar_video: "avatar.mp4",
  subtitles: "subtitles.srt",
  beats: "beats.json",
  plan: "edit_plan.json",
};

export interface VideoRow {
  id: string;
  channel_id: string;
  title: string;
  status: string;
  cfg: ChannelConfig | null;
  folder_path: string | null;
  youtube_id: string | null;
  price_usd: string;
  size_bytes: number | null;
  error_reason: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export async function getVideo(id: string): Promise<VideoRow> {
  const row = await one<VideoRow>("SELECT * FROM videos WHERE id = $1", [id]);
  if (!row) throw new ApiError(404, `video ${id} not found`);
  return row;
}

export async function materializeUploads(
  videoId: string,
  form: FormData
): Promise<string[]> {
  const folder = videoFolder(videoId);
  mkdirSync(folder, { recursive: true });
  const written: string[] = [];
  for (const [field, filename] of Object.entries(UPLOADABLE)) {
    const file = form.get(field);
    if (file && file instanceof File && file.size > 0) {
      const buf = Buffer.from(await file.arrayBuffer());
      if (filename.endsWith(".json")) {
        // validate provided beats/plan before accepting (manual-first, but never unvalidated)
        const schemaName = filename === "beats.json" ? "beat_sheet" : "edit_plan";
        let parsed: unknown;
        try {
          parsed = JSON.parse(buf.toString("utf8"));
        } catch {
          throw new ApiError(400, `${field}: not valid JSON`);
        }
        const res = validateAgainst(schemaName, parsed);
        if (!res.ok) {
          throw new ApiError(400, `${field}: schema violations: ${res.errors.join("; ")}`);
        }
      }
      writeFileSync(join(folder, filename), buf);
      written.push(filename);
    }
  }
  return written;
}

export interface PreflightResult {
  ok: boolean;
  problems: string[];
}

/** Pre-flight validation per video, run before enqueue. */
export async function preflight(video: VideoRow): Promise<PreflightResult> {
  const problems: string[] = [];

  const channel = await one<{ id: string; active: boolean; config: ChannelConfig }>(
    "SELECT id, active, config FROM channels WHERE id = $1",
    [video.channel_id]
  );
  if (!channel) {
    problems.push(`channel ${video.channel_id} does not exist`);
    return { ok: false, problems };
  }
  if (!channel.active) problems.push(`channel ${video.channel_id} is inactive`);

  const cfgCheck = validateAgainst("channel_config", channel.config);
  if (!cfgCheck.ok) {
    problems.push(...cfgCheck.errors.map((e) => `channel config: ${e}`));
  }
  const cfg = channel.config;
  if (!cfg.voice?.provider) problems.push("channel has no voice provider");

  if (!video.title?.trim()) problems.push("video has no title");

  // uploaded inputs must be readable where present
  const folder = videoFolder(video.id);
  if (existsSync(folder)) {
    for (const filename of Object.values(UPLOADABLE)) {
      const p = join(folder, filename);
      if (existsSync(p)) {
        try {
          readFileSync(p, { encoding: null });
        } catch {
          problems.push(`uploaded ${filename} is not readable`);
        }
      }
    }
  }

  return { ok: problems.length === 0, problems };
}

/**
 * Enqueue: pre-flight → merge channel config + overrides into the
 * immutable cfg snapshot → write cfg.json → status QUEUED.
 */
export async function enqueueVideo(
  video: VideoRow,
  overrides: Record<string, unknown> | null
): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  if (!["draft", "error", "sent_back"].includes(video.status)) {
    return { ok: false, problems: [`cannot enqueue from status ${video.status}`] };
  }
  const pf = await preflight(video);
  if (!pf.ok) return { ok: false, problems: pf.problems };

  const channel = await one<{ config: ChannelConfig }>(
    "SELECT config FROM channels WHERE id = $1",
    [video.channel_id]
  );
  const snapshot = deepMerge(
    channel!.config as unknown as Record<string, unknown>,
    overrides
  );
  const check = validateAgainst("channel_config", snapshot);
  if (!check.ok) {
    return { ok: false, problems: check.errors.map((e) => `merged cfg: ${e}`) };
  }

  const folder = videoFolder(video.id);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "cfg.json"), JSON.stringify(snapshot, null, 2));

  await query(
    `UPDATE videos SET status = 'queued', cfg = $2, folder_path = $3,
       error_reason = NULL, updated_at = now() WHERE id = $1`,
    [video.id, JSON.stringify(snapshot), folder]
  );
  await query(
    `INSERT INTO video_events (video_id, stage, status, message)
     VALUES ($1, 'enqueue', 'done', 'queued with cfg snapshot')`,
    [video.id]
  );
  return { ok: true };
}
