#!/usr/bin/env node
/**
 * End-to-end proof of the patch render (D120). Run by hand; it takes a few
 * minutes (three Remotion renders), so it is not in the unit suite.
 *
 *   node engine/scripts/patch-check.mjs
 *
 * A: a 6 s, 640x360 plan (three textured stills with crossfades between them,
 *    Ken Burns motion, one overlay across a junction) rendered whole.
 * B: the same plan with shot 2's image swapped, rendered whole.
 * C: A patched with shot 2's span.
 * Every frame of C must match B, and every frame outside the patched span
 * must match A (PSNR over 40 dB on luma). Prints the worst frame of each.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "src", "cli.ts");
process.env.REMOTION_BROWSER_EXECUTABLE ||= join(here, "../../node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell");

const ff = (args) => execFileSync("ffmpeg", ["-y", "-v", "error", ...args]);
const engine = (args) => {
  const t = Date.now();
  const p = spawnSync("node", ["--experimental-strip-types", cli, ...args], { encoding: "utf8" });
  if (p.status !== 0) throw new Error(`engine ${args[0]} failed: ${p.stderr.trim().slice(-600)}`);
  const line = p.stdout.trim().split("\n").pop();
  return { result: JSON.parse(line), seconds: (Date.now() - t) / 1000 };
};

function shot(id, start, end, path, transition) {
  return {
    id, beat_id: `b${id}`, locked: false, start_s: start, end_s: end, media_type: "image",
    asset: { source: "manual", id: null, license: "own", path },
    motion: { type: "ken_burns", direction: "in", pan: "center", strength: 0.2 },
    ...(transition ? { transition_out: { type: "crossfade", duration_s: 0.5 } } : {}),
  };
}

function makePlan(shot2) {
  return {
    version: "1.0", video_id: "patch_check", fps: 30, resolution: { width: 640, height: 360 },
    tracks: {
      visual: [shot("1", 0, 2, "clips/a.png", true), shot("2", 2, 4, shot2, true), shot("3", 4, 6, "clips/c.png", false)],
      overlays: [{ id: "o1", beat_id: "b1", locked: false, kind: "component", component: "KineticTitle",
                   props: { text: "Patch check", emphasis: "accent" }, start_s: 1.2, end_s: 3.2 }],
      captions: [],
      audio: { voiceover: { path: "audio.mp3", duration_s: 6, volume: 1 } },
    },
  };
}

function setup(dir, shot2) {
  mkdirSync(join(dir, "clips"), { recursive: true });
  ff(["-f", "lavfi", "-i", "smptehdbars=s=960x540", "-frames:v", "1", join(dir, "clips/a.png")]);
  ff(["-f", "lavfi", "-i", "testsrc2=s=960x540", "-frames:v", "1", join(dir, "clips/b.png")]);
  ff(["-f", "lavfi", "-i", "mandelbrot=s=960x540", "-frames:v", "1", join(dir, "clips/c.png")]);
  ff(["-f", "lavfi", "-i", "rgbtestsrc=s=960x540", "-frames:v", "1", join(dir, "clips/d.png")]);
  ff(["-f", "lavfi", "-i", "sine=frequency=330:duration=6", "-q:a", "4", join(dir, "audio.mp3")]);
  writeFileSync(join(dir, "edit_plan.json"), JSON.stringify(makePlan(shot2), null, 2));
  writeFileSync(join(dir, "cfg.json"), JSON.stringify({ renderer: "remotion" }));
}

/** Per-frame luma PSNR of a[aFirst..+n) against b[bFirst..+n). */
function psnr(a, aFirst, b, bFirst, n) {
  const g = "format=gray,setsar=1";
  const p = spawnSync("ffmpeg", ["-v", "error", "-i", a, "-i", b, "-lavfi",
    `[0:v]trim=start_frame=${aFirst}:end_frame=${aFirst + n},setpts=PTS-STARTPTS,${g}[x];` +
    `[1:v]trim=start_frame=${bFirst}:end_frame=${bFirst + n},setpts=PTS-STARTPTS,${g}[y];[x][y]psnr=stats_file=-`,
    "-f", "null", "-"], { encoding: "utf8" });
  const v = [...p.stdout.matchAll(/psnr_avg:(inf|[\d.]+)/g)].map((m) => (m[1] === "inf" ? 99 : Number(m[1])));
  if (v.length !== n) throw new Error(`psnr returned ${v.length} of ${n} frames: ${p.stderr}`);
  return v;
}

const worst = (v, from) => v.reduce((w, x, i) => (x < w.db ? { frame: from + i, db: x } : w), { frame: -1, db: Infinity });

const root = mkdtempSync(join(tmpdir(), "patch-check-"));
try {
  const A = join(root, "A"), B = join(root, "B"), C = join(root, "C");
  setup(A, "clips/b.png");
  setup(B, "clips/d.png");
  const a = engine(["render", "--video-dir", A, "--renderer", "remotion"]);
  const b = engine(["render", "--video-dir", B, "--renderer", "remotion"]);
  console.log(`A rendered whole in ${a.seconds.toFixed(1)} s; B in ${b.seconds.toFixed(1)} s`);

  cpSync(A, C, { recursive: true });
  cpSync(join(B, "edit_plan.json"), join(C, "edit_plan.json"));
  const c = engine(["patch", "--video-dir", C, "--spans", "2-4", "--renderer", "remotion"]);
  console.log(`C patched in ${c.seconds.toFixed(1)} s: ${JSON.stringify(c.result)}`);

  const total = c.result.frames;
  const [[ps, pe]] = c.result.patched;
  const first = Math.round(ps * 30), end = Math.round(pe * 30);
  const vsB = psnr(join(C, "final.mp4"), 0, join(B, "final.mp4"), 0, total);
  const outside = [
    ...psnr(join(C, "final.mp4"), 0, join(A, "final.mp4"), 0, first).map((db, i) => ({ frame: i, db })),
    ...psnr(join(C, "final.mp4"), end, join(A, "final.mp4"), end, total - end).map((db, i) => ({ frame: end + i, db })),
  ];
  const wB = worst(vsB, 0);
  const wA = outside.reduce((w, x) => (x.db < w.db ? x : w), { frame: -1, db: Infinity });
  console.log(`C vs B, all ${total} frames: worst frame ${wB.frame} at ${wB.db.toFixed(2)} dB`);
  console.log(`C vs A, the ${outside.length} frames outside [${first}, ${end}): worst frame ${wA.frame} at ${wA.db.toFixed(2)} dB`);
  // --audio remix: the whole mix drawn again and mastered like a full render
  const R = join(root, "R");
  cpSync(A, R, { recursive: true });
  cpSync(join(B, "edit_plan.json"), join(R, "edit_plan.json"));
  const r = engine(["patch", "--video-dir", R, "--spans", "2-4", "--audio", "remix", "--renderer", "remotion"]);
  const probe = (f) => JSON.parse(spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,duration",
    "-of", "json", f], { encoding: "utf8" }).stdout).streams;
  const streams = probe(join(R, "final.mp4"));
  const audio = streams.find((s) => s.codec_type === "audio");
  const remixOk = r.result.frames === total && audio && Math.abs(Number(audio.duration) - 6) < 0.1;
  console.log(`R patched with --audio remix in ${r.seconds.toFixed(1)} s: ${r.result.frames} frames, audio ${audio ? Number(audio.duration).toFixed(2) + " s" : "missing"}`);

  const ok = wB.db > 40 && wA.db > 40 && remixOk;
  console.log(ok ? "PASS" : "FAIL");
  process.exitCode = ok ? 0 : 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
