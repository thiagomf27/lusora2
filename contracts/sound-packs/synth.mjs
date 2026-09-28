/**
 * Procedural sound effects for the `synth-doc` pack (D100, slice 1 of the
 * documentary pipeline plan).
 *
 * Every cue is a formula over seeded noise and sines, so the pack is
 * deterministic, offline, $0 and ours (`license: own`): rebuilding it produces
 * the same bytes. The palette follows what made Dark Palace's overlays land —
 * a sound for each KIND of motion (a card sliding in swishes, a number rolls,
 * a stamp thuds, a highlighter scratches) — but the recipes are written here
 * from scratch: filtered-noise sweeps for air, pitched transients for impacts,
 * inharmonic partials for bells.
 *
 * Each recipe returns a mono Float32Array at SR. `build.mjs` peak-normalizes
 * it like every other generated cue, so levels here only shape the sound; the
 * pack ceiling and the theme's `gain.sfx` set the loudness.
 */

export const SR = 44100;

// ---------- primitives ----------

/** mulberry32: a tiny seeded PRNG, so every build is byte-identical. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const samples = (seconds) => Math.max(1, Math.round(seconds * SR));

function noise(seconds, seed) {
  const r = rng(seed);
  const out = new Float32Array(samples(seconds));
  for (let i = 0; i < out.length; i++) out[i] = r() * 2 - 1;
  return out;
}

/**
 * RBJ biquad with a cutoff that may move over time: `freqAt(t)` is sampled
 * every 32 samples, which is smooth to the ear and cheap to compute.
 */
function biquad(input, type, freqAt, q = 0.707) {
  const out = new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  for (let i = 0; i < input.length; i++) {
    if (i % 32 === 0) {
      const f = Math.min(Math.max(freqAt(i / SR), 20), SR * 0.45);
      const w = (2 * Math.PI * f) / SR;
      const alpha = Math.sin(w) / (2 * q);
      const cos = Math.cos(w);
      const a0 = 1 + alpha;
      if (type === "lowpass") {
        b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2;
      } else if (type === "highpass") {
        b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2;
      } else {
        b0 = alpha; b1 = 0; b2 = -alpha; // bandpass, 0 dB peak
      }
      a1 = -2 * cos; a2 = 1 - alpha;
      b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
    }
    const x = input[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

const constant = (f) => () => f;
/** Exponential glide from f0 to f1 over `seconds`, held after. */
const glide = (f0, f1, seconds) => (t) => f0 * Math.pow(f1 / f0, Math.min(t / seconds, 1));
/** Up then down: f0 → f1 at `peak`, f1 → f2 by the end. */
const arc = (f0, f1, f2, peak, seconds) => (t) =>
  t < peak ? f0 * Math.pow(f1 / f0, t / peak) : f1 * Math.pow(f2 / f1, Math.min((t - peak) / (seconds - peak), 1));

/** A swell that peaks at `peak` (0-1 of the length), sin² in, power-curve out. */
function swell(n, peak, curve = 2) {
  const env = new Float32Array(n);
  const p = Math.max(1, Math.round(n * peak));
  for (let i = 0; i < n; i++) {
    env[i] = i < p ? Math.pow(Math.sin((Math.PI / 2) * (i / p)), 2) : Math.pow(1 - (i - p) / (n - p), curve);
  }
  return env;
}

/** Instant attack (a few samples), exponential decay with time constant `tau`. */
function strike(n, tau, attack = 0.002) {
  const env = new Float32Array(n);
  const a = Math.max(1, Math.round(attack * SR));
  for (let i = 0; i < n; i++) env[i] = i < a ? i / a : Math.exp(-(i - a) / (tau * SR));
  return env;
}

/** A sine whose frequency follows `freqAt`, phase-continuous. */
function tone(seconds, freqAt) {
  const out = new Float32Array(samples(seconds));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    phase += (2 * Math.PI * freqAt(i / SR)) / SR;
    out[i] = Math.sin(phase);
  }
  return out;
}

function mul(a, b) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] * (b[i] ?? 0);
  return out;
}

