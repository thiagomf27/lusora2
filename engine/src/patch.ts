/**
 * Patch render (D120, documentary plan slice 12a): re-render only the frames
 * that changed and splice them into the existing final.mp4.
 *
 * Why it can work: a Remotion render is a pure function of the frame (seeded
 * random, OffthreadVideo, no clocks), so frame N of a plan is the same pixels
 * whether it is drawn alone or inside the whole video. A patch is therefore a
 * few frame ranges drawn again, plus one frame-accurate splice.
 *
 * Frames are counted in the FILE's own numbering; a plan frame is a file frame
 * plus the first frame of the render window (0 without one), because a
 * windowed test render's t=0 is the window's start.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EditPlan } from "@lusora/contracts";
import { DEFAULT_TRANSITION_SECONDS } from "./renderers/remotion/timeline.ts";
import { frameRange, parseWindow, type RenderWindow } from "./window.ts";

/** Half-open frame range [first, end) in the file's numbering. */
export interface FrameSpan {
  first: number;
  end: number;
}

/**
 * The widest transition drawn at a junction the span touches: a transition
 * straddles its junction, so a changed shot's first frames are also the tail
 * of the transition into it, and those must be drawn again with it.
 */
export function transitionPad(plan: EditPlan, start_s: number, end_s: number): number {
  const visual = plan.tracks.visual;
  let pad = 0;
  for (let i = 0; i < visual.length; i++) {
    const item = visual[i]!;
    if (item.end_s < start_s - 1e-6 || item.start_s > end_s + 1e-6) continue;
    const t = item.transition_out;
    // a transition_out on the last item has no junction (the renderer ignores it)
    if (!t || t.type === "cut" || i === visual.length - 1) continue;
    pad = Math.max(pad, t.duration_s ?? DEFAULT_TRANSITION_SECONDS);
  }
  return pad;
}

/**
 * Plan-second spans -> merged file-frame spans: padded by the transitions they
 * touch, snapped OUTWARD to whole frames, shifted by the window's first frame,
 * clamped to the file, and merged where they overlap or touch. A span wholly
 * outside the file (outside a window render) is dropped.
 */
