import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EditPlan } from "@lusora/contracts";
import { countFrames, fileSpans, splice, transitionPad } from "../src/patch.ts";

function plan(visual: Array<Record<string, unknown>>): EditPlan {
  return { tracks: { visual, overlays: [], audio: { voiceover: { path: "audio.mp3", duration_s: 12 } } } } as unknown as EditPlan;
}

const THREE = plan([
  { id: "v1", start_s: 0, end_s: 4 },
  { id: "v2", start_s: 4, end_s: 8, transition_out: { type: "crossfade", duration_s: 0.5 } },
  { id: "v3", start_s: 8, end_s: 12, transition_out: { type: "crossfade", duration_s: 2 } },
]);

// ---------------- span math ----------------

test("a span snaps outward to whole frames", () => {
  // 1.01 s -> frame 30.3 floors to 30; 1.99 s -> 59.7 ceils to 60
  assert.deepEqual(fileSpans([[1.01, 1.99]], plan([{ id: "v1", start_s: 0, end_s: 4 }]), 30, 0, 360), [{ first: 30, end: 60 }]);
  // already on boundaries: no extra frame from float noise
  assert.deepEqual(fileSpans([[1, 2]], plan([{ id: "v1", start_s: 0, end_s: 4 }]), 30, 0, 360), [{ first: 30, end: 60 }]);
});

test("a span is padded by the transitions at the junctions it touches", () => {
  assert.equal(transitionPad(THREE, 1, 2), 0, "v1 has no transition");
  assert.equal(transitionPad(THREE, 5, 7), 0.5, "v2's crossfade into v3");
  assert.equal(transitionPad(THREE, 9, 10), 0, "the last item's transition_out has no junction");
  // v2 [4, 8] touches v1 (a cut) and v2's own 0.5 s crossfade
  assert.deepEqual(fileSpans([[4, 8]], THREE, 30, 0, 360), [{ first: 105, end: 255 }]);
});

test("an absent transition duration is the renderer's default", () => {
  const p = plan([{ id: "a", start_s: 0, end_s: 4, transition_out: { type: "whip" } }, { id: "b", start_s: 4, end_s: 8 }]);
  assert.equal(transitionPad(p, 3, 5), 0.5);
});

test("overlapping or touching spans merge", () => {
  const p = plan([{ id: "v1", start_s: 0, end_s: 12 }]);
  assert.deepEqual(fileSpans([[5, 6], [1, 2], [2, 3], [5.5, 7]], p, 30, 0, 360), [
    { first: 30, end: 90 },
    { first: 150, end: 210 },
  ]);
});

test("a window shifts spans into the file's numbering and drops what falls outside", () => {
  const p = plan([{ id: "v1", start_s: 0, end_s: 120 }]);
  // window 10-40 s: the file's frame 0 is plan frame 300, and it is 900 frames long
  assert.deepEqual(fileSpans([[12, 13]], p, 30, 300, 900), [{ first: 60, end: 90 }]);
  assert.deepEqual(fileSpans([[2, 5]], p, 30, 300, 900), [], "before the window");
  assert.deepEqual(fileSpans([[45, 50]], p, 30, 300, 900), [], "after the window");
  assert.deepEqual(fileSpans([[8, 11], [39, 44]], p, 30, 300, 900), [
    { first: 0, end: 30 },
    { first: 870, end: 900 },
  ], "straddling spans are clamped to the window");
});

// ---------------- the splice ----------------

function ff(args: string[]) {
  execFileSync("ffmpeg", ["-y", "-v", "error", ...args]);
}

/** Per-frame PSNR of `a[aFirst..aFirst+n)` against `b[bFirst..bFirst+n)`, on
 *  a grey version (the splice re-encodes once, so bytes never match). */
function psnr(a: string, aFirst: number, b: string, bFirst: number, n: number): number[] {
  const grey = "format=gray,setsar=1";
  const p = spawnSync("ffmpeg", [
    "-v", "error", "-i", a, "-i", b, "-lavfi",
    `[0:v]trim=start_frame=${aFirst}:end_frame=${aFirst + n},setpts=PTS-STARTPTS,${grey}[x];` +
      `[1:v]trim=start_frame=${bFirst}:end_frame=${bFirst + n},setpts=PTS-STARTPTS,${grey}[y];` +
      `[x][y]psnr=stats_file=-`,
    "-f", "null", "-",
  ], { encoding: "utf8" });
  const values = [...(p.stdout ?? "").matchAll(/psnr_avg:(inf|[\d.]+)/g)].map((m) => (m[1] === "inf" ? 99 : Number(m[1])));
  assert.equal(values.length, n, `psnr gave ${values.length} frames, wanted ${n}: ${p.stderr}`);
  return values;
}

