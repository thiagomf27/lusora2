/**
 * What the shot judge saw, per shot, as links a person can open before
 * approving a footage gate (D105). Read from the video folder only —
 * shot_picks.json, footage.json, beats.json and the plan — so it has no
 * database import and a test can load it directly.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { videoFolder } from "./folders.ts";

export interface FootageCandidate {
  rating: number;
  desc: string;
  source: string;
  /** where a person can see it: the YouTube moment, the photo's page, the stock page */
  link: string | null;
  /** a picture to show inline, when one is on disk or known by URL */
  thumb: string | null;
  /** true for the one resolve_assets actually placed */
  placed: boolean;
}

export interface FootageRow {
  item_id: string;
  beat_id: string | null;
  narration: string;
  hook: boolean;
  candidates: FootageCandidate[];
}

export interface FootageView {
  rows: FootageRow[];
  sheets: string[];
  unjudged: string[];
  min_rating: number;
}

function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** A file inside the video folder, as the files route serves it. */
function fileUrl(videoId: string, rel: string): string {
  return `/api/videos/${videoId}/files/${rel.split("/").map(encodeURIComponent).join("/")}`;
}

export function footageView(videoId: string, perShot = 3): FootageView | null {
  const folder = videoFolder(videoId);
  const picks = readJson(join(folder, "shot_picks.json"));
  if (!picks || picks.enabled === false) return null;
  const pool = readJson(join(folder, "footage.json")) ?? { videos: [], photos: [] };
  const beats: any[] = readJson(join(folder, "beats.json"))?.beats ?? [];
  const plan = readJson(join(folder, "edit_plan.json"));
  const cfg = readJson(join(folder, "cfg.json"));
  const minRating = Number(cfg?.source_policy?.visual?.pick?.min_rating ?? 3);

  const narration = new Map(beats.map((b) => [String(b.id), String(b.script_text ?? "")]));
  const videos = new Map<string, any>((pool.videos ?? []).map((v: any) => [String(v.id), v]));
  const photos = new Map<string, any>((pool.photos ?? []).map((p: any) => [String(p.id), p]));
  const visual: any[] = plan?.tracks?.visual ?? [];
  const placedBy = new Map(visual.map((v) => [String(v.id), v.asset ?? {}]));
  const hookItems = new Set(visual.filter((v) => v.hook).map((v) => String(v.id)));

  const describe = (itemId: string, c: any): FootageCandidate => {
    const placedAsset = placedBy.get(itemId) ?? {};
    const placed = String(placedAsset.id ?? "") === String(c.id) && placedAsset.source === c.source;
    let link: string | null = null;
    let thumb: string | null = typeof c.thumb === "string" && c.thumb.startsWith("http") ? c.thumb : null;
    if (c.source === "youtube") {
      const [vid, n] = String(c.id).split("#");
      const video = videos.get(vid);
      const shot = (video?.shots ?? []).find((s: any) => String(s.n) === n);
      if (video) link = `${video.url}${String(video.url).includes("?") ? "&" : "?"}t=${Math.floor(Number(shot?.start ?? 0))}s`;
      if (shot?.thumb && existsSync(join(folder, shot.thumb))) thumb = fileUrl(videoId, shot.thumb);
    } else if (c.source === "archive") {
      const photo = photos.get(String(c.id));
      link = photo?.page || photo?.url || null;
      thumb = thumb ?? photo?.thumb ?? null;
    } else if (c.source === "stock" && c.provider === "pexels") {
      link = `https://www.pexels.com/video/${c.id}/`;
    }
    return { rating: Number(c.rating), desc: String(c.desc ?? ""), source: String(c.source), link, thumb, placed };
  };

  const rows: FootageRow[] = Object.entries<any>(picks.items ?? {}).map(([itemId, entry]) => {
    const all: any[] = entry.candidates ?? [];
    const top = all.slice(0, perShot);
    // the placed one is always shown, even when it is not among the best
    const placedAsset = placedBy.get(itemId) ?? {};
    const placedExtra = all.find((c, k) => k >= perShot && String(c.id) === String(placedAsset.id));
    return {
      item_id: itemId,
      beat_id: entry.beat_id ?? null,
      narration: narration.get(String(entry.beat_id)) ?? "",
      hook: hookItems.has(itemId),
      candidates: [...top, ...(placedExtra ? [placedExtra] : [])].map((c) => describe(itemId, c)),
    };
  });
  const order = new Map(visual.map((v, k) => [String(v.id), k]));
  rows.sort((a, b) => (order.get(a.item_id) ?? 1e9) - (order.get(b.item_id) ?? 1e9));

  const sheetsDir = join(folder, "sheets");
  const sheets = existsSync(sheetsDir)
    ? readdirSync(sheetsDir).filter((f) => f.endsWith(".jpg")).sort().map((f) => fileUrl(videoId, `sheets/${f}`))
    : [];
  return { rows, sheets, unjudged: picks.unjudged ?? [], min_rating: minRating };
}