export function fileSpans(
  spans: Array<[number, number]>,
  plan: EditPlan,
  fps: number,
  windowFirstFrame: number,
  fileFrames: number,
): FrameSpan[] {
  const out: FrameSpan[] = [];
  for (const [s, e] of spans) {
    if (!(e > s)) continue;
    const pad = transitionPad(plan, s, e);
    // a hair of tolerance so a span already on a frame boundary does not
    // grow a frame from float noise (1.0 * 30 = 30.000000000000004)
    const first = Math.max(0, Math.floor((s - pad) * fps + 1e-6) - windowFirstFrame);
    const end = Math.min(fileFrames, Math.ceil((e + pad) * fps - 1e-6) - windowFirstFrame);
    if (end > first) out.push({ first, end });
  }
  out.sort((a, b) => a.first - b.first);
  const merged: FrameSpan[] = [];
  for (const span of out) {
    const last = merged[merged.length - 1];
    if (last && span.first <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

// ---------------- ffmpeg ----------------

function run(cmd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const p = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return { status: p.status ?? 1, stdout: p.stdout ?? "", stderr: p.stderr ?? "" };
}

/** The video stream's frame count, by counting its packets (exact, and
 *  cheap: no decode). */
export function countFrames(file: string): number {
  const p = run("ffprobe", [
    "-v", "error", "-select_streams", "v:0", "-count_packets",
    // default=nw=1:nk=1, not csv: csv appends a separator on some files
    // (Remotion's renders print "1800,")
    "-show_entries", "stream=nb_read_packets", "-of", "default=nw=1:nk=1", file,
  ]);
  const n = Number(p.stdout.trim().split("\n")[0]);
  if (p.status !== 0 || !Number.isFinite(n) || n <= 0) {
    throw new Error(`cannot count the frames of ${file}: ${p.stderr.trim().slice(0, 200)}`);
  }
  return n;
}

export interface VideoStream {
  fps: number;
  pixFmt: string;
  width: number;
  height: number;
}

export function probeVideo(file: string): VideoStream {
  const p = run("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=r_frame_rate,pix_fmt,width,height", "-of", "json", file,
  ]);
  const s = (JSON.parse(p.stdout || "{}").streams ?? [])[0];
  if (p.status !== 0 || !s) throw new Error(`cannot read the video stream of ${file}`);
  const [num, den] = String(s.r_frame_rate).split("/").map(Number);
  return { fps: num! / (den || 1), pixFmt: s.pix_fmt, width: s.width, height: s.height };
}

export interface Patch extends FrameSpan {
  file: string;
}

/**
 * Splice `patches` (each exactly `end - first` frames, in order, not
 * overlapping) into `original`, writing `out`: one ffmpeg call, the untouched
 * stretches cut by FRAME number, and everything re-encoded once at the
 * original's pixel format and rate. Audio is the original's stream copied
 * (`keep`), or `audio` muxed in as-is.
 *
 * Each piece — an untouched stretch of the original, or a patch — is encoded
 * on its OWN, one at a time, with identical x264 settings, and the pieces are
 * joined by the concat demuxer as a stream copy. One filter graph that reads
 * the original once and trims it twice buffers every raw frame of the later
 * stretch while the earlier one is consumed: on the 60 s Centralia render
 * that was 3.4 GB, and the kernel killed ffmpeg on this 7.5 GB laptop.
 *
 * Throws unless `out` has exactly as many frames as `original`, and each
 * piece exactly as many as it should: a splice one frame off shows as a flash
 * on every repaired video and nothing downstream would notice.
 */
export function splice(original: string, patches: Patch[], out: string, audio: "keep" | string): number {
  const total = countFrames(original);
  const { pixFmt, fps } = probeVideo(original);
  const pieces: Array<{ file: string; first?: number; end?: number; frames: number }> = [];
  let cursor = 0;
  patches.forEach((p, k) => {
    if (p.first < cursor || p.end > total || p.end <= p.first) {
      throw new Error(`patch ${k} [${p.first}, ${p.end}) does not fit the ${total}-frame original in order`);
    }
    const have = countFrames(p.file);
    if (have !== p.end - p.first) {
      throw new Error(`patch ${k} has ${have} frames, expected ${p.end - p.first}`);
    }
    if (p.first > cursor) pieces.push({ file: original, first: cursor, end: p.first, frames: p.first - cursor });
    pieces.push({ file: p.file, frames: p.end - p.first });
    cursor = p.end;
  });
  if (cursor < total) pieces.push({ file: original, first: cursor, end: total, frames: total - cursor });

  const work = mkdtempSync(join(tmpdir(), "lusora-splice-"));
  try {
    // one timescale for every piece, so the demuxer's copy is seamless
    const timescale = String(Math.round(fps * 512));
    const list: string[] = [];
    pieces.forEach((piece, k) => {
      const seg = join(work, `seg_${String(k).padStart(3, "0")}.mp4`);
      const cut = piece.first === undefined ? "" : `trim=start_frame=${piece.first}:end_frame=${piece.end},`;
      const p = run("ffmpeg", [
        "-y", "-v", "error", "-i", piece.file, "-an",
        "-vf", `${cut}setpts=PTS-STARTPTS,format=${pixFmt},setsar=1`,
        // stop decoding at the piece's last frame rather than reading the
        // original to its end for every stretch
        "-frames:v", String(piece.frames),
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", pixFmt,
        // passthrough, never cfr: cfr may duplicate or drop a frame to hit a rate
        "-fps_mode", "passthrough", "-video_track_timescale", timescale, seg,
      ]);
      if (p.status !== 0) throw new Error(`encoding piece ${k} failed: ${(p.stderr.trim() || `killed (${p.status})`).slice(-400)}`);
      const got = countFrames(seg);
      if (got !== piece.frames) throw new Error(`piece ${k} came out with ${got} frames, expected ${piece.frames}`);
      list.push(`file '${seg}'`);
    });
    const listFile = join(work, "list.txt");
    writeFileSync(listFile, list.join("\n") + "\n");

    const audioIn = audio === "keep" ? original : audio;
    const p = run("ffmpeg", [
      "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", listFile, "-i", audioIn,
      "-map", "0:v:0", "-map", "1:a?", "-c", "copy", "-movflags", "+faststart", out,
    ]);
    if (p.status !== 0) throw new Error(`joining the pieces failed: ${(p.stderr.trim() || `killed (${p.status})`).slice(-400)}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  const got = countFrames(out);
  if (got !== total) throw new Error(`the spliced video has ${got} frames, the original ${total} — not written`);
  return got;
}

// ---------------- the command ----------------

/** Plan seconds `<s>-<e>[,<s>-<e>...]` -> spans; one actionable reason on a typo. */
export function parseSpans(raw: string): Array<[number, number]> {
  // empty = no picture changed (an audio-only remix)
  if (!raw.trim()) return [];
  return raw.split(",").map((part) => {
    const m = /^\s*(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\s*$/.exec(part);
    if (!m || !(Number(m[2]) > Number(m[1]))) {
      throw new Error(`--spans must be <start>-<end>[,<start>-<end>...] in plan seconds (got '${part}')`);
    }
    return [Number(m[1]), Number(m[2])] as [number, number];
  });
}

function planDuration(plan: EditPlan): number {
  const vo = plan.tracks.audio.voiceover;
  const visual = plan.tracks.visual;
  return Math.max(visual.length ? visual[visual.length - 1]!.end_s : 0, (vo.start_s ?? 0) + vo.duration_s);
}

/** The render window the video was made with (`cfg.json` output.window), as
 *  the worker's render_window() reads it; null for a whole-video render. */
export function cfgWindow(videoDir: string, plan: EditPlan): RenderWindow | null {
  const cfgPath = join(videoDir, "cfg.json");
  if (!existsSync(cfgPath)) return null;
  const w = (JSON.parse(readFileSync(cfgPath, "utf8"))?.output ?? {}).window;
  if (!w || w.end_s === undefined) return null;
  return parseWindow(`${Number(w.start_s ?? 0)}-${Number(w.end_s)}`, planDuration(plan));
}

export interface PatchResult {
  patched: Array<[number, number]>;
  frames: number;
  audio: "keep" | "remix";
}

/**
 * Re-render `spans` (plan seconds) of `videoDir`'s final.mp4 and splice them
 * in place. Refuses — leaving final.mp4 untouched — when the plan renders with
 * ffmpeg, when final.mp4 is not this plan's size, rate or length (a retimed
 * plan is not a patch), or when any frame count disagrees.
 */
export async function runPatch(
  videoDir: string,
  spans: Array<[number, number]>,
  audio: "keep" | "remix",
  requested: "auto" | "ffmpeg" | "remotion" = "auto",
): Promise<PatchResult> {
  const plan: EditPlan = JSON.parse(readFileSync(join(videoDir, "edit_plan.json"), "utf8"));
  const original = join(videoDir, "final.mp4");
  if (!existsSync(original)) throw new Error(`no final.mp4 in ${videoDir} to patch — render the whole video`);

  const { loadTheme, prepareRemotion, drawRemotion } = await import("./renderers/remotion/render.ts");
  const { routePlan } = await import("./router.ts");
  const route = routePlan(plan, loadTheme(videoDir));
  const renderer = requested === "auto" ? route.renderer : requested;
  if (renderer !== "remotion") {
    throw new Error("this plan renders with ffmpeg, and patching an ffmpeg render is not supported — re-render the whole video");
  }

  const fps = plan.fps;
  const total = countFrames(original);
  const stream = probeVideo(original);
  if (Math.abs(stream.fps - fps) > 0.01 || stream.width !== plan.resolution.width || stream.height !== plan.resolution.height) {
    throw new Error(
      `final.mp4 is ${stream.width}x${stream.height} at ${stream.fps} fps, the plan ${plan.resolution.width}x${plan.resolution.height} at ${fps} — not this plan's render; re-render the whole video`,
    );
  }
  const window = cfgWindow(videoDir, plan);
  const range = window ? frameRange(window, fps) : null;
  const offset = range ? range[0] : 0;

  const targets = fileSpans(spans, plan, fps, offset, total);
  if (!targets.length && audio === "keep") return { patched: [], frames: total, audio };

  const t0 = Date.now();
  // phase timings on stderr: the worker shows them when a patch fails or times out
  const phase = (what: string) => console.error(`[patch] ${what} at ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const prep = await prepareRemotion(plan, videoDir);
  phase("bundled")
  const expected = range ? range[1] - range[0] + 1 : prep.composition.durationInFrames;
  if (expected !== total) {
    throw new Error(
      `final.mp4 has ${total} frames and this plan draws ${expected} — its timing changed since the render, which is not a patch; re-render the whole video`,
    );
  }

  const work = mkdtempSync(join(tmpdir(), "lusora-patch-"));
  const tmpOut = join(videoDir, "final.tmp.mp4");
  try {
    const patches: Patch[] = [];
    for (const [k, span] of targets.entries()) {
      const file = join(work, `patch_${k}.mp4`);
      await drawRemotion(prep, file, { muted: true, frameRange: [span.first + offset, span.end + offset - 1] });
      phase(`drew span ${k + 1}/${targets.length} (${span.end - span.first} frames)`);
      patches.push({ ...span, file });
    }
    let track: "keep" | string = "keep";
    if (audio === "remix") {
      track = join(work, "audio.m4a");
      await drawRemotion(prep, track, { codec: "aac", ...(range ? { frameRange: range } : {}) });
      phase("drew the audio");
    }
    if (patches.length) {
      splice(original, patches, tmpOut, track);
      phase("spliced");
    } else {
      // only the sound changed: the picture is copied, not re-encoded
      const p = spawnSync("ffmpeg", [
        "-y", "-v", "error", "-i", original, "-i", track,
        "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-movflags", "+faststart", tmpOut,
      ], { encoding: "utf8" });
      if (p.status !== 0) throw new Error(`audio swap failed: ${(p.stderr ?? "").trim().slice(-300)}`);
    }
    if (audio === "remix") {
      const { normalizeLoudness } = await import("./renderers/loudness.ts");
      // the same mastering a full render gets (D48, D114)
      normalizeLoudness(tmpOut, plan.tracks.audio.master?.loudness ?? "single");
      const after = countFrames(tmpOut);
      if (after !== total) throw new Error(`mastering changed the frame count (${after}, expected ${total}) — not written`);
    }
    renameSync(tmpOut, original);
  } catch (e) {
    if (existsSync(tmpOut)) unlinkSync(tmpOut);
    throw e;
  } finally {
    rmSync(work, { recursive: true, force: true });
    // the bundle is a full copy of the video folder (2 GB on Centralia):
    // never leave it in /tmp
    if (prep.serveUrl.startsWith(tmpdir())) rmSync(prep.serveUrl, { recursive: true, force: true });
  }
  const at = (f: number) => Math.round(((f + offset) / fps) * 1000) / 1000;
  return { patched: targets.map((t) => [at(t.first), at(t.end)]), frames: total, audio };
}
