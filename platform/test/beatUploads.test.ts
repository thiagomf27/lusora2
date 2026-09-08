import test from "node:test";
import assert from "node:assert/strict";
import { checkProbed, inspectUpload, MAX_BYTES } from "../src/lib/beatUploads.ts";

/**
 * An upload is the one input to a video that no other stage has checked, so
 * these are the checks that stand between a human's file and a black shot
 * discovered at the end of a render.
 */
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(64)]);
const mp4 = () => Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom"), Buffer.alloc(64)]);
const webm = () => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)]);

test("the kinds both renderers can draw are accepted", () => {
  for (const [name, buf] of [["shot.jpg", jpeg()], ["shot.png", png()], ["clip.mp4", mp4()], ["clip.webm", webm()]] as const) {
    const check = inspectUpload(buf, name);
    assert.deepEqual(check.problems, [], `${name}: ${check.problems.join("; ")}`);
  }
  assert.equal(inspectUpload(jpeg(), "shot.jpg").media, "image");
  assert.equal(inspectUpload(mp4(), "clip.mp4").media, "video");
});

test("a kind nothing can draw is refused by name", () => {
  const check = inspectUpload(Buffer.from("%PDF-1.7"), "storyboard.pdf");
  assert.match(check.problems.join(" "), /not a kind this pipeline can draw/);
  assert.equal(check.media, null);
});

test("the bytes have to agree with the extension", () => {
  // the classic: a PNG renamed to .mp4, which decodes to nothing at render time
  const check = inspectUpload(png(), "clip.mp4");
  assert.match(check.problems.join(" "), /header does not/);
});

test("an oversized file is refused before anything is written", () => {
  const huge = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(MAX_BYTES.image + 1)]);
  assert.match(inspectUpload(huge, "shot.jpg").problems.join(" "), /over the .* MB limit/);
});

test("an empty file is refused", () => {
  assert.match(inspectUpload(Buffer.alloc(0), "shot.jpg").problems.join(" "), /empty/);
});

test("a clip shorter than the beat is a warning, not a refusal", () => {
  const warnings = checkProbed({ duration_s: 1.2, width: 1920, height: 1080 }, "video", 4.5, 1920);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /freeze on its last frame/);
});

test("a clip long enough, at frame size, says nothing", () => {
  assert.deepEqual(checkProbed({ duration_s: 6, width: 1920, height: 1080 }, "video", 4.5, 1920), []);
});

test("footage far smaller than the frame is called out", () => {
  const warnings = checkProbed({ duration_s: 9, width: 640, height: 360 }, "video", 4.5, 1920);
  assert.match(warnings.join(" "), /upscaled/);
});

test("a still is never judged on duration", () => {
  assert.deepEqual(checkProbed({ duration_s: null, width: 1920, height: 1080 }, "image", 4.5, 1920), []);
});
