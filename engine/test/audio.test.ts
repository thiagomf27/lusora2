/**
 * Music/sfx fade-ramp math (audioVolume.ts) — pure, unit-testable. Ported
 * from video-engine's audio.test.ts, adapted to edit_plan v1.0 field names
 * (volume / fade_in_s / fade_out_s).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { audioVolumeAt, gainAt } from "../src/renderers/remotion/audioVolume.ts";
import { envelopeExpr } from "../src/renderers/ffmpeg/render.ts";

const fps = 30;

test("holds the base volume with no fades", () => {
  assert.equal(audioVolumeAt({ volume: 0.5 }, 45, 300, fps), 0.5);
});

test("ramps in linearly over fade_in_s", () => {
  const item = { volume: 1, fade_in_s: 1 }; // 30 frames
  assert.equal(audioVolumeAt(item, 0, 300, fps), 0);
  assert.equal(audioVolumeAt(item, 15, 300, fps), 0.5);
  assert.equal(audioVolumeAt(item, 30, 300, fps), 1);
  assert.equal(audioVolumeAt(item, 60, 300, fps), 1); // past the ramp
});

test("ramps out linearly over fade_out_s relative to the item end", () => {
  const item = { volume: 1, fade_out_s: 1 }; // 30 frames
  const dur = 300;
  assert.equal(audioVolumeAt(item, dur, dur, fps), 0);
  assert.equal(audioVolumeAt(item, dur - 15, dur, fps), 0.5);
  assert.equal(audioVolumeAt(item, dur - 30, dur, fps), 1);
});

test("overlapping in/out fades multiply and clamp to [0,1]", () => {
  const item = { volume: 1, fade_in_s: 1, fade_out_s: 1 };
  const dur = 40; // fades overlap in a short item
  const v = audioVolumeAt(item, 20, dur, fps);
  assert.ok(v >= 0 && v <= 1);
});

test("defaults the volume when the item omits it", () => {
  assert.equal(audioVolumeAt({}, 100, 300, fps, 0.12), 0.12);
});

// ---------- D48 ducking envelope ----------

const ENV = [
  { t_s: 0, gain: 0.08 },
  { t_s: 10, gain: 0.08 },
  { t_s: 10.35, gain: 0.22 },
  { t_s: 14, gain: 0.22 },
  { t_s: 14.25, gain: 0.08 },
];

/** Interpolation lands a float ulp or two off exact — 10.35-10 is not 0.35. */
const close = (actual: number, expected: number, why = "") =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ~${expected}, got ${actual} ${why}`);

test("gainAt interpolates linearly between envelope points", () => {
  close(gainAt(ENV, 10), 0.08);
  close(gainAt(ENV, 10.35), 0.22);
  close(gainAt(ENV, 10.175), 0.15);
});

test("gainAt holds the ends flat outside the envelope", () => {
  assert.equal(gainAt(ENV, -5), 0.08);
  assert.equal(gainAt(ENV, 999), 0.08);
  assert.equal(gainAt([], 5), 1);
});

test("gainAt survives coincident points instead of dividing by zero", () => {
  const v = gainAt([{ t_s: 2, gain: 0.1 }, { t_s: 2, gain: 0.5 }, { t_s: 4, gain: 0.5 }], 2);
  assert.ok(Number.isFinite(v));
});

test("the envelope multiplies the base volume, and is read in ABSOLUTE time", () => {
  // an item starting at 8s: frame 60 is 2s in, i.e. t=10s absolute, still ducked
  const item = { volume: 1, gain_envelope: ENV };
  assert.equal(audioVolumeAt(item, 60, 300, fps, 1, 8), 0.08);
  // frame 180 is 6s in, t=14s absolute, lifted
  assert.equal(audioVolumeAt(item, 180, 300, fps, 1, 8), 0.22);
});

test("the envelope and the fades multiply", () => {
  const item = { volume: 1, fade_in_s: 1, gain_envelope: [{ t_s: 0, gain: 0.5 }, { t_s: 100, gain: 0.5 }] };
  // halfway through a 1s fade-in, under a flat 0.5 envelope
  assert.equal(audioVolumeAt(item, 15, 300, fps, 1, 0), 0.25);
});

test("an item with no envelope is unchanged", () => {
  assert.equal(audioVolumeAt({ volume: 0.4 }, 45, 300, fps, 1, 12), 0.4);
});

// ---------- the two render paths agree ----------

/**
 * Evaluate the ffmpeg `volume` expression the way ffmpeg would.
 *
 * The grammar envelopeExpr emits is tiny — nested `if(lt(a,b),x,y)` around
 * arithmetic — so rewriting both function forms into JS and evaluating is
 * enough. This is the only way to assert that the two render paths agree
 * without actually running ffmpeg.
 */
function evalFfmpegExpr(expr: string, t: number): number {
  const js = toJs(expr.replace(/^'|'$/g, ""));
  assert.ok(!/\b(if|lt)\(/.test(js), `expression not fully rewritten: ${js}`);
  return Function("t", `"use strict"; return (${js});`)(t) as number;
}

/** Rewrite the outermost if()/lt() call, then recurse into its arguments. */
function toJs(s: string): string {
  const call = /\b(if|lt)\(/.exec(s);
  if (!call) return s;
  const open = call.index + call[0].length - 1;
  const close = matchParen(s, open);
  const args = splitTopLevel(s.slice(open + 1, close)).map(toJs);
  const body =
    call[1] === "lt" ? `((${args[0]})<(${args[1]}))` : `((${args[0]})?(${args[1]}):(${args[2]}))`;
  return `${toJs(s.slice(0, call.index))}${body}${toJs(s.slice(close + 1))}`;
}

/** Index of the ")" closing the "(" at `open`. */
function matchParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return i;
  }
  throw new Error(`unbalanced parentheses in ${s}`);
}

/** Split on commas that are not inside parentheses. */
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    else if (s[i] === "," && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

test("the ffmpeg expression and gainAt agree on the same envelope", () => {
  // the ffmpeg chain runs at PTS 0, so the expression is shifted by start_s
  const startS = 8;
  const expr = envelopeExpr(ENV, startS);
  for (const absolute of [0, 5, 9.9, 10, 10.2, 10.35, 12, 14, 14.1, 14.25, 20]) {
    const viaFfmpeg = evalFfmpegExpr(expr, absolute - startS);
    const viaRemotion = gainAt(ENV, absolute);
    assert.ok(
      Math.abs(viaFfmpeg - viaRemotion) < 0.001,
      `t=${absolute}: ffmpeg ${viaFfmpeg} vs remotion ${viaRemotion}`
    );
  }
});
