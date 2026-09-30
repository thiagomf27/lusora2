/**
 * Remotion renderer: bundle the composition with the video folder as the
 * public dir (staticFile resolves plan asset paths), then render h264.
 */
import { existsSync, readFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { EditPlan, Theme } from "@lusora/contracts";
import { DEFAULT_THEME } from "../../themes/runtime.ts";
import { normalizeLoudness } from "../loudness.ts";
import { buildAssetManifest } from "./manifest.ts";
import { frameRange, type RenderWindow } from "../../window.ts";

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

/** A bundled composition, ready to draw any frame range of the plan. */
export interface PreparedRemotion {
  serveUrl: string;
  composition: Awaited<ReturnType<typeof import("@remotion/renderer")["selectComposition"]>>;
  inputProps: Record<string, unknown>;
  browserExecutable: string | null;
  chromiumOptions: { gl: "swiftshader" | "swangle" | "angle" | "egl" };
}

/** Bundle once and select the composition; a patch draws several ranges from one bundle. */
export async function prepareRemotion(plan: EditPlan, videoDir: string): Promise<PreparedRemotion> {
  const { bundle } = await import("@remotion/bundler");
  const { selectComposition } = await import("@remotion/renderer");

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
  return { serveUrl, composition, inputProps, browserExecutable, chromiumOptions };
}

export interface DrawOptions {
  /** Inclusive plan frames; absent = the whole composition. */
  frameRange?: [number, number];
  /** Video only (a patch): the original's audio is kept, or remixed apart. */
  muted?: boolean;
  /** "h264" (default) draws picture and sound; "aac" draws the sound alone. */
  codec?: "h264" | "aac";
}

/** Draw one file from a prepared composition. */
export async function drawRemotion(
  prep: PreparedRemotion,
  outputLocation: string,
  opts: DrawOptions = {}
): Promise<void> {
  const { renderMedia } = await import("@remotion/renderer");
  await renderMedia({
    composition: prep.composition,
    serveUrl: prep.serveUrl,
    codec: opts.codec ?? "h264",
    outputLocation,
    inputProps: prep.inputProps,
    browserExecutable: prep.browserExecutable,
    chromiumOptions: prep.chromiumOptions,
    // low-RAM machines: too many tabs + an unbounded OffthreadVideo frame
    // cache stall frame extraction until delayRender times out
    concurrency: Number(process.env.REMOTION_CONCURRENCY ?? 2),
    offthreadVideoCacheSizeInBytes: Number(
      process.env.REMOTION_OFFTHREADVIDEO_CACHE_BYTES ?? 512 * 1024 * 1024
    ),
    // large stock clips can take far longer than the 28s default to seek/decode
    timeoutInMilliseconds: 180000,
    ...(opts.muted ? { muted: true } : {}),
    ...(opts.frameRange ? { frameRange: opts.frameRange } : {}),
  });
}

export async function renderRemotion(
  plan: EditPlan,
  videoDir: string,
  window?: RenderWindow
): Promise<RenderResult> {
  const prep = await prepareRemotion(plan, videoDir);
  const tmpOut = join(videoDir, "final.tmp.mp4");
  // a benchmark window draws only its own frames; the audio follows them
  await drawRemotion(prep, tmpOut, window ? { frameRange: frameRange(window, prep.composition.fps) } : {});
  // D48: Remotion mixes the audio itself, so the loudness pass is a separate
  // remux here rather than a filter in the mux chain. Runs on the tmp file so
  // final.mp4 still appears atomically.
  normalizeLoudness(tmpOut, plan.tracks.audio.master?.loudness ?? "single");
  renameSync(tmpOut, join(videoDir, "final.mp4"));

  if (window) return { duration_s: window.end_s - window.start_s };
  const vo = plan.tracks.audio.voiceover;
  const visualEnd = plan.tracks.visual.length
    ? plan.tracks.visual[plan.tracks.visual.length - 1].end_s
    : 0;
  return { duration_s: Math.max(visualEnd, (vo.start_s ?? 0) + vo.duration_s) };
}
