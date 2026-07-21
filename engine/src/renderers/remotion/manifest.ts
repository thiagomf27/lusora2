/**
 * Node-side asset manifest: for each tracks.visual item, decide video vs
 * image vs color and probe video durations (needed for the handle /
 * freeze-frame math in timeline.ts). Ported from video-engine's manifest.ts,
 * adapted to edit_plan v1.0 (media_type + asset.path).
 *
 * Probing tries @remotion/media-parser first (fast, pure file reads), then
 * falls back to @remotion/renderer's getVideoMetadata (the compositor that
 * decodes the file at render time — some valid stock mp4s defeat the fast
 * duration path). No network, no system ffprobe.
 */

import { join } from "node:path";
import type { EditPlan, VisualItem } from "@lusora/contracts";
import type { VisualAsset } from "./timeline.ts";

const VIDEO_EXTENSIONS = ["mp4", "mov", "webm", "mkv", "m4v"];
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"];

export function assetKind(item: VisualItem, index: number): "video" | "image" | "color" {
  if (item.media_type === "color") return "color";
  if (item.media_type === "image") return "image";
  if (item.media_type === "video" || item.media_type === "avatar") return "video";
  // media_type is required in v1.0, but stay defensive: infer from the extension.
  const extension = (item.asset?.path ?? "").split(".").pop()?.toLowerCase() ?? "";
  if (VIDEO_EXTENSIONS.includes(extension)) return "video";
  if (IMAGE_EXTENSIONS.includes(extension)) return "image";
  throw new Error(
    `visual[${index}]: cannot tell whether '${item.asset?.path}' is a video or an image — ` +
      "set media_type in the plan or use a standard file extension",
  );
}

async function probeDuration(path: string): Promise<number | null> {
  try {
    const { parseMedia } = await import("@remotion/media-parser");
    const { nodeReader } = await import("@remotion/media-parser/node");
    const { durationInSeconds } = await parseMedia({
      src: path,
      reader: nodeReader,
      fields: { durationInSeconds: true },
      acknowledgeRemotionLicense: true,
    });
    if (durationInSeconds !== null) return durationInSeconds;
  } catch {
    // fall through to the compositor probe
  }
  try {
    const { getVideoMetadata } = await import("@remotion/renderer");
    const { durationInSeconds } = await getVideoMetadata(path);
    return Number.isFinite(durationInSeconds) ? durationInSeconds : null;
  } catch {
    return null;
  }
}

export async function buildAssetManifest(videoDir: string, plan: EditPlan): Promise<VisualAsset[]> {
  return Promise.all(
    plan.tracks.visual.map(async (item, i): Promise<VisualAsset> => {
      const kind = assetKind(item, i);
      if (kind === "color") {
        return { kind, src: null, durationInSeconds: null };
      }
      const src = item.asset?.path ?? null;
      if (!src) {
        throw new Error(`visual[${i}]: asset.path is not set — run resolve_assets first`);
      }
      if (kind === "image") {
        return { kind, src, durationInSeconds: null };
      }
      const durationInSeconds = await probeDuration(join(videoDir, src));
      if (durationInSeconds === null) {
        throw new Error(
          `visual[${i}]: could not read '${src}' as a video (no readable duration) — ` +
            "re-download or replace the asset, or set media_type to 'image' if it is one",
        );
      }
      return { kind, src, durationInSeconds };
    }),
  );
}
