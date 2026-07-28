#!/usr/bin/env node
/**
 * Sound pack generator (D48).
 *
 * Synthesizes every cue and bed with ffmpeg from a formula, then writes each
 * manifest with the REAL probed durations (mp3 frame padding means the encoded
 * file is never exactly the requested length, and the compiler sizes one-shot
 * items from `duration_s`).
 *
 * These are placeholders: honest, deterministic, $0, offline, and good enough
 * to hear the mix working end to end. They are not a substitute for recorded
 * CC0 material — see README.md for how to swap files in without touching any
 * code. Because generation is a formula, `node contracts/sound-packs/build.mjs`
 * is reproducible and the packs stay reviewable in git as small mp3s.
 *
 * Usage: node contracts/sound-packs/build.mjs [pack-name ...]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const SR = 44100;
const BED_SECONDS = 48;

/**
 * Snap a frequency to the nearest whole number of cycles in `duration`, so a
 * looped bed has no phase discontinuity at the seam. Off by a fraction of a
 * hertz and inaudible; the click it removes is not.
 */
const snap = (freq, duration) => Math.round(freq * duration) / duration;

// ---------- chord vocabulary, one per mood ----------
// Intervals chosen for register as much as harmony: the beds sit under speech,
// so everything lives low and narrow except where the mood needs air.
const CHORDS = {
  neutral: [130.81, 196.0, 261.63], // open fifth — no third, so it commits to nothing
  tense: [130.81, 138.59, 185.0], // minor 2nd against a tritone
  somber: [110.0, 130.81, 164.81], // A minor
  hopeful: [174.61, 220.0, 261.63], // F major
  urgent: [146.83, 220.0, 293.66], // D, fifth, octave — pulsed below
  triumphant: [196.0, 246.94, 293.66], // G major, brighter register
  reflective: [164.81, 246.94], // bare fifth, sparse
  playful: [261.63, 329.63, 392.0], // C major an octave up
};

/** Amplitude movement per mood: what makes tense read as tense at one volume. */
const MOTION = {
  neutral: "(0.78+0.22*sin(2*PI*t/16))",
  tense: "(0.62+0.38*pow(sin(2*PI*t/6),2))",
  somber: "(0.72+0.28*sin(2*PI*t/24))",
  hopeful: "(0.80+0.20*sin(2*PI*t/12))",
  urgent: "(0.45+0.55*pow(sin(2*PI*t*1.0),4))", // a slow pulse, once a second
  triumphant: "(0.82+0.18*sin(2*PI*t/8))",
  reflective: "(0.55+0.45*sin(2*PI*t/32))",
  playful: "(0.50+0.50*pow(sin(2*PI*t*1.5),2))",
};

/** Voice weights: lower partials louder, so the stack stays out of the vocal band. */
const WEIGHTS = [0.34, 0.24, 0.15];

function bedExpr(mood, duration, { detune = 0.6, bright = false } = {}) {
  const chord = CHORDS[mood];
  const parts = [];
  chord.forEach((freq, i) => {
    const w = WEIGHTS[i] ?? 0.12;
    parts.push(`${w.toFixed(3)}*sin(2*PI*${snap(freq, duration).toFixed(5)}*t)`);
    // a detuned twin an interval-width apart beats slowly against the first,
    // which is most of what stops a pure sine reading as a test tone
    const twin = snap(freq + detune, duration);
    parts.push(`${(w * 0.55).toFixed(3)}*sin(2*PI*${twin.toFixed(5)}*t)`);
  });
  if (bright) {
    // an octave shimmer, quiet, to lift a pack that should feel modern
    parts.push(`0.05*sin(2*PI*${snap(chord[0] * 4, duration).toFixed(5)}*t)`);
  }
  return `(${parts.join("+")})*${MOTION[mood]}`;
}

// ---------- pack definitions ----------

