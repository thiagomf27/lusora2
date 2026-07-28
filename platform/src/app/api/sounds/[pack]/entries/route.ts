import { NextResponse } from "next/server";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { SoundPack } from "@lusora/contracts";
import { handler, requireRole, ApiError } from "@/lib/auth";
import {
  SOUND_ENTRY_NAME_RE,
  SOUND_PACK_NAME_RE,
  SOUND_NAME_HINT,
  isAudioExtension,
  manifestPath,
  normalizeAudio,
  probeDuration,
  readSoundPack,
  soundPackDir,
  writeSoundPack,
} from "@/lib/soundPacks";
import { validateAgainst } from "@/lib/validate";

type Ctx = { params: Promise<{ pack: string }> };

const MOODS = [
  "neutral", "tense", "somber", "hopeful",
  "urgent", "triumphant", "reflective", "playful",
];

/**
 * Upload one audio file and register it as a cue or a bed.
 *
 * The whole reason this is a server route and not a manifest edit: the file's
 * duration is PROBED here with ffprobe and written into the manifest. The
 * compiler sizes one-shot cue items from `duration_s`, so a value typed by
 * hand — or carried over from whatever the file used to be — produces a cue
 * that ends early or overruns its window, and nothing complains until someone
 * listens to a finished video.
 */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  await requireRole("manager");
  const { pack } = await ctx.params;
  if (!SOUND_PACK_NAME_RE.test(pack)) throw new ApiError(400, SOUND_NAME_HINT);
  if (!existsSync(manifestPath(pack))) throw new ApiError(404, `sound pack ${pack} not found`);

  const form = await req.formData();
  const name = String(form.get("name") ?? "").trim();
  const table = String(form.get("table") ?? "cues") === "beds" ? "beds" : "cues";
  const file = form.get("file");

  if (!SOUND_ENTRY_NAME_RE.test(name)) {
    throw new ApiError(400, "name must be lowercase letters, digits and dashes (e.g. swoosh-soft)");
  }
  if (!(file instanceof File) || file.size === 0) throw new ApiError(400, "an audio file is required");
  if (!isAudioExtension(file.name)) {
    throw new ApiError(400, `unsupported audio format ${extname(file.name) || "(none)"}`);
  }

  const doc: SoundPack = readSoundPack(pack);
  const replacing = Boolean(doc[table]?.[name]);
  const other = table === "cues" ? "beds" : "cues";
  if (doc[other]?.[name]) {
    throw new ApiError(409, `'${name}' already exists in ${other} — cue and bed names share one namespace`);
  }

  const subdir = table === "cues" ? "sfx" : "beds";
  const rel = join(subdir, `${name}${extname(file.name).toLowerCase()}`);
  const abs = join(soundPackDir(pack), rel);
  mkdirSync(join(soundPackDir(pack), subdir), { recursive: true });
  writeFileSync(abs, Buffer.from(await file.arrayBuffer()));

  if (String(form.get("normalize") ?? "1") !== "0") {
    normalizeAudio(abs, table === "cues" ? "cue" : "bed");
  }

  const duration = probeDuration(abs);
  if (duration === null) {
    unlinkSync(abs);
    throw new ApiError(400, `${file.name} is not decodable audio`);
  }

  if (table === "cues") {
    const kind = String(form.get("kind") ?? "one_shot") === "loop" ? "loop" : "one_shot";
    doc.cues = {
      ...doc.cues,
      [name]: { ...(doc.cues?.[name] ?? {}), file: rel, kind, duration_s: duration },
    };
  } else {
    const mood = String(form.get("mood") ?? "neutral");
    if (!MOODS.includes(mood)) throw new ApiError(400, `mood must be one of ${MOODS.join(", ")}`);
    doc.beds = {
      ...doc.beds,
      [name]: {
        ...(doc.beds?.[name] ?? {}),
        file: rel,
        mood: mood as (typeof MOODS)[number] & SoundPack["beds"][string]["mood"],
        duration_s: duration,
        loopable: true,
      },
    };
  }

  const check = validateAgainst("sound_pack", doc);
  if (!check.ok) {
    unlinkSync(abs);
    throw new ApiError(400, `sound pack invalid: ${check.errors.join("; ")}`);
  }
  writeSoundPack(pack, doc);
  return NextResponse.json({ name, table, duration_s: duration, replaced: replacing }, { status: 201 });
});