/** Sum several signals into one of `seconds` length, each at an offset and gain. */
function mix(seconds, ...layers) {
  const out = new Float32Array(samples(seconds));
  for (const [signal, gain = 1, at = 0] of layers) {
    const o = Math.round(at * SR);
    for (let i = 0; i < signal.length && o + i < out.length; i++) out[o + i] += signal[i] * gain;
  }
  return out;
}

/** Short linear fades at both ends, so no cue starts or stops on a click. */
function edges(signal, fadeIn = 0.003, fadeOut = 0.01) {
  const a = Math.round(fadeIn * SR), b = Math.round(fadeOut * SR);
  for (let i = 0; i < a && i < signal.length; i++) signal[i] *= i / a;
  for (let i = 0; i < b && i < signal.length; i++) signal[signal.length - 1 - i] *= i / b;
  return signal;
}

/** Gentle saturation for impacts: rounds peaks the way a mic preamp would. */
function warm(signal, drive = 1.6) {
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) out[i] = Math.tanh(signal[i] * drive) / Math.tanh(drive);
  return out;
}

/** A band of noise shaped by an envelope — the building block of every "air" sound. */
function air(seconds, seed, type, freqAt, q, env) {
  return mul(biquad(noise(seconds, seed), type, freqAt, q), env);
}

/** One short click: a filtered noise burst on top of a tiny pitched body. */
function click(seed, bright = 3200, body = 180, tau = 0.006) {
  const d = 0.05;
  const n = samples(d);
  return mix(
    d,
    [mul(biquad(noise(d, seed), "highpass", constant(bright * 0.5), 0.8), strike(n, tau)), 1],
    [mul(tone(d, constant(body)), strike(n, tau * 1.6)), 0.5],
  );
}

// ---------- the palette ----------
// `peak` is where the sound's transient sits; build.mjs turns it into lead_s
// so the loudest instant lands on the visual rather than starting there.