const PACKS = {
  "doc-restrained": {
    license: "cc0",
    bedFilter: "lowpass=f=1400,highpass=f=55",
    bedOptions: { detune: 0.6, bright: false },
    bedGain: 0.9,
    cues: {
      "swoosh-soft": {
        kind: "one_shot",
        seconds: 0.35,
        lead_s: 0.06,
        priority: 1,
        expr: "(random(0)-0.5)*2*pow(t/0.35,1.2)*exp(-4*t/0.35)",
        filter: "highpass=f=280,lowpass=f=5200",
      },
      "thud-low": {
        kind: "one_shot",
        seconds: 0.45,
        lead_s: 0.02,
        priority: 2,
        expr: "0.9*sin(2*PI*(92-42*t/0.45)*t)*exp(-8.5*t)",
        filter: "lowpass=f=900",
      },
      "chime-soft": {
        kind: "one_shot",
        seconds: 1.1,
        lead_s: 0.0,
        priority: 2,
        expr:
          "(0.55*sin(2*PI*784*t)+0.28*sin(2*PI*1174.7*t)+0.12*sin(2*PI*2093*t))*exp(-3.4*t)",
        filter: "highpass=f=300",
      },
      "tick-typing": {
        kind: "loop",
        seconds: 1.6,
        lead_s: 0.0,
        priority: 0,
        fade_out_s: 0.08,
        // one click every 70 ms, each an 8 ms burst — a keyboard, not a rattle
        expr: "(random(0)-0.5)*2*exp(-130*mod(t,0.07))*0.55",
        filter: "highpass=f=1400,lowpass=f=6500",
      },
    },
  },

  punchy: {
    license: "cc0",
    bedFilter: "lowpass=f=2600,highpass=f=70",
    bedOptions: { detune: 1.1, bright: true },
    bedGain: 1.0,
    cues: {
      "swoosh-bright": {
        kind: "one_shot",
        seconds: 0.3,
        lead_s: 0.08,
        priority: 1,
        expr: "(random(0)-0.5)*2*pow(t/0.3,0.8)*exp(-5*t/0.3)",
        filter: "highpass=f=600,lowpass=f=9000",
      },
      "pop-tight": {
        kind: "one_shot",
        seconds: 0.22,
        lead_s: 0.01,
        priority: 3,
        expr: "0.85*sin(2*PI*(420-260*t/0.22)*t)*exp(-16*t)",
        filter: "highpass=f=120,lowpass=f=3800",
      },
      "riser-short": {
        kind: "one_shot",
        seconds: 0.8,
        lead_s: 0.55,
        priority: 1,
        expr:
          "((random(0)-0.5)*1.2+0.5*sin(2*PI*(320+2100*t/0.8)*t))*pow(t/0.8,2.2)*0.8",
        filter: "highpass=f=400,lowpass=f=8000",
      },
      "thud-low": {
        kind: "one_shot",
        seconds: 0.4,
        lead_s: 0.02,
        priority: 2,
        expr: "0.95*sin(2*PI*(105-50*t/0.4)*t)*exp(-9*t)",
        filter: "lowpass=f=1000",
      },
      "tick-typing": {
        kind: "loop",
        seconds: 1.6,
        lead_s: 0.0,
        priority: 0,
        fade_out_s: 0.08,
        expr: "(random(0)-0.5)*2*exp(-110*mod(t,0.055))*0.6",
        filter: "highpass=f=1600,lowpass=f=7500",
      },
    },
  },
};

// ---------- generation ----------

const ffmpeg = (args) => execFileSync("ffmpeg", ["-y", "-v", "error", ...args]);

function probeDuration(path) {
  const out = execFileSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=nw=1:nk=1",
    path,
  ]);
  return Number(String(out).trim());
}

/** Peak of a source, in dBFS. */
function probePeak(input) {
  const proc = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-f", "lavfi", "-i", input, "-af", "volumedetect", "-f", "null", "-"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  const m = /max_volume:\s*(-?[\d.]+) dB/.exec(proc.stderr);
  if (!m) throw new Error(`could not measure peak of ${input}`);
  return Number(m[1]);
}

