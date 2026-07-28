import { NextResponse } from "next/server";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { SoundPack } from "@lusora/contracts";
import { handler, requireRole, ApiError } from "@/lib/auth";
import {
  SOUND_PACK_NAME_RE,
  SOUND_NAME_HINT,
  manifestPath,
  readSoundPack,
  soundPackDir,
  soundUsage,
  writeSoundPack,
} from "@/lib/soundPacks";

type Ctx = { params: Promise<{ pack: string; entry: string }> };

function load(pack: string): SoundPack {
  if (!SOUND_PACK_NAME_RE.test(pack)) throw new ApiError(400, SOUND_NAME_HINT);
  if (!existsSync(manifestPath(pack))) throw new ApiError(404, `sound pack ${pack} not found`);
  return readSoundPack(pack);
}

/**
 * Remove one cue or bed, and its file.
 *
 * Refused while a theme names it, the same guard style packs have against
 * deletion by a channel: a theme pointing at a cue that no longer exists is a
 * hard compile error on the next video, and the person deleting is exactly the
 * person who can still see why.
 */
export const DELETE = handler(async (_req: Request, ctx: Ctx) => {
  await requireRole("manager");
  const { pack, entry } = await ctx.params;
  const doc = load(pack);

  const table = doc.cues?.[entry] ? "cues" : doc.beds?.[entry] ? "beds" : null;
  if (!table) throw new ApiError(404, `${pack} has no cue or bed named '${entry}'`);

  const themes = (soundUsage()[pack] ?? {})[entry] ?? [];
  if (themes.length) {
    throw new ApiError(409, `'${entry}' is named by theme(s) ${themes.join(", ")}`);
  }

  const file = join(soundPackDir(pack), doc[table]![entry].file);
  delete doc[table]![entry];
  writeSoundPack(pack, doc);
  if (existsSync(file)) {
    try {
      unlinkSync(file);
    } catch {
      // the manifest is the contract; an orphaned byte blob is harmless
    }
  }
  return NextResponse.json({ entry, table, deleted: true });
});