export const RECIPES = {
  /** A panel or card arriving: wide air, rises and falls. */
  whoosh: { seconds: 0.62, peak: 0.34, make: (d) =>
    air(d, 11, "bandpass", arc(260, 2400, 700, d * 0.55, d), 1.1, swell(samples(d), 0.55, 1.6)) },

  /** A small element sliding in: shorter, higher, lighter. */
  swish: { seconds: 0.32, peak: 0.14, make: (d) =>
    air(d, 12, "bandpass", arc(1100, 5200, 2600, d * 0.45, d), 1.4, swell(samples(d), 0.45, 2)) },

  /** A slide with weight: lower band, slower sweep. */
  slide: { seconds: 0.5, peak: 0.2, make: (d) =>
    air(d, 13, "bandpass", arc(380, 1700, 900, d * 0.4, d), 0.8, swell(samples(d), 0.4, 1.8)) },

  /** A label popping on: a pitched drop and a click. */
  pop: { seconds: 0.16, peak: 0.004, make: (d) => {
    const n = samples(d);
    return mix(d, [mul(tone(d, glide(950, 260, 0.05)), strike(n, 0.035)), 1], [click(21, 4200, 0, 0.003), 0.35]);
  } },

  /** A tick: a check mark, a pin, a small reveal. */
  tick: { seconds: 0.08, peak: 0.002, make: (d) => {
    const n = samples(d);
    return mix(d, [mul(tone(d, constant(3150)), strike(n, 0.009)), 0.7],
      [mul(tone(d, constant(5040)), strike(n, 0.005)), 0.35], [click(22, 6000, 0, 0.002), 0.4]);
  } },

  /** A UI blip: a map pin, a marker landing. Two quick steps up. */
  blip: { seconds: 0.18, peak: 0.004, make: (d) => {
    const s = 0.07;
    const n = samples(s);
    return mix(d, [mul(tone(s, constant(1400)), strike(n, 0.03)), 0.8], [mul(tone(s, constant(2100)), strike(n, 0.035)), 0.8, 0.075]);
  } },

  /** A stamp or a big number landing: low body and a thump. */
  thud: { seconds: 0.5, peak: 0.004, make: (d) => {
    const n = samples(d);
    return warm(mix(d,
      [mul(tone(d, glide(115, 42, 0.18)), strike(n, 0.12)), 1],
      [mul(biquad(noise(d, 31), "lowpass", constant(320), 0.7), strike(n, 0.03)), 0.8]), 1.4);
  } },

  /** The heavy one: a title slam, the end of a hook. Boom, crack and tail. */
  hit: { seconds: 1.2, peak: 0.004, make: (d) => {
    const n = samples(d);
    return warm(mix(d,
      [mul(tone(d, glide(96, 38, 0.3)), strike(n, 0.32)), 1],
      [mul(biquad(noise(d, 41), "bandpass", glide(1600, 500, 0.2), 0.7), strike(n, 0.06)), 0.9],
      [mul(biquad(noise(d, 42), "lowpass", constant(180), 0.7), strike(n, 0.45)), 0.5]), 2.2);
  } },

  /** Tension building INTO a moment: ends on the visual (peak = the end). */
  riser: { seconds: 1.8, peak: 1.76, make: (d) => {
    const n = samples(d);
    const env = new Float32Array(n);
    for (let i = 0; i < n; i++) env[i] = Math.pow(i / n, 2.6);
    return edges(mix(d,
      [mul(biquad(noise(d, 51), "bandpass", glide(220, 6200, d), 2.2), env), 1],
      [mul(tone(d, glide(180, 920, d)), env), 0.18]), 0.01, 0.03);
  } },

  /** A short lift into a reveal. */
  rise: { seconds: 0.62, peak: 0.58, make: (d) => {
    const n = samples(d);
    const env = new Float32Array(n);
    for (let i = 0; i < n; i++) env[i] = Math.pow(i / n, 2);
    return edges(mul(biquad(noise(d, 52), "bandpass", glide(500, 4200, d), 1.6), env), 0.01, 0.03);
  } },

  /** A highlighter stroke: scratchy mid-high noise with a wobble. */
  marker: { seconds: 0.34, peak: 0.03, make: (d) => {
    const n = samples(d);
    const r = rng(61);
    const env = swell(n, 0.08, 0.6);
    let wob = 1;
    for (let i = 0; i < n; i++) {
      if (i % 600 === 0) wob = 0.55 + r() * 0.45;
      env[i] *= wob;
    }
    return air(d, 62, "bandpass", constant(2600), 0.9, env);
  } },

  /** A line being drawn by pen: softer and thinner than the marker. */
  pen: { seconds: 0.5, peak: 0.03, make: (d) => {
    const n = samples(d);
    const r = rng(63);
    const env = swell(n, 0.06, 0.5);
    let wob = 1;
    for (let i = 0; i < n; i++) {
      if (i % 900 === 0) wob = 0.6 + r() * 0.4;
      env[i] *= wob * 0.8;
    }
    return air(d, 64, "bandpass", constant(3600), 1.4, env);
  } },

  /** A fast line or a map route: a zipping sweep. */
  zip: { seconds: 0.36, peak: 0.25, make: (d) =>
    air(d, 65, "bandpass", glide(800, 7000, d), 1.8, swell(samples(d), 0.7, 1.4)) },

  /** A number rolling up: ticks that speed up, then settle. */
  count: { seconds: 1.6, peak: 0.004, make: (d) => {
    const layers = [];
    let t = 0, k = 0;
    while (t < d - 0.08) {
      const p = t / d;
      layers.push([click(70 + k, 3000 + 900 * (k % 3), 0, 0.004), 0.8, t]);
      t += 0.028 + 0.1 * Math.pow(Math.abs(p - 0.35) / 0.65, 2); // fastest a third of the way in
      k++;
    }
    return mix(d, ...layers);
  } },

  /** Typewriter keys: a loop the compiler trims to the reveal window. */
  type: { seconds: 1.2, peak: 0, loop: true, make: (d) => {
    const r = rng(81);
    const layers = [];
    let t = 0.01, k = 0;
    while (t < d - 0.06) {
      layers.push([click(90 + k, 2400 + r() * 1400, 160 + r() * 60, 0.007), 0.7 + r() * 0.3, t]);
      t += 0.06 + r() * 0.05;
      k++;
    }
    return mix(d, ...layers);
  } },

  /** A page turning: flutter bursts and a soft landing. */
  page: { seconds: 0.55, peak: 0.12, make: (d) => {
    const n = samples(d);
    const env = new Float32Array(n);
    for (const [at, w] of [[0.05, 0.05], [0.12, 0.06], [0.2, 0.05], [0.32, 0.09]]) {
      for (let i = 0; i < n; i++) env[i] += Math.exp(-Math.pow((i / SR - at) / w, 2));
    }
    return air(d, 91, "bandpass", arc(1500, 4800, 2200, 0.2, d), 0.7, env);
  } },

  /** Paper tearing: crackle gated fast, for paper cards. */
  tear: { seconds: 0.5, peak: 0.05, make: (d) => {
    const n = samples(d);
    const r = rng(95);
    const env = swell(n, 0.1, 1.2);
    let g = 1;
    for (let i = 0; i < n; i++) {
      if (i % 220 === 0) g = r() < 0.7 ? 0.4 + r() * 0.6 : 0.05;
      env[i] *= g;
    }
    return air(d, 96, "highpass", constant(1100), 0.7, env);
  } },

  /** A bell for a key fact: inharmonic partials, long ring. */
  bell: { seconds: 1.4, peak: 0.004, make: (d) => {
    const n = samples(d);
    const f = 880;
    return mix(d, ...[[1, 0.9, 1.1], [2.76, 0.45, 0.6], [5.4, 0.25, 0.35], [8.93, 0.12, 0.2]]
      .map(([ratio, gain, tau]) => [mul(tone(d, constant(f * ratio)), strike(n, tau, 0.001)), gain]));
  } },

  /** A soft chime: harmonic, gentler than the bell. */
  chime: { seconds: 1.1, peak: 0.004, make: (d) => {
    const n = samples(d);
    return mix(d, ...[[1, 0.8, 0.7], [2, 0.3, 0.45], [3, 0.12, 0.3]]
      .map(([ratio, gain, tau]) => [mul(tone(d, constant(1320 * ratio)), strike(n, tau, 0.004)), gain]));
  } },

  /** Tape or TV static, for the old-footage look (slice 7). */
  static: { seconds: 1.2, peak: 0.1, make: (d) => {
    const n = samples(d);
    const r = rng(99);
    const env = swell(n, 0.1, 0.8);
    for (let i = 0; i < n; i++) if (r() < 0.002) env[i] *= 3;
    return air(d, 100, "bandpass", constant(2200), 0.5, env);
  } },
};

// ---------- output ----------

/** 16-bit PCM mono WAV bytes. */
export function wavBytes(signal) {
  const data = Buffer.alloc(signal.length * 2);
  for (let i = 0; i < signal.length; i++) {
    const s = Math.max(-1, Math.min(1, signal[i]));
    data.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Render one recipe to a clean, click-free signal. */
export function render(name) {
  const recipe = RECIPES[name];
  if (!recipe) throw new Error(`no synth recipe '${name}' (have ${Object.keys(RECIPES).join(", ")})`);
  const signal = recipe.make(recipe.seconds);
  return recipe.loop ? signal : edges(signal, 0.001, 0.015);
}