/**
 * Cues are normalized by PEAK, not loudness.
 *
 * A swoosh is 0.4 s long, and EBU R128 integrated loudness of a transient that
 * short is close to meaningless — its gating throws most of it away, so
 * loudnorm pushes the file until the transient is clipping-hot while the
 * measured number still reads quiet. What the ear judges in a one-shot is its
 * peak. Normalizing to a fixed -6 dBFS makes the theme's `sfx` gain a
 * predictable dB trim across every cue in the pack.
 */
const CUE_PEAK_DBFS = -6;

function renderCue(packDir, name, spec) {
  const rel = join("sfx", `${name}.mp3`);
  const out = join(packDir, rel);
  mkdirSync(dirname(out), { recursive: true });
  const source = `aevalsrc='${spec.expr}':s=${SR}:d=${spec.seconds}`;
  // measure the shaped signal, then apply the one gain that lands the peak
  const measured = probePeak(spec.filter ? `${source},${spec.filter}` : source);
  const trim = (CUE_PEAK_DBFS - measured).toFixed(2);
  ffmpeg([
    "-f", "lavfi",
    "-i", source,
    "-af", [spec.filter, `volume=${trim}dB`].filter(Boolean).join(","),
    "-ac", "1",
    "-c:a", "libmp3lame", "-q:a", "4",
    out,
  ]);
  return { rel, duration_s: Number(probeDuration(out).toFixed(3)) };
}

function renderBed(packDir, mood, pack) {
  const rel = join("beds", `${mood}-01.mp3`);
  const out = join(packDir, rel);
  mkdirSync(dirname(out), { recursive: true });
  const expr = bedExpr(mood, BED_SECONDS, pack.bedOptions);
  const filters = [
    pack.bedFilter,
    `volume=${pack.bedGain}`,
    "loudnorm=I=-24:TP=-3:LRA=7", // beds run quiet: the envelope lifts them, not the file
  ].join(",");
  ffmpeg([
    "-f", "lavfi",
    "-i", `aevalsrc='${expr}':s=${SR}:d=${BED_SECONDS}`,
    "-af", filters,
    "-ac", "1",
    "-c:a", "libmp3lame", "-q:a", "6",
    out,
  ]);
  return { rel, duration_s: Number(probeDuration(out).toFixed(3)) };
}

const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(PACKS);

for (const name of names) {
  const pack = PACKS[name];
  if (!pack) {
    console.error(`unknown pack: ${name} (have ${Object.keys(PACKS).join(", ")})`);
    process.exit(1);
  }
  const packDir = join(here, name);
  mkdirSync(packDir, { recursive: true });

  const cues = {};
  for (const [cueName, spec] of Object.entries(pack.cues)) {
    const { rel, duration_s } = renderCue(packDir, cueName, spec);
    cues[cueName] = {
      file: rel,
      kind: spec.kind,
      duration_s,
      ...(spec.lead_s ? { lead_s: spec.lead_s } : {}),
      ...(spec.priority ? { priority: spec.priority } : {}),
      ...(spec.fade_out_s ? { fade_out_s: spec.fade_out_s } : {}),
    };
    console.log(`  cue ${cueName} -> ${rel} (${duration_s}s)`);
  }

  const beds = {};
  for (const mood of Object.keys(CHORDS)) {
    const { rel, duration_s } = renderBed(packDir, mood, pack);
    beds[`${mood}-01`] = { file: rel, mood, duration_s, loopable: true };
    console.log(`  bed ${mood}-01 -> ${rel} (${duration_s}s)`);
  }

  const manifest = {
    name,
    license: pack.license,
    attribution: "Synthesized placeholders — see contracts/sound-packs/README.md",
    cues,
    beds,
  };
  writeFileSync(join(packDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`✓ ${name}: ${Object.keys(cues).length} cues, ${Object.keys(beds).length} beds`);
}
