/**
 * ffmpeg renderer v1 (D7: the default, near-free path).
 *
 * Supports exactly the ffmpeg capability profile: cuts, crossfade/fade/
 * fade-to-black, Ken Burns / static stills, plain caption burn-in, audio
 * mix (voiceover + music). Anything more routes to Remotion (router.ts).
 *
 * Transition semantics: A-side consumes a rendered handle (its motion
 * continues through the blend); narrative cut times never move. All-cut
 * plans use concat (frame-exact); any fades switch the chain to xfade.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { EditPlan, VisualItem, CaptionItem } from "@lusora/contracts";

export interface RenderResult {
  duration_s: number;
}

function ffmpeg(args: string[], context: string): void {
  const proc = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (proc.status !== 0) {
    const err = (proc.stderr || "").trim().split("\n").slice(-3).join(" ");
    throw new Error(`${context}: ffmpeg failed: ${err || proc.error?.message || "unknown"}`);
  }
}

function probeDuration(file: string): number {
  const proc = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { encoding: "utf8" }
  );
  if (proc.status !== 0 || !proc.stdout.trim()) {
    throw new Error(`ffprobe could not read ${file}`);
  }
  return parseFloat(proc.stdout.trim());
}

const XFADE_TYPES: Record<string, string> = {
  crossfade: "fade",
  fade: "fade",
  fade_to_black: "fadeblack",
};

export async function renderFfmpeg(plan: EditPlan, videoDir: string): Promise<RenderResult> {
  const { fps, resolution } = plan;
  const W = resolution.width;
  const H = resolution.height;
  const visual = plan.tracks.visual;
  const vo = plan.tracks.audio.voiceover;
  const voStart = vo.start_s ?? 0;
  const totalDuration = Math.max(visual[visual.length - 1].end_s, voStart + vo.duration_s);

  const work = mkdtempSync(join(tmpdir(), "lusora-render-"));
  try {
    // ---- 1. render each visual item to a normalized segment ----
    const segments: string[] = [];
    for (let i = 0; i < visual.length; i++) {
      const item = visual[i];
      const isLast = i === visual.length - 1;
      const transition = item.transition_out ?? { type: "cut" as const, duration_s: 0.1 };
      const handle = isLast || transition.type === "cut" ? 0 : (transition.duration_s ?? 0.5);
      const dur = item.end_s - item.start_s + handle;
      const seg = join(work, `seg${String(i).padStart(3, "0")}.mp4`);
      renderSegment(item, seg, videoDir, W, H, fps, dur);
      segments.push(seg);
    }

    // ---- 2. join segments (concat for all-cut, xfade chain otherwise) ----
    const allCut = visual.every(
      (v, i) => i === visual.length - 1 || (v.transition_out?.type ?? "cut") === "cut"
    );
    const joined = join(work, "joined.mp4");
    if (segments.length === 1) {
      renameSync(segments[0], joined);
    } else if (allCut) {
      const list = join(work, "concat.txt");
      writeFileSync(list, segments.map((s) => `file '${s}'\n`).join(""));
      ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", joined], "concat");
    } else {
      const inputs = segments.flatMap((s) => ["-i", s]);
      const parts: string[] = [];
      let prevLabel = "0:v";
      for (let i = 1; i < segments.length; i++) {
        const t = visual[i - 1].transition_out ?? { type: "cut" as const, duration_s: 0.1 };
        const type = XFADE_TYPES[t.type] ?? "fade";
        const d = t.type === "cut" ? 0.08 : (t.duration_s ?? 0.5);
        const offset = Math.max(visual[i - 1].end_s - (t.type === "cut" ? 0.08 : 0), 0.01);
        const out = i === segments.length - 1 ? "vout" : `x${i}`;
        parts.push(
          `[${prevLabel}][${i}:v]xfade=transition=${type}:duration=${d.toFixed(3)}:offset=${offset.toFixed(3)}[${out}]`
        );
        prevLabel = out;
      }
      ffmpeg(
        [...inputs, "-filter_complex", parts.join(";"), "-map", "[vout]",
         "-r", String(fps), "-pix_fmt", "yuv420p", "-an", joined],
        "xfade chain"
      );
    }

    // ---- 3. captions burn-in (plain preset) ----
    let withCaptions = joined;
    const captions = plan.tracks.captions;
    if (captions.enabled && captions.items.length > 0) {
      const srtFile = join(work, "captions.srt");
      writeFileSync(srtFile, toSrt(captions.items));
      withCaptions = join(work, "captioned.mp4");
      const style =
        "FontName=DejaVu Sans,FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,Outline=1,Shadow=0,MarginV=36";
      ffmpeg(
        ["-i", joined, "-vf",
         `subtitles=${escapeFilterPath(srtFile)}:force_style='${style}'`,
         "-c:a", "copy", withCaptions],
        "captions"
      );
    }

    // ---- 4. audio mix: voiceover (+ music), then mux ----
    const voPath = resolve(videoDir, vo.path);
    if (!existsSync(voPath)) throw new Error(`voiceover file missing: ${vo.path}`);
    const music = (plan.tracks.audio.music ?? []).filter((m) =>
      existsSync(resolve(videoDir, m.path))
    );

    const audioInputs: string[] = ["-i", voPath];
    const filters: string[] = [
      `[1:a]adelay=${Math.round(voStart * 1000)}:all=1,volume=${vo.volume ?? 1}[voa]`,
    ];
    const mixLabels = ["[voa]"];
    music.forEach((m, idx) => {
      const inputIdx = 2 + idx;
      audioInputs.push(...(m.loop ? ["-stream_loop", "-1"] : []), "-i", resolve(videoDir, m.path));
      const end = m.end_s ?? totalDuration;
      const dur = Math.max(end - m.start_s, 0.1);
      const fadeOutStart = Math.max(dur - (m.fade_out_s ?? 0), 0);
      let chain = `[${inputIdx}:a]atrim=0:${dur.toFixed(3)},asetpts=PTS-STARTPTS`;
      if (m.fade_in_s) chain += `,afade=t=in:st=0:d=${m.fade_in_s}`;
      if (m.fade_out_s) chain += `,afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${m.fade_out_s}`;
      chain += `,volume=${m.volume ?? 0.12},adelay=${Math.round(m.start_s * 1000)}:all=1[m${idx}]`;
      filters.push(chain);
      mixLabels.push(`[m${idx}]`);
    });
    const mix =
      mixLabels.length === 1
        ? `${mixLabels[0]}apad[aout]`
        : `${mixLabels.join("")}amix=inputs=${mixLabels.length}:normalize=0,apad[aout]`;
    filters.push(mix);

    const tmpFinal = join(videoDir, "final.tmp.mp4");
    ffmpeg(
      ["-i", withCaptions, ...audioInputs,
       "-filter_complex", filters.join(";"),
       "-map", "0:v", "-map", "[aout]",
       "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
       "-t", totalDuration.toFixed(3), "-movflags", "+faststart", tmpFinal],
      "audio mux"
    );

    // ---- 5. atomic write ----
    renameSync(tmpFinal, join(videoDir, "final.mp4"));
    return { duration_s: probeDuration(join(videoDir, "final.mp4")) };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function renderSegment(
  item: VisualItem,
  outFile: string,
  videoDir: string,
  W: number,
  H: number,
  fps: number,
  dur: number
): void {
  const assetPath = resolve(videoDir, item.asset.path);
  if (item.media_type !== "color" && !existsSync(assetPath)) {
    throw new Error(`visual item ${item.id}: asset file missing: ${item.asset.path}`);
  }
  const cover = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;

  if (item.media_type === "image") {
    const motion = item.motion ?? { type: "none" as const };
    if (motion.type === "ken_burns") {
      const frames = Math.max(Math.round(dur * fps), 1);
      const strength = motion.strength ?? 0.12;
      const zTarget = 1 + strength;
      const zStep = strength / frames;
      const zExpr =
        (motion.direction ?? "in") === "in"
          ? `min(zoom+${zStep.toFixed(6)},${zTarget.toFixed(4)})`
          : `max(${zTarget.toFixed(4)}-on*${zStep.toFixed(6)},1.0)`;
      const pan = motion.pan ?? "center";
      const xExpr =
        pan === "left" ? `(iw-iw/zoom)*(1-on/${frames})`
        : pan === "right" ? `(iw-iw/zoom)*on/${frames}`
        : `iw/2-(iw/zoom/2)`;
      const yExpr =
        pan === "up" ? `(ih-ih/zoom)*(1-on/${frames})`
        : pan === "down" ? `(ih-ih/zoom)*on/${frames}`
        : `ih/2-(ih/zoom/2)`;
      // upscale first so zoompan has pixels to move through (avoids jitter)
      const vf = `scale=${W * 2}:-1,${cover.replace(`${W}:${H}:`, `${W * 2}:${H * 2}:`).replace(`crop=${W}:${H}`, `crop=${W * 2}:${H * 2}`)},zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=${frames}:s=${W}x${H}:fps=${fps},setsar=1`;
      ffmpeg(
        ["-i", assetPath, "-vf", vf, "-t", dur.toFixed(3),
         "-r", String(fps), "-pix_fmt", "yuv420p", "-an", outFile],
        `segment ${item.id} (ken burns)`
      );
    } else {
      ffmpeg(
        ["-loop", "1", "-t", dur.toFixed(3), "-i", assetPath,
         "-vf", `${cover},setsar=1`, "-r", String(fps), "-pix_fmt", "yuv420p", "-an", outFile],
        `segment ${item.id} (still)`
      );
    }
    return;
  }

  if (item.media_type === "color") {
    ffmpeg(
      ["-f", "lavfi", "-i", `color=c=black:s=${W}x${H}:r=${fps}`,
       "-t", dur.toFixed(3), "-pix_fmt", "yuv420p", "-an", outFile],
      `segment ${item.id} (color)`
    );
    return;
  }

  // video / avatar
  const inOffset = item.in_offset_s ?? 0;
  ffmpeg(
    ["-ss", inOffset.toFixed(3), "-i", assetPath,
     "-vf", `${cover},fps=${fps},setsar=1`, "-t", dur.toFixed(3),
     "-pix_fmt", "yuv420p", "-an", outFile],
    `segment ${item.id} (video)`
  );
}

function toSrt(items: CaptionItem[]): string {
  const fmt = (t: number) => {
    const ms = Math.round(t * 1000);
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const r = ms % 1000;
    const p = (n: number, w: number) => String(n).padStart(w, "0");
    return `${p(h, 2)}:${p(m, 2)}:${p(s, 2)},${p(r, 3)}`;
  };
  return items
    .map((c, i) => `${i + 1}\n${fmt(c.start_s)} --> ${fmt(c.end_s)}\n${c.text}\n`)
    .join("\n");
}

function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}
