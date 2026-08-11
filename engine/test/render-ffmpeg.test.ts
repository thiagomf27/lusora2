/**
 * Renderer contract test (CI): a synthetic fixture rendered by the ffmpeg
 * path; ffprobe asserts duration/resolution/audio. (The Remotion path
 * joins this test in M6.)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { EditPlan } from "@lusora/contracts";
import { renderFfmpeg } from "../src/renderers/ffmpeg/render.ts";
import { routePlan } from "../src/router.ts";

function sh(cmd: string, args: string[]): string {
  const proc = spawnSync(cmd, args, { encoding: "utf8" });
  assert.equal(proc.status, 0, `${cmd} failed: ${proc.stderr}`);
  return proc.stdout;
}

test("ffmpeg renderer: fixture plan renders to spec", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "lusora-contract-"));
  try {
    mkdirSync(join(dir, "clips"));
    // assets: two stills + a 6s voiceover
    sh("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=darkslategray:s=640x360", "-frames:v", "1", join(dir, "clips/a.jpg")]);
    sh("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=maroon:s=640x360", "-frames:v", "1", join(dir, "clips/b.jpg")]);
    sh("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=330:duration=6", "-q:a", "9", join(dir, "audio.mp3")]);

    const plan: EditPlan = {
      version: "1.0",
      video_id: "contract",
      fps: 30,
      resolution: { width: 640, height: 360 },
      tracks: {
        visual: [
          {
            id: "v1", beat_id: "b1", locked: false, start_s: 0, end_s: 3,
            media_type: "image",
            asset: { source: "manual", path: "clips/a.jpg" },
            motion: { type: "ken_burns", direction: "in", pan: "center", strength: 0.15 },
            transition_out: { type: "crossfade", duration_s: 0.5 },
          },
          {
            id: "v2", beat_id: "b2", locked: false, start_s: 3, end_s: 6,
            media_type: "image",
            asset: { source: "manual", path: "clips/b.jpg" },
            transition_out: { type: "cut", duration_s: 0.1 },
          },
        ],
        overlays: [],
        captions: {
          enabled: true,
          preset: "plain",
          items: [
            { start_s: 0.2, end_s: 2.8, text: "First caption" },
            { start_s: 3.2, end_s: 5.8, text: "Second caption" },
          ],
        },
        audio: { voiceover: { path: "audio.mp3", start_s: 0, duration_s: 6, volume: 1 } },
      },
    };

    assert.equal(routePlan(plan).renderer, "ffmpeg");

    const result = await renderFfmpeg(plan, dir);
    assert.ok(existsSync(join(dir, "final.mp4")), "final.mp4 written");
    assert.ok(Math.abs(result.duration_s - 6) < 0.5, `duration ${result.duration_s} ≈ 6s`);

    const probe = JSON.parse(
      sh("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", join(dir, "final.mp4")])
    );
    const video = probe.streams.find((s: { codec_type: string }) => s.codec_type === "video");
    const audio = probe.streams.find((s: { codec_type: string }) => s.codec_type === "audio");
    assert.equal(video.width, 640);
    assert.equal(video.height, 360);
    assert.ok(audio, "audio stream present");
    assert.ok(Math.abs(parseFloat(probe.format.duration) - 6) < 0.5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pinned ffmpeg fails loudly on a plan that needs remotion", () => {
  const plan = {
    version: "1.0", video_id: "x", fps: 30,
    resolution: { width: 640, height: 360 },
    tracks: {
      visual: [{ id: "v1", start_s: 0, end_s: 2, media_type: "image", asset: { source: "manual", path: "a.jpg" } }],
      overlays: [{ id: "o1", kind: "component", component: "KineticTitle", props: { text: "Hi" }, start_s: 0, end_s: 2 }],
      captions: { enabled: false, items: [] },
      audio: { voiceover: { path: "audio.mp3", duration_s: 2 } },
    },
  } as unknown as EditPlan;
  const route = routePlan(plan);
  assert.equal(route.renderer, "remotion");
  assert.ok(route.reasons.some((r) => r.includes("KineticTitle")));
});

test("a looped short clip fills its slot instead of freezing", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "lusora-loop-"));
  try {
    mkdirSync(join(dir, "clips"));
    // 1s of moving footage under a 4s hold: without loop the last frame holds
    sh("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i",
      "testsrc=size=320x180:rate=30:duration=1", "-pix_fmt", "yuv420p", join(dir, "clips/short.mp4")]);
    sh("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=330:duration=4",
      "-q:a", "9", join(dir, "audio.mp3")]);

    const plan: EditPlan = {
      version: "1.0", video_id: "loop", fps: 30,
      resolution: { width: 320, height: 180 },
      tracks: {
        visual: [{
          id: "v1", beat_id: "b1", locked: false, start_s: 0, end_s: 4,
          media_type: "video", loop: true, mute: true,
          asset: { source: "stock", path: "clips/short.mp4" },
        }],
        overlays: [],
        captions: { enabled: false, items: [] },
        audio: { voiceover: { path: "audio.mp3", start_s: 0, duration_s: 4, volume: 1 } },
      },
    };

    // looping is an INPUT flag, not a plan capability: the cheap path keeps it
    assert.equal(routePlan(plan).renderer, "ffmpeg");
    const result = await renderFfmpeg(plan, dir);
    assert.ok(Math.abs(result.duration_s - 4) < 0.5, `duration ${result.duration_s} ≈ 4s`);

    // mpdecimate drops frames identical to the one before, so its count is how
    // much of the hold actually MOVES. The same plan without the flag runs the
    // source out after a second and holds still for the other three.
    const moving = (path: string): number => {
      const proc = spawnSync(
        "ffmpeg", ["-i", path, "-vf", "mpdecimate", "-an", "-f", "null", "-"],
        { encoding: "utf8" }
      );
      const counts = [...proc.stderr.matchAll(/frame=\s*(\d+)/g)];
      return Number(counts[counts.length - 1]?.[1] ?? 0);
    };
    const looped = moving(join(dir, "final.mp4"));

    const frozen: EditPlan = structuredClone(plan);
    delete frozen.tracks.visual[0]!.loop;
    await renderFfmpeg(frozen, dir);
    const held = moving(join(dir, "final.mp4"));

    assert.ok(looped > held * 2, `looped ${looped} moving frames vs ${held} without the flag`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
