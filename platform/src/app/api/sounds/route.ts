import { NextResponse } from "next/server";
import { existsSync, mkdirSync } from "node:fs";
import type { SoundPack } from "@lusora/contracts";
import { handler, requireUser, requireRole, ApiError } from "@/lib/auth";
import {
  SOUND_NAME_HINT,
  SOUND_PACK_NAME_RE,
  listSoundPacks,
  manifestPath,
  readSoundPack,
  soundPackDir,
  soundUsage,
  writeSoundPack,
} from "@/lib/soundPacks";
import { validateAgainst } from "@/lib/validate";

/** List / create sound packs. Single-pack update: ./[pack]/route.ts */

export interface SoundPackRow {
  name: string;
  doc: SoundPack | null;
  errors: string[];
  /** cue or bed name -> the themes naming it, so the UI can refuse a delete */
  usage: Record<string, string[]>;
  /** files a manifest names but that are not on disk */
  missing: string[];
}

export const GET = handler(async () => {
  await requireUser();
  const usage = soundUsage();

  const rows: SoundPackRow[] = listSoundPacks().map((name) => {
    const row: SoundPackRow = { name, doc: null, errors: [], usage: usage[name] ?? {}, missing: [] };
    try {
      const doc = readSoundPack(name);
      row.doc = doc;
      row.errors = validateAgainst("sound_pack", doc).errors;
      if (doc.name !== name) row.errors.push(`manifest name '${doc.name}' does not match the folder`);
      // the same check CI runs: a missing file surfaces here rather than as a
      // render failure on a real video days later
      const dir = soundPackDir(name);
      for (const [key, spec] of Object.entries({ ...(doc.cues ?? {}), ...(doc.beds ?? {}) })) {
        if (!existsSync(`${dir}/${(spec as { file: string }).file}`)) row.missing.push(key);
      }
    } catch (e) {
      row.errors = [e instanceof Error ? e.message : "unreadable"];
    }
    return row;
  });
  return NextResponse.json(rows);
});

export const POST = handler(async (req: Request) => {
  await requireRole("manager");
  const body = (await req.json()) as { name?: string; license?: string; attribution?: string };
  const name = String(body.name ?? "");
  if (!SOUND_PACK_NAME_RE.test(name)) throw new ApiError(400, SOUND_NAME_HINT);
  if (existsSync(manifestPath(name))) throw new ApiError(409, `sound pack ${name} already exists`);

  const pack = {
    name,
    license: body.license ?? "cc0",
    ...(body.attribution ? { attribution: body.attribution } : {}),
    cues: {},
    beds: {},
  } as SoundPack;
  const check = validateAgainst("sound_pack", pack);
  if (!check.ok) throw new ApiError(400, `sound pack invalid: ${check.errors.join("; ")}`);

  mkdirSync(`${soundPackDir(name)}/sfx`, { recursive: true });
  mkdirSync(`${soundPackDir(name)}/beds`, { recursive: true });
  writeSoundPack(name, pack);
  return NextResponse.json({ name }, { status: 201 });
});
