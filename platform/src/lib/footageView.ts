/**
 * What the shot judge saw, per shot, as links a person can open before
 * approving a footage gate (D105), and which candidate each shot will use
 * (D109). Read from the video folder only — shot_picks.json, footage.json,
 * footage_choices.json, beats.json and the plan — so it has no database
 * import and a test can load it directly.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { videoFolder } from "./folders.ts";

export interface FootageCandidate {
  /** the candidate's id within its source, what a choice names */
  id: string;
  rating: number;
  desc: string;
  source: string;
  /** where a person can see it: the YouTube moment, the photo's page, the stock page */
  link: string | null;
  /** a picture to show inline, when one is on disk or known by URL */
  thumb: string | null;
  /** a person picked this one at the gate (D109) */
  chosen: boolean;
  /** the one this shot shows: placed after the render, predicted before it */
  used: boolean;
}

export interface FootageRow {
  item_id: string;
  beat_id: string | null;
  narration: string;
  hook: boolean;
  start_s: number;
  end_s: number;
  /** 1-based position among the shots its beat is cut into, and how many */
  shot: number;
  shots_in_beat: number;
  /** false = nothing judged is good enough: the plain search answers at render time */
  covered: boolean;
  candidates: FootageCandidate[];
}

export interface FootageView {
  rows: FootageRow[];
  sheets: string[];
  unjudged: string[];
  min_rating: number;
  /** true once resolve_assets ran: `used` is what IS on screen, not a prediction */
  resolved: boolean;
}

/** resolve_assets' own last resort (pick_shots.LAST_RESORT_RATING). */
const LAST_RESORT_RATING = 2;

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

const key = (c: { source?: unknown; id?: unknown }) => `${c.source}:${c.id}`;

export function footageView(videoId: string, perShot = 3): FootageView | null {
  const folder = videoFolder(videoId);
  const picks = readJson(join(folder, "shot_picks.json"));
  if (!picks || picks.enabled === false) return null;
  const pool = readJson(join(folder, "footage.json")) ?? { videos: [], photos: [] };
  const beats: any[] = readJson(join(folder, "beats.json"))?.beats ?? [];
  const plan = readJson(join(folder, "edit_plan.json"));
  const cfg = readJson(join(folder, "cfg.json"));
  const choices: Record<string, any> = readJson(join(folder, "footage_choices.json"))?.choices ?? {};
  const minRating = Number(cfg?.source_policy?.visual?.pick?.min_rating ?? 3);

  const narration = new Map(beats.map((b) => [String(b.id), String(b.script_text ?? "")]));
  const videos = new Map<string, any>((pool.videos ?? []).map((v: any) => [String(v.id), v]));
  const photos = new Map<string, any>((pool.photos ?? []).map((p: any) => [String(p.id), p]));
  const visual: any[] = plan?.tracks?.visual ?? [];
  const byItem = new Map(visual.map((v) => [String(v.id), v]));
  // resolve_assets writes each item's asset into the plan; before it, they are
  // empty (clip files are no test: retention may delete them after the render)
  const resolved = visual.some((v) => v.asset?.source);

  // how each beat is cut into shots, in plan order
  const perBeat = new Map<string, string[]>();
  for (const v of visual) {
    const b = String(v.beat_id ?? "");
    perBeat.set(b, [...(perBeat.get(b) ?? []), String(v.id)]);
  }

  // which candidate each shot uses: what IS placed after resolve, otherwise
  // resolve_assets' own rule replayed in plan order — a person's choice first,
  // then the best at min_rating not already on screen, then the last resort
  const used = new Map<string, string>();
  const onScreen = new Set<string>();
  for (const v of visual) {
    const itemId = String(v.id);
    const entry = picks.items?.[itemId];
    if (resolved) {
      if (v.asset?.source) used.set(itemId, key(v.asset));
      continue;
    }
    if (!entry) continue;
    const cands: any[] = entry.candidates ?? [];
    const choice = choices[itemId];
    let pick = choice ? cands.find((c) => key(c) === key(choice)) : undefined;
    pick ??= cands.find((c) => Number(c.rating) >= minRating && !onScreen.has(key(c)));
    pick ??= cands.find((c) => Number(c.rating) >= LAST_RESORT_RATING && Number(c.rating) < minRating && !onScreen.has(key(c)));
    if (pick) {
      used.set(itemId, key(pick));
      onScreen.add(key(pick));
    }
  }

  const describe = (itemId: string, c: any): FootageCandidate => {
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
    return {
      id: String(c.id), rating: Number(c.rating), desc: String(c.desc ?? ""), source: String(c.source), link, thumb,
      chosen: choices[itemId] ? key(choices[itemId]) === key(c) : false,
      used: used.get(itemId) === key(c),
    };
  };

  const rows: FootageRow[] = Object.entries<any>(picks.items ?? {}).map(([itemId, entry]) => {
    const all: any[] = entry.candidates ?? [];
    // the best few, plus the one in use and the one chosen wherever they rank
    const shown = all.filter((c, k) => k < perShot || used.get(itemId) === key(c) ||
      (choices[itemId] && key(choices[itemId]) === key(c)));
    const item = byItem.get(itemId) ?? {};
    const siblings = perBeat.get(String(entry.beat_id ?? "")) ?? [itemId];
    return {
      item_id: itemId,
      beat_id: entry.beat_id ?? null,
      narration: narration.get(String(entry.beat_id)) ?? "",
      hook: Boolean(item.hook),
      start_s: Number(item.start_s ?? 0),
      end_s: Number(item.end_s ?? 0),
      shot: siblings.indexOf(itemId) + 1,
      shots_in_beat: siblings.length,
      covered: all.some((c) => Number(c.rating) >= minRating),
      candidates: shown.map((c) => describe(itemId, c)),
    };
  });
  const order = new Map(visual.map((v, k) => [String(v.id), k]));
  rows.sort((a, b) => (order.get(a.item_id) ?? 1e9) - (order.get(b.item_id) ?? 1e9));

  const sheetsDir = join(folder, "sheets");
  const sheets = existsSync(sheetsDir)
    ? readdirSync(sheetsDir).filter((f) => f.endsWith(".jpg")).sort().map((f) => fileUrl(videoId, `sheets/${f}`))
    : [];
  return { rows, sheets, unjudged: picks.unjudged ?? [], min_rating: minRating, resolved };
}
