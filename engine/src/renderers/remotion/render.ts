/**
 * Remotion renderer: bundle the composition with the video folder as the
 * public dir (staticFile resolves plan asset paths), then render h264.
 */
import { existsSync, readFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { EditPlan, Theme } from "@lusora/contracts";
import { DEFAULT_THEME } from "../../themes/runtime.ts";
import { buildAssetManifest } from "./manifest.ts";

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
  // Probe visual assets node-side (durations for the freeze/handle math);
  // passed to the composition so the browser bundle does no file probing.
  const assets = await buildAssetManifest(videoDir, plan);
  const entryPoint = join(dirname(fileURLToPath(import.meta.url)), "root.tsx");
  const inputProps = { plan, theme, assets } as unknown as Record<string, unknown>;

  const serveUrl = await bundle({
    entryPoint,
    publicDir: videoDir, // staticFile("clips/…"), staticFile("audio.mp3")
  });

  // Files-only boundary: point at a preinstalled browser so the render never
  // reaches out to download one. Unset falls back to Remotion's managed browser.
  const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || null;

  // GPU-less machines (this laptop, any VPS, CI) crash the Chrome renderer
  // process on the default ANGLE/SwANGLE backend: the page dies mid-handshake
  // and every render fails with a "waiting for root component" timeout that
  // names nothing. SwiftShader is pure software and always available; override
  // with REMOTION_GL on a box with a real GPU.
  const chromiumOptions = {
    gl: (process.env.REMOTION_GL || "swiftshader") as "swiftshader" | "swangle" | "angle" | "egl",
  };

  const composition = await selectComposition({
    serveUrl,
    id: "video",
    inputProps,
    browserExecutable,
    chromiumOptions,
  });

  const tmpOut = join(videoDir, "final.tmp.mp4");
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: tmpOut,
    inputProps,
    browserExecutable,
    chromiumOptions,
    // low-RAM machines: too many tabs + an unbounded OffthreadVideo frame
    // cache stall frame extraction until delayRender times out
    concurrency: Number(process.env.REMOTION_CONCURRENCY ?? 2),
    offthreadVideoCacheSizeInBytes: Number(
      process.env.REMOTION_OFFTHREADVIDEO_CACHE_BYTES ?? 512 * 1024 * 1024
    ),
    // large stock clips can take far longer than the 28s default to seek/decode
    timeoutInMilliseconds: 180000,
  });
  renameSync(tmpOut, join(videoDir, "final.mp4"));

  const vo = plan.tracks.audio.voiceover;
  const visualEnd = plan.tracks.visual.length
    ? plan.tracks.visual[plan.tracks.visual.length - 1].end_s
    : 0;
  return { duration_s: Math.max(visualEnd, (vo.start_s ?? 0) + vo.duration_s) };
}
