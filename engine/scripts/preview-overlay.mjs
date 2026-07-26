#!/usr/bin/env node
/**
 * Preview a single catalog overlay in the REAL Remotion engine — no platform,
 * worker or DB. Synthesizes a minimal one-overlay plan over a neutral
 * background, renders it via the engine CLI, and drops an mp4 + a still frame
 * into engine/fixtures/preview/ so you (or Claude) can eyeball the component.
 *
 * Usage:
 *   node scripts/preview-overlay.mjs <Component> '<propsJSON>' [--theme <name>] [--dur <s>] [--at <0..1>]
 * Example:
 *   node scripts/preview-overlay.mjs AnimatedCounter '{"value":42,"label":"share of imports","suffix":"%"}'
 *
 * Needs ffmpeg on PATH and a browser (set REMOTION_BROWSER_EXECUTABLE to skip
 * the one-time Chrome download).
 */
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const engineRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const component = args[0];
if (!component || component.startsWith("--")) {
  console.error("usage: preview-overlay.mjs <Component> '<propsJSON>' [--theme n] [--dur s] [--at 0..1] [--template kind]");
  process.exit(1);
}
const propsJson = args[1] && !args[1].startsWith("--") ? args[1] : "{}";
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const theme = flag("theme", "history-dark");
const dur = Number(flag("dur", "5"));
const at = Number(flag("at", "0.66"));
// A template-backed catalog entry has no React component; the plan carries the
// kind and TemplateOverlay draws it.
const template = flag("template", null);

let props;
try {
  props = JSON.parse(propsJson);
} catch (e) {
  console.error(`invalid props JSON: ${e.message}`);
  process.exit(1);
}

const ff = (a, ctx) => {
  const r = spawnSync("ffmpeg", ["-y", "-v", "error", ...a], { encoding: "utf8" });
  if (r.status !== 0) {
    console.error(`ffmpeg (${ctx}) failed: ${r.stderr || r.error?.message}`);
    process.exit(1);
  }
};

const work = mkdtempSync(join(tmpdir(), "overlay-preview-"));
mkdirSync(join(work, "clips"));
try {
  ff(["-f", "lavfi", "-i", "gradients=size=1280x720:x0=0:y0=0:x1=1280:y1=720:c0=0x0d1220:c1=0x243350", "-frames:v", "1", join(work, "clips/bg.png")], "bg");
  ff(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", String(dur), "-c:a", "libmp3lame", "-q:a", "9", join(work, "audio.mp3")], "audio");

  const plan = {
    version: "1.0",
    video_id: "overlay_preview",
    fps: 30,
    resolution: { width: 1280, height: 720 },
    tracks: {
      visual: [
        { id: "v1", start_s: 0, end_s: dur, media_type: "image", asset: { source: "manual", path: "clips/bg.png" } },
      ],
      overlays: [
        {
          id: "o1",
          kind: "component",
          component,
          props,
          start_s: 0.3,
          end_s: Math.max(dur - 0.3, 0.6),
          // template-backed entries carry the layout in the plan, exactly as
          // the compiler emits it (see --template)
          ...(template ? { template } : {}),
        },
      ],
      captions: { enabled: false, items: [] },
      audio: { voiceover: { path: "audio.mp3", start_s: 0, duration_s: dur, volume: 1 } },
    },
  };
  writeFileSync(join(work, "edit_plan.json"), JSON.stringify(plan, null, 2));
  writeFileSync(join(work, "cfg.json"), JSON.stringify({ channel_id: "PREVIEW", name: "Preview", theme, editing: { captions: false } }, null, 2));

  console.log(`rendering ${component} (${dur}s, theme=${theme}${template ? `, template=${template}` : ""})...`);
  const render = spawnSync(
    process.execPath,
    ["--experimental-strip-types", join(engineRoot, "src", "cli.ts"), "render", "--video-dir", work, "--renderer", "remotion", "--outputs", "mp4"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 240_000 },
  );
  if (render.status !== 0) {
    console.error(render.stdout || "");
    console.error(render.stderr || "");
    console.error(`render failed for ${component}`);
    process.exit(1);
  }

  const outDir = join(engineRoot, "fixtures", "preview");
  mkdirSync(outDir, { recursive: true });
  const mp4 = join(outDir, `${component}.mp4`);
  const png = join(outDir, `${component}.png`);
  copyFileSync(join(work, "final.mp4"), mp4);
  ff(["-ss", String(at * dur), "-i", mp4, "-frames:v", "1", png], "frame");

  console.log(`\n✓ ${component}`);
  console.log(`  video: ${mp4}`);
  console.log(`  frame: ${png}  (at ${(at * dur).toFixed(1)}s)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
