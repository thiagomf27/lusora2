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
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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

/**
 * Both shipped packs now carry RECORDED cues and SYNTHESIZED beds, so neither
 * half of the old "cc0 placeholders" line is still true of the whole pack. The
 * licence is pack-wide by D33/D72 precisely so a channel's anti-copyright rule
 * is checkable, which means it has to describe the weakest thing in the pack —
 * and the provenance of operator-supplied audio is not ours to assert. Set it
 * to the real licence once that is known; `unknown` is recorded into asset
 * provenance rather than gating a render.
 */
const RECORDED_LICENSE = "unknown";
const RECORDED_ATTRIBUTION =
  "Recorded SFX supplied by the operator; beds are synthesized placeholders — see contracts/sound-packs/README.md";

const PACKS = {
  "doc-restrained": {
    license: RECORDED_LICENSE,
    attribution: RECORDED_ATTRIBUTION,
    bedFilter: "lowpass=f=1400,highpass=f=55",
    bedOptions: { detune: 0.6, bright: false },
    bedGain: 0.9,
    cues: {
      "swoosh-soft": { kind: "one_shot", lead_s: 0.06, priority: 1, recorded: true },
      "chime-soft": { kind: "one_shot", priority: 2, recorded: true },
      "page-flip": { kind: "one_shot", lead_s: 0.06, priority: 2, recorded: true },
      "highlighter": { kind: "one_shot", lead_s: 0.05, priority: 1, recorded: true },
      // Trimmed under the rest of the pack: every cue is peak-normalized to
      // the same ceiling, which is right for a transient you hear once and
      // wrong for a bed that runs under the narration for a whole entrance.
      // -4.4 dB, in the cue rather than in the file, so the pack keeps one
      // ceiling and the theme's `gain.sfx` keeps meaning what it says.
      "tick-typing": { kind: "loop", gain: 0.6, fade_out_s: 0.08, recorded: true },
    },
  },

  punchy: {
    license: RECORDED_LICENSE,
    attribution: RECORDED_ATTRIBUTION,
    bedFilter: "lowpass=f=2600,highpass=f=70",
    bedOptions: { detune: 1.1, bright: true },
    bedGain: 1.0,
    cues: {
      "swoosh-bright": { kind: "one_shot", lead_s: 0.08, priority: 1, recorded: true },
      "pop-tight": { kind: "one_shot", lead_s: 0.01, priority: 3, recorded: true },
      "page-flip": { kind: "one_shot", lead_s: 0.06, priority: 2, recorded: true },
      "highlighter": { kind: "one_shot", lead_s: 0.05, priority: 1, recorded: true },
      // Trimmed under the rest of the pack: every cue is peak-normalized to
      // the same ceiling, which is right for a transient you hear once and
      // wrong for a bed that runs under the narration for a whole entrance.
      // -4.4 dB, in the cue rather than in the file, so the pack keeps one
      // ceiling and the theme's `gain.sfx` keeps meaning what it says.
      "tick-typing": { kind: "loop", gain: 0.6, fade_out_s: 0.08, recorded: true },
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
  // A RECORDED cue is not ours to generate: the mp3 committed under sfx/ is the
  // source, and this only reads its real duration back for the manifest. The
  // alternative — dropping these cues out of PACKS — would silently delete them
  // from the manifest the next time anyone rebuilt the beds.
  if (spec.recorded) {
    if (!existsSync(out)) {
      throw new Error(
        `cue ${name} is marked recorded but ${rel} is missing from ${packDir}. ` +
          `Recorded cues are committed audio, not generated — restore the file or drop the cue.`
      );
    }
    return { rel, duration_s: Number(probeDuration(out).toFixed(3)) };
  }
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
      ...(spec.gain ? { gain: spec.gain } : {}),
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
    attribution: pack.attribution,
    cues,
    beds,
  };
  writeFileSync(join(packDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`✓ ${name}: ${Object.keys(cues).length} cues, ${Object.keys(beds).length} beds`);
}
