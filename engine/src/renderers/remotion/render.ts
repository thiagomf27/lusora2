/**
 * Remotion renderer: bundle the composition with the video folder as the
 * public dir (staticFile resolves plan asset paths), then render h264.
 */
import { existsSync, readFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { EditPlan, Theme } from "@lusora/contracts";
import { DEFAULT_THEME } from "../../themes/runtime.ts";

export interface RenderResult {
  duration_s: number;
}

export function loadTheme(videoDir: string): Theme {
  const cfgPath = join(videoDir, "cfg.json");
  if (existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
      if (cfg.theme_doc) return cfg.theme_doc as Theme;
      if (cfg.theme) {
        const themePath = join(
          dirname(fileURLToPath(import.meta.url)),
          "../../../../contracts/themes",
          `${cfg.theme}.json`
        );
        if (existsSync(themePath)) return JSON.parse(readFileSync(themePath, "utf8"));
      }
    } catch {
      // fall through to default
    }
  }
  return DEFAULT_THEME;
}

export async function renderRemotion(plan: EditPlan, videoDir: string): Promise<RenderResult> {
  const { bundle } = await import("@remotion/bundler");
  const { renderMedia, selectComposition } = await import("@remotion/renderer");

  const theme = loadTheme(videoDir);
  const entryPoint = join(dirname(fileURLToPath(import.meta.url)), "root.tsx");
  const inputProps = { plan, theme } as unknown as Record<string, unknown>;

  const serveUrl = await bundle({
    entryPoint,
    publicDir: videoDir, // staticFile("clips/…"), staticFile("audio.mp3")
  });

  const composition = await selectComposition({ serveUrl, id: "video", inputProps });

  const tmpOut = join(videoDir, "final.tmp.mp4");
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: tmpOut,
    inputProps,
    concurrency: null,
  });
  renameSync(tmpOut, join(videoDir, "final.mp4"));

  const vo = plan.tracks.audio.voiceover;
  const visualEnd = plan.tracks.visual.length
    ? plan.tracks.visual[plan.tracks.visual.length - 1].end_s
    : 0;
  return { duration_s: Math.max(visualEnd, (vo.start_s ?? 0) + vo.duration_s) };
}
