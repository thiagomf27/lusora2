/**
 * End-to-end renderer contract test (renderer-interface.md): build the
 * synthetic fixture video-dir, run the REAL CLI on a copy, and verify the
 * deposited final.mp4 like the worker's render stage does — duration within
 * 1.0s of the voiceover, correct resolution and fps, an audio stream, and
 * atomic output (no temp file left behind).
 *
 * The fixture plan contains a speed=1.5 video item and a crossfade handle, so
 * this exercises the ported timeline/BaseTrack path (playbackRate + freeze
 * math + @remotion/transitions) — not just a static composition.
 *
 * Files-only boundary: the render uses a preinstalled browser (resolved
 * below) via REMOTION_BROWSER_EXECUTABLE so it never downloads one. If no
 * browser and no ffmpeg is available the render assertions skip rather than
 * fail spuriously; the ffmpeg-capability assertion always runs.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = resolve(here, "..");
const cli = join(engineRoot, "src", "cli.ts");
const fixtureDir = join(engineRoot, "fixtures", "video-dir");

function haveFfmpeg(): boolean {
  return spawnSync("ffmpeg", ["-version"]).status === 0;
}

/** A preinstalled browser executable Remotion can use without downloading one. */
function resolveBrowser(): string | null {
  const candidates = [
    process.env.REMOTION_BROWSER_EXECUTABLE,
    join(engineRoot, "..", "node_modules", ".remotion", "chrome-headless-shell", "linux64", "chrome-headless-shell-linux64", "chrome-headless-shell"),
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => existsSync(p)) ?? null;
}

function ffprobe(args: string[]): string {
  const proc = spawnSync("ffprobe", ["-v", "error", ...args], { encoding: "utf8" });
  assert.equal(proc.status, 0, `ffprobe failed: ${proc.stderr}`);
  return proc.stdout.trim();
}

function ensureFixture(): void {
  if (!existsSync(join(fixtureDir, "audio.mp3"))) {
    const build = spawnSync("bash", [join(engineRoot, "scripts", "make-fixture.sh")], { encoding: "utf8" });
    assert.equal(build.status, 0, `make-fixture failed: ${build.stderr}`);
  }
}

function runCli(dir: string, renderer: string, browser: string | null) {
  const env = { ...process.env };
  if (browser) env.REMOTION_BROWSER_EXECUTABLE = browser;
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", cli, "render", "--video-dir", dir, "--renderer", renderer, "--outputs", "mp4"],
    { encoding: "utf8", timeout: 280_000, env },
  );
}

test("remotion renderer: fixture (with a speed!=1 item) renders to spec", { timeout: 300_000 }, (t) => {
  const browser = resolveBrowser();
  if (!haveFfmpeg() || !browser) {
    t.skip(`no ${!browser ? "browser" : "ffmpeg"} available for the render path`);
    return;
  }
  ensureFixture();
  const dir = mkdtempSync(join(tmpdir(), "lusora-contract-"));
  try {
    cpSync(fixtureDir, dir, { recursive: true });
    rmSync(join(dir, "final.mp4"), { force: true }); // drop any stale render from the source dir

    const result = runCli(dir, "remotion", browser);
    assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);
    assert.match(result.stdout, /"renderer":"remotion"/);

    const final = join(dir, "final.mp4");
    assert.ok(existsSync(final), "final.mp4 written");
    assert.ok(!existsSync(join(dir, "final.tmp.mp4")), "no temp file left behind (atomic)");

    const voiceover = Number(ffprobe(["-show_entries", "format=duration", "-of", "csv=p=0", join(dir, "audio.mp3")]));
    const rendered = Number(ffprobe(["-show_entries", "format=duration", "-of", "csv=p=0", final]));
    assert.ok(Math.abs(rendered - voiceover) <= 1.0, `rendered ${rendered}s ≈ voiceover ${voiceover}s`);

    const [w, h, rate] = ffprobe([
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height,r_frame_rate",
      "-of", "csv=p=0", final,
    ]).split(",");
    assert.equal(w, "1280");
    assert.equal(h, "720");
    assert.equal(rate, "30/1");

    const audio = ffprobe(["-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", final]);
    assert.match(audio, /audio/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: --renderer ffmpeg is rejected on a plan that needs remotion", () => {
  // The fixture uses catalog overlays and a speed!=1 item, so pinning ffmpeg
  // must fail with the offending items (capability enforcement, not a stub).
  ensureFixture();
  const dir = mkdtempSync(join(tmpdir(), "lusora-ffmpeg-pin-"));
  try {
    cpSync(fixtureDir, dir, { recursive: true });
    rmSync(join(dir, "final.mp4"), { force: true }); // drop any stale render from the source dir
    const result = runCli(dir, "ffmpeg", null);
    assert.notEqual(result.status, 0, "ffmpeg pin must exit non-zero");
    assert.match(result.stderr, /ffmpeg/i);
    assert.match(result.stderr, /speed|ChapterTitle/, "names an offending item");
    assert.ok(!existsSync(join(dir, "final.mp4")), "no final.mp4 on capability failure");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
