#!/usr/bin/env node
/**
 * Batch sibling of preview-overlay.mjs: render MANY catalog overlays in ONE
 * Remotion bundle, then cut a still out of each one's span.
 *
 * The single-overlay script re-bundles per component, which is most of its
 * wall-clock. Converting 26 components and eyeballing each under two themes is
 * 52 bundles; this is 2. Everything else — the synthetic background, the plan
 * shape, the theme resolution — is identical, so a frame from here and a frame
 * from preview-overlay.mjs are comparable.
 *
 * Usage:
 *   node scripts/preview-batch.mjs --theme <name> --props <file.json> Comp1 Comp2 ...
 *   node scripts/preview-batch.mjs --theme <name> --all
 *   node scripts/preview-batch.mjs --theme <name> --bg frame.jpg --all
 *
 * Stills land in engine/fixtures/preview/<theme>/<Component>.png.
 */
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const engineRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const theme = flag("theme", "standard");
const hold = Number(flag("hold", "4"));
const at = Number(flag("at", "0.7"));
const propsFile = flag("props", join(engineRoot, "src/catalog/sample-props.json"));
// A real frame to stand the overlays on. The synthesized gradient answers "does
// this draw"; only a photograph answers "does this read over the shot" — and a
// scrim is invisible against a flat dark backdrop, which is the one case it is
// there for.
const bgFile = flag("bg", null);

const sample = JSON.parse(readFileSync(propsFile, "utf8")).props;
const named = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
const components = argv.includes("--all") ? Object.keys(sample).sort() : named;
if (components.length === 0) {
  console.error("usage: preview-batch.mjs --theme <name> [--hold s] Comp1 Comp2 ... | --all");
  process.exit(1);
}
const missing = components.filter((c) => !sample[c]);
if (missing.length) {
  console.error(`no sample props for: ${missing.join(", ")}`);
  process.exit(1);
}

const ff = (a, ctx) => {
  const r = spawnSync("ffmpeg", ["-y", "-v", "error", ...a], { encoding: "utf8" });
  if (r.status !== 0) {
    console.error(`ffmpeg (${ctx}) failed: ${r.stderr || r.error?.message}`);
    process.exit(1);
  }
};

const total = components.length * hold;
const work = mkdtempSync(join(tmpdir(), "overlay-batch-"));
mkdirSync(join(work, "clips"));
try {
  // Same seeded gradient as preview-overlay.mjs: an unseeded one differs on
  // every run, which makes any before/after comparison meaningless.
  if (bgFile) {
    ff(["-i", resolve(bgFile), "-vf", "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720", "-frames:v", "1", join(work, "clips/bg.png")], "bg");
  } else {
    ff(["-f", "lavfi", "-i", "gradients=size=1280x720:x0=0:y0=0:x1=1280:y1=720:c0=0x0d1220:c1=0x243350:seed=7", "-frames:v", "1", join(work, "clips/bg.png")], "bg");
  }
  ff(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", String(total), "-c:a", "libmp3lame", "-q:a", "9", join(work, "audio.mp3")], "audio");

  const plan = {
    version: "1.0",
    video_id: "overlay_batch",
    fps: 30,
    resolution: { width: 1280, height: 720 },
    tracks: {
      visual: [{ id: "v1", start_s: 0, end_s: total, media_type: "image", asset: { source: "manual", path: "clips/bg.png" } }],
      overlays: components.map((component, i) => ({
        id: `o${i}`,
        kind: "component",
        component,
        props: sample[component],
        start_s: i * hold + 0.2,
        end_s: (i + 1) * hold - 0.2,
      })),
      captions: { enabled: false, items: [] },
      audio: { voiceover: { path: "audio.mp3", start_s: 0, duration_s: total, volume: 1 } },
    },
  };
  writeFileSync(join(work, "edit_plan.json"), JSON.stringify(plan, null, 2));
  writeFileSync(join(work, "cfg.json"), JSON.stringify({ channel_id: "PREVIEW", name: "Preview", theme, editing: { captions: false } }, null, 2));

  console.log(`rendering ${components.length} overlays (${total}s, theme=${theme})...`);
  const render = spawnSync(
    process.execPath,
    ["--experimental-strip-types", join(engineRoot, "src", "cli.ts"), "render", "--video-dir", work, "--renderer", "remotion", "--outputs", "mp4"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 900_000 },
  );
  if (render.status !== 0) {
    console.error(render.stdout || "");
    console.error(render.stderr || "");
    process.exit(1);
  }

  const outDir = join(engineRoot, "fixtures", "preview", theme);
  mkdirSync(outDir, { recursive: true });
  copyFileSync(join(work, "final.mp4"), join(outDir, "_batch.mp4"));
  components.forEach((component, i) => {
    const t = i * hold + hold * at;
    ff(["-ss", String(t), "-i", join(outDir, "_batch.mp4"), "-frames:v", "1", join(outDir, `${component}.png`)], component);
  });
  console.log(`\n✓ ${components.length} stills -> ${outDir}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
