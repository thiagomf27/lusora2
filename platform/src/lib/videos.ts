/**
 * Video lifecycle helpers: folder layout, upload materialization,
 * pre-flight validation, cfg snapshot, enqueue.
 */
import { copyFileSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, isAbsolute, extname } from "node:path";
import type { ChannelConfig } from "@lusora/contracts";
import { query, one } from "../db/pool.ts";
import { ApiError } from "./auth.ts";
import { deepMerge } from "./merge.ts";
import { validateAgainst } from "./validate.ts";
import { loadEnv, repoRoot } from "./env.ts";
import { PROMPT_ROLES, resolvePrompt } from "./prompts.ts";
import { bulkProductionProblem, loadPipeline, selectPipeline } from "./pipelines.ts";
import { backgroundPath } from "./backgrounds.ts";
import { applyLook } from "./look.ts";

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

export interface EnqueueOptions {
  /** Batch enqueue: pipelines that opt out of bulk production are refused. */
  bulk?: boolean;
}

/**
 * Enqueue: pre-flight → merge channel config + overrides into the
 * immutable cfg snapshot → select the pipeline → write cfg.json → QUEUED.
 */
export async function enqueueVideo(
  video: VideoRow,
  overrides: Record<string, unknown> | null,
  options: EnqueueOptions = {}
): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  if (!["draft", "error", "sent_back"].includes(video.status)) {
    return { ok: false, problems: [`cannot enqueue from status ${video.status}`] };
  }
  const pf = await preflight(video);
  if (!pf.ok) return { ok: false, problems: pf.problems };

  // Re-runs use the existing snapshot (Core Principle 7) — later channel
  // edits never retroactively change a video.
  const existing = video.cfg as unknown as Record<string, unknown> | null;
  if (existing && existing.channel_id) {
    const folder = videoFolder(video.id);
    mkdirSync(folder, { recursive: true });
    if (!existsSync(join(folder, "cfg.json"))) {
      writeFileSync(join(folder, "cfg.json"), JSON.stringify(existing, null, 2));
    }
    await query(
      `UPDATE videos SET status = 'queued', folder_path = $2, error_reason = NULL, updated_at = now() WHERE id = $1`,
      [video.id, folder]
    );
    await query(
      `INSERT INTO video_events (video_id, stage, status, message)
       VALUES ($1, 'enqueue', 'done', 're-queued with existing snapshot')`,
      [video.id]
    );
    return { ok: true };
  }

  const channel = await one<{ config: ChannelConfig }>(
    "SELECT config FROM channels WHERE id = $1",
    [video.channel_id]
  );
  const snapshot = deepMerge(
    channel!.config as unknown as Record<string, unknown>,
    overrides
  );

  // embed the referenced style pack + theme documents (snapshot at enqueue)
  for (const [field, dir, name] of [
    ["style_pack_doc", "style-packs", snapshot.style_pack],
    ["theme_doc", "themes", snapshot.theme],
  ] as const) {
    const docPath = join(repoRoot(), "contracts", dir, `${name}.json`);
    if (!existsSync(docPath)) {
      return { ok: false, problems: [`${dir}/${name}.json not found in contracts — create it or fix the channel config`] };
    }
    if (snapshot[field] === undefined) {
      snapshot[field] = JSON.parse(readFileSync(docPath, "utf8"));
    }
  }

  // embed the sound pack manifest (D48). Same snapshot rule, but resolved
  // AFTER theme_doc because the theme is where the pack name lives when the
  // channel does not name one. A channel with no pack anywhere produces a
  // silent video, which is a legitimate configuration and not an error.
  if (snapshot.sound_pack_doc === undefined) {
    const themeDoc = snapshot.theme_doc as { sound?: { pack?: string } } | undefined;
    const policy = snapshot.source_policy as { sound_pack?: string } | undefined;
    const packName = policy?.sound_pack ?? themeDoc?.sound?.pack;
    if (packName) {
      const packPath = join(repoRoot(), "contracts", "sound-packs", packName, "manifest.json");
      if (!existsSync(packPath)) {
        return {
          ok: false,
          problems: [
            `sound-packs/${packName}/manifest.json not found in contracts — create the pack or clear source_policy.sound_pack / theme sound.pack`,
          ],
        };
      }
      snapshot.sound_pack_doc = JSON.parse(readFileSync(packPath, "utf8"));
    }
  }

  // Select the pipeline and embed the manifest (D60). Selection happens HERE,
  // once, and the worker walks what it finds: a manifest edited later never
  // changes this video, and a re-run reproduces the same stage order — the
  // same snapshot rule as the theme and the style pack (Principle 7).
  if (snapshot.pipeline_doc === undefined) {
    const selection = selectPipeline(snapshot as { pipeline?: string });
    const loaded = loadPipeline(selection.name);
    if (!loaded.ok) return { ok: false, problems: [loaded.problem] };
    if (options.bulk) {
      const problem = bulkProductionProblem(loaded.manifest);
      if (problem) return { ok: false, problems: [problem] };
    }
    snapshot.pipeline = loaded.manifest.name;
    snapshot.pipeline_doc = loaded.manifest;
  }

  // Resolve each agent's prompt and embed its TEXT (D44). The style pack layer
  // reads style_pack_doc, so this has to run after the embed above. The welded
  // contract half is NOT snapshotted: it must match the validator that will
  // judge the output, not the one that existed at enqueue.
  if (snapshot.prompts === undefined) {
    const prompts: Record<string, unknown> = {};
    for (const role of PROMPT_ROLES) {
      const result = resolvePrompt(snapshot, role, overrides);
      if ("problem" in result) return { ok: false, problems: [result.problem] };
      prompts[role] = result.resolved;
    }
    snapshot.prompts = prompts;
  }

  // Narrow the embedded docs by `look` (subtractive), and copy the chosen
  // background into the video folder so the render resolves it like any other
  // asset — a later change to the library never alters a finished video.
  const lookProblems = applyLook(snapshot);
  const background = (snapshot.look as ChannelConfig["look"])?.background?.image;
  if (background) {
    try {
      if (!existsSync(backgroundPath(video.channel_id, background))) {
        lookProblems.push(`look.background.image '${background}' is not in the channel's background library`);
      }
    } catch (e) {
      lookProblems.push(`look.background.image: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (lookProblems.length) return { ok: false, problems: lookProblems };

  const check = validateAgainst("channel_config", snapshot);
  if (!check.ok) {
    return { ok: false, problems: check.errors.map((e) => `merged cfg: ${e}`) };
  }

  const folder = videoFolder(video.id);
  mkdirSync(folder, { recursive: true });

  const chosenBackground = (snapshot.look as ChannelConfig["look"])?.background?.image;
  if (chosenBackground) {
    const copied = `background${extname(chosenBackground).toLowerCase()}`;
    copyFileSync(backgroundPath(video.channel_id, chosenBackground), join(folder, copied));
    (snapshot.look as ChannelConfig["look"])!.background!.image = copied;
  }

  writeFileSync(join(folder, "cfg.json"), JSON.stringify(snapshot, null, 2));

  await query(
    `UPDATE videos SET status = 'queued', cfg = $2, folder_path = $3,
       error_reason = NULL, updated_at = now() WHERE id = $1`,
    [video.id, JSON.stringify(snapshot), folder]
  );
  const pipeline = snapshot.pipeline_doc as { name: string; version: string } | undefined;
  await query(
    `INSERT INTO video_events (video_id, stage, status, message)
     VALUES ($1, 'enqueue', 'done', $2)`,
    [
      video.id,
      pipeline
        ? `queued with cfg snapshot — pipeline ${pipeline.name} v${pipeline.version}`
        : "queued with cfg snapshot",
    ]
  );
  return { ok: true };
}