test("a 20-frame patch lands on exactly frames 30-49 of a 90-frame video", () => {
  const dir = mkdtempSync(join(tmpdir(), "patch-"));
  try {
    const original = join(dir, "original.mp4");
    const red = join(dir, "red.mp4");
    const out = join(dir, "out.mp4");
    ff(["-f", "lavfi", "-i", "testsrc=size=320x180:rate=30", "-f", "lavfi", "-i", "sine=frequency=440",
        "-frames:v", "90", "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", original]);
    ff(["-f", "lavfi", "-i", "color=c=red:size=320x180:rate=30", "-frames:v", "20",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", red]);
    assert.equal(countFrames(original), 90);

    const frames = splice(original, [{ first: 30, end: 50, file: red }], out, "keep");
    assert.equal(frames, 90);
    assert.equal(countFrames(out), 90);

    const before = psnr(out, 0, original, 0, 30);
    const middle = psnr(out, 30, red, 0, 20);
    const after = psnr(out, 50, original, 50, 40);
    assert.ok(Math.min(...before) > 40, `frames 0-29 match the original (worst ${Math.min(...before)} dB)`);
    assert.ok(Math.min(...middle) > 40, `frames 30-49 are the patch (worst ${Math.min(...middle)} dB)`);
    assert.ok(Math.min(...after) > 40, `frames 50-89 match the original (worst ${Math.min(...after)} dB)`);

    // the audio was copied through untouched
    const a = spawnSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_name", "-of", "csv=p=0", out], { encoding: "utf8" });
    assert.equal(a.stdout.trim(), "aac");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the splice is frame-exact at both edges, not one frame early or late", () => {
  // Every frame of this original is its own flat grey (level 40+3N, inside
  // video range and never wrapping), so a splice one frame off compares frame N with N±1 — 3 levels apart, a
  // PSNR drop no re-encode can hide.
  const dir = mkdtempSync(join(tmpdir(), "patch-"));
  try {
    const original = join(dir, "ramp.mp4");
    const red = join(dir, "red.mp4");
    const out = join(dir, "out.mp4");
    ff(["-f", "lavfi", "-i", "nullsrc=s=160x90:r=30,geq=lum='40+3*N':cb=128:cr=128", "-frames:v", "60",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", original]);
    ff(["-f", "lavfi", "-i", "color=c=red:size=160x90:rate=30", "-frames:v", "12",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", red]);
    splice(original, [{ first: 20, end: 32, file: red }], out, "keep");
    for (const edge of [19, 32]) {
      const [same] = psnr(out, edge, original, edge, 1);
      const [early] = psnr(out, edge, original, edge - 1, 1);
      const [late] = psnr(out, edge, original, edge + 1, 1);
      assert.ok(same! > 45 && same! > early! + 10 && same! > late! + 10,
        `frame ${edge} is the original's frame ${edge} (${same} dB; ${edge - 1}: ${early}, ${edge + 1}: ${late})`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a patch of the wrong length is refused before anything is written", () => {
  const dir = mkdtempSync(join(tmpdir(), "patch-"));
  try {
    const original = join(dir, "original.mp4");
    const red = join(dir, "red.mp4");
    ff(["-f", "lavfi", "-i", "testsrc=size=160x90:rate=30", "-frames:v", "60", "-c:v", "libx264", "-pix_fmt", "yuv420p", original]);
    ff(["-f", "lavfi", "-i", "color=c=red:size=160x90:rate=30", "-frames:v", "7", "-c:v", "libx264", "-pix_fmt", "yuv420p", red]);
    assert.throws(() => splice(original, [{ first: 10, end: 20, file: red }], join(dir, "out.mp4"), "keep"), /has 7 frames, expected 10/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("patches at the very start and the very end splice too", () => {
  const dir = mkdtempSync(join(tmpdir(), "patch-"));
  try {
    const original = join(dir, "original.mp4");
    const head = join(dir, "head.mp4");
    const tail = join(dir, "tail.mp4");
    const out = join(dir, "out.mp4");
    ff(["-f", "lavfi", "-i", "testsrc=size=160x90:rate=30", "-frames:v", "60", "-c:v", "libx264", "-pix_fmt", "yuv420p", original]);
    ff(["-f", "lavfi", "-i", "color=c=blue:size=160x90:rate=30", "-frames:v", "10", "-c:v", "libx264", "-pix_fmt", "yuv420p", head]);
    ff(["-f", "lavfi", "-i", "color=c=green:size=160x90:rate=30", "-frames:v", "5", "-c:v", "libx264", "-pix_fmt", "yuv420p", tail]);
    assert.equal(splice(original, [{ first: 0, end: 10, file: head }, { first: 55, end: 60, file: tail }], out, "keep"), 60);
    assert.ok(Math.min(...psnr(out, 0, head, 0, 10)) > 40);
    assert.ok(Math.min(...psnr(out, 10, original, 10, 45)) > 40);
    assert.ok(Math.min(...psnr(out, 55, tail, 0, 5)) > 40);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
