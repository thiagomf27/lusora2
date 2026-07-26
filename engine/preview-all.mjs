/**
 * Batch-preview every catalog component: bundle the engine root ONCE, then
 * renderStill one frame per component with representative props.
 * Usage: node preview-all.mjs [outDir]
 */
import { bundle } from "@remotion/bundler";
import { selectComposition, renderStill } from "@remotion/renderer";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ENGINE = "/home/thiago/lusora/engine";
const outDir = process.argv[2] || "/tmp/preview-out";
const DUR = 5;
const FPS = 30;
const W = 1280;
const H = 720;
const AT = 0.7; // fraction of the overlay span to sample

// Representative props per component, shared with the platform Overlays screen.
const PROPS = JSON.parse(readFileSync(join(ENGINE, "src/catalog/sample-props.json"), "utf8")).props;

const theme = JSON.parse(readFileSync("/home/thiago/lusora/contracts/themes/history-dark.json", "utf8"));
const catalog = JSON.parse(readFileSync("/home/thiago/lusora/contracts/catalog.json", "utf8")).components.map((c) => c.name);

const work = mkdtempSync(join(tmpdir(), "preview-all-"));
mkdirSync(join(work, "clips"), { recursive: true });
mkdirSync(outDir, { recursive: true });

const ff = (args) => {
  const r = spawnSync("ffmpeg", ["-y", "-v", "error", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
};
ff(["-f", "lavfi", "-i", `gradients=size=${W}x${H}:x0=0:y0=0:x1=${W}:y1=${H}:c0=0x0d1220:c1=0x243350`, "-frames:v", "1", join(work, "clips/bg.png")]);
ff(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", String(DUR), "-c:a", "libmp3lame", "-q:a", "9", join(work, "audio.mp3")]);

const planFor = (component) => ({
  version: "1.0",
  video_id: "preview",
  fps: FPS,
  resolution: { width: W, height: H },
  tracks: {
    visual: [{ id: "v1", start_s: 0, end_s: DUR, media_type: "image", asset: { source: "manual", path: "clips/bg.png" } }],
    overlays: [{ id: "o1", kind: "component", component, props: PROPS[component], start_s: 0.3, end_s: DUR - 0.3 }],
    captions: { enabled: false, items: [] },
    audio: { voiceover: { path: "audio.mp3", start_s: 0, duration_s: DUR, volume: 1 } },
  },
});

const serveUrl = await bundle({ entryPoint: join(ENGINE, "src/renderers/remotion/root.tsx"), publicDir: work });
const browserExecutable = "/usr/bin/google-chrome";
const chromiumOptions = { gl: "swiftshader" };

const results = [];
for (const name of catalog) {
  if (!PROPS[name]) { results.push([name, "NO PROPS DEFINED"]); continue; }
  const plan = planFor(name);
  const inputProps = { plan, theme, assets: [{ kind: "image", src: "clips/bg.png", durationInSeconds: null }] };
  try {
    const composition = await selectComposition({ serveUrl, id: "video", inputProps, browserExecutable, chromiumOptions });
    await renderStill({
      composition,
      serveUrl,
      output: join(outDir, `${name}.png`),
      inputProps,
      browserExecutable,
      chromiumOptions,
      frame: Math.round((0.3 + (DUR - 0.6) * AT) * FPS),
      timeoutInMilliseconds: 60000,
    });
    results.push([name, "ok"]);
  } catch (e) {
    results.push([name, `FAILED: ${e.message.split("\n")[0].slice(0, 110)}`]);
  }
  console.log(`${results[results.length - 1][1] === "ok" ? "✓" : "✗"} ${name}${results[results.length - 1][1] === "ok" ? "" : " — " + results[results.length - 1][1]}`);
}
rmSync(work, { recursive: true, force: true });
const failed = results.filter(([, r]) => r !== "ok");
console.log(`\n${results.length - failed.length}/${results.length} rendered`);
if (failed.length) { console.log("FAILURES:"); failed.forEach(([n, r]) => console.log(` ${n}: ${r}`)); }
