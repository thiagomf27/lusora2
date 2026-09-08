/**
 * Human-supplied footage for one beat: what is accepted, and where it lives.
 *
 * "Manual-first" is a principle here, not a fallback — a human should be able
 * to hand the pipeline the exact shot they want. But an upload is the one
 * input nothing else has checked, so it is validated BEFORE it is written and
 * before the plan is pointed at it: a file the renderer cannot decode is a
 * black shot found at the end of a render, not at the moment it was chosen.
 *
 * Three checks are hard, and none of them trusts the filename:
 *
 *  1. the extension is one both renderers can draw,
 *  2. the BYTES agree with it (a .mp4 whose header says PNG is refused),
 *  3. it is within the size cap.
 *
 * Everything after that is a warning, because it describes a choice rather
 * than a defect: a clip shorter than the beat freezes on its last frame, which
 * the engine does on purpose, and footage smaller than the composition is
 * upscaled rather than rejected.
 */
import { spawnSync } from "node:child_process";

export type UploadMedia = "video" | "image";

export interface UploadKind {
  media: UploadMedia;
  /** Bytes that must appear for the extension to be believed. */
  matches: (buf: Buffer) => boolean;
}

const ascii = (buf: Buffer, at: number, text: string) =>
  buf.length >= at + text.length && buf.subarray(at, at + text.length).toString("latin1") === text;

const starts = (buf: Buffer, ...bytes: number[]) =>
  buf.length >= bytes.length && bytes.every((b, i) => buf[i] === b);

/** What the engine can actually draw: Img for stills, OffthreadVideo for the rest. */
export const ACCEPTED: Record<string, UploadKind> = {
  ".jpg": { media: "image", matches: (b) => starts(b, 0xff, 0xd8, 0xff) },
  ".jpeg": { media: "image", matches: (b) => starts(b, 0xff, 0xd8, 0xff) },
  ".png": { media: "image", matches: (b) => starts(b, 0x89, 0x50, 0x4e, 0x47) },
  ".webp": { media: "image", matches: (b) => ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP") },
  // ISO base media (mp4/m4v/mov) always carries `ftyp` in the first box
  ".mp4": { media: "video", matches: (b) => ascii(b, 4, "ftyp") },
  ".mov": { media: "video", matches: (b) => ascii(b, 4, "ftyp") },
  ".webm": { media: "video", matches: (b) => starts(b, 0x1a, 0x45, 0xdf, 0xa3) },
};

export const MAX_BYTES: Record<UploadMedia, number> = {
  image: 30 * 1024 * 1024,
  video: 400 * 1024 * 1024,
};

export interface UploadProbe {
  duration_s: number | null;
  width: number | null;
  height: number | null;
}

/**
 * Real duration and size, from ffprobe — the same trick `soundPacks` uses to
 * tell a real file from a renamed one. Absent ffprobe returns nulls: the hard
 * checks above stand on their own, and a missing tool must not stop a human
 * handing over a shot.
 */
export function probeVisual(file: string): UploadProbe {
  const proc = spawnSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0",
     "-show_entries", "stream=width,height:format=duration",
     "-of", "default=nw=1:nk=1", file],
    { encoding: "utf8" }
  );
  if (proc.status !== 0) return { duration_s: null, width: null, height: null };
  const [width, height, duration] = String(proc.stdout).trim().split("\n").map(Number);
  const finite = (n: number) => (Number.isFinite(n) && n > 0 ? n : null);
  return {
    width: finite(width),
    height: finite(height),
    duration_s: finite(duration) ? Number(duration.toFixed(3)) : null,
  };
}

export interface UploadCheck {
  /** Empty when the file may be written. */
  problems: string[];
  /** Things worth saying out loud that are not refusals. */
  warnings: string[];
  media: UploadMedia | null;
  extension: string;
}

/** The checks that need only the bytes — run before anything touches disk. */
export function inspectUpload(buf: Buffer, filename: string): UploadCheck {
  const extension = (/\.[a-z0-9]+$/i.exec(filename.toLowerCase()) ?? [""])[0];
  const kind = ACCEPTED[extension];
  if (!kind) {
    return {
      problems: [
        `${filename || "that file"} is not a kind this pipeline can draw — accepted: ` +
          `${Object.keys(ACCEPTED).join(", ")}`,
      ],
      warnings: [],
      media: null,
      extension,
    };
  }
  const problems: string[] = [];
  if (!kind.matches(buf)) {
    problems.push(
      `the name says ${extension} but the file's own header does not — it is either a ` +
        "different format with the wrong extension, or it is damaged"
    );
  }
  if (buf.length > MAX_BYTES[kind.media]) {
    problems.push(
      `${(buf.length / 1e6).toFixed(0)} MB is over the ${MAX_BYTES[kind.media] / 1e6} MB limit for ` +
        `${kind.media === "video" ? "a clip" : "an image"}`
    );
  }
  if (buf.length === 0) problems.push("the file is empty");
  return { problems, warnings: [], media: kind.media, extension };
}

/**
 * The checks that need the file on disk, once it has passed `inspectUpload`.
 * `holdSeconds` is how long the beat is on screen, which is what makes a short
 * clip worth mentioning.
 */
export function checkProbed(
  probe: UploadProbe,
  media: UploadMedia,
  holdSeconds: number,
  frameWidth: number
): UploadCheck["warnings"] {
  const warnings: string[] = [];
  if (media === "video") {
    if (probe.duration_s === null) {
      warnings.push(
        "ffprobe could not read this clip — it may still draw, but nothing here could check it"
      );
    } else if (probe.duration_s + 0.05 < holdSeconds) {
      warnings.push(
        `the clip is ${probe.duration_s.toFixed(1)}s and this beat holds ${holdSeconds.toFixed(1)}s, ` +
          "so the render will freeze on its last frame for the remainder"
      );
    }
  }
  if (probe.width && frameWidth && probe.width < frameWidth * 0.75) {
    warnings.push(
      `${probe.width}px wide against a ${frameWidth}px frame — it will be upscaled, and will look it`
    );
  }
  return warnings;
}
