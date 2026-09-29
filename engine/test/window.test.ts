import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { frameRange, parseWindow, trimToWindow } from "../src/window.ts";

test("a window parses to plan seconds", () => {
  assert.deepEqual(parseWindow("0-75", 175), { start_s: 0, end_s: 75 });
  assert.deepEqual(parseWindow("12.5-40", 175), { start_s: 12.5, end_s: 40 });
});

test("a window past the end is clamped to the plan, not rendered as black", () => {
  assert.deepEqual(parseWindow("60-500", 175.4), { start_s: 60, end_s: 175.4 });
});

test("an unusable window is refused with the reason", () => {
  assert.throws(() => parseWindow("75", 175), /<start>-<end>/);
  assert.throws(() => parseWindow("40-40", 175), /empty/);
  assert.throws(() => parseWindow("200-260", 175), /only 175\.00s long/);
});

test("a window becomes an inclusive frame range", () => {
  assert.deepEqual(frameRange({ start_s: 0, end_s: 75 }, 30), [0, 2249]);
  assert.deepEqual(frameRange({ start_s: 10, end_s: 10.02 }, 30), [300, 300]);
});

test("trimToWindow cuts a file to the window's length", () => {
  const dir = mkdtempSync(join(tmpdir(), "window-"));
  try {
    const file = join(dir, "final.mp4");
    execFileSync("ffmpeg", [
      "-y", "-v", "error",
      "-f", "lavfi", "-i", "testsrc=size=160x90:rate=30:duration=3",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
      "-c:v", "libx264", "-c:a", "aac", "-shortest", file,
    ]);
    trimToWindow(file, { start_s: 1, end_s: 2.5 });
    const duration = Number(
      String(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file])).trim()
    );
    assert.ok(Math.abs(duration - 1.5) < 0.1, `trimmed to ${duration}s`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
