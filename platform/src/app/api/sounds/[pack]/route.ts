import { NextResponse } from "next/server";
import { existsSync, rmSync } from "node:fs";
import type { SoundPack } from "@lusora/contracts";
import { handler, requireUser, requireRole, ApiError } from "@/lib/auth";
import {
  SOUND_NAME_HINT,
  SOUND_PACK_NAME_RE,
  manifestPath,
  readSoundPack,
  soundPackDir,
  soundUsage,
  writeSoundPack,
} from "@/lib/soundPacks";
import { validateAgainst } from "@/lib/validate";

type Ctx = { params: Promise<{ pack: string }> };

function existing(name: string): string {
  if (!SOUND_PACK_NAME_RE.test(name)) throw new ApiError(400, SOUND_NAME_HINT);
  if (!existsSync(manifestPath(name))) throw new ApiError(404, `sound pack ${name} not found`);
  return name;
}

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  await requireUser();
  const { pack } = await ctx.params;
  return NextResponse.json(readSoundPack(existing(pack)));
});

/**
 * Overwrite a manifest in place — the metadata editor's save.
 *
 * `duration_s` is deliberately NOT trusted from the client here: whatever the
 * body claims, each entry keeps the duration already recorded for it, because
 * the compiler sizes one-shot cue items from that number. Durations change
 * only when a file is replaced, which goes through the upload route and its
 * ffprobe.
 */
export const PUT = handler(async (req: Request, ctx: Ctx) => {
  await requireRole("manager");
  const { pack } = await ctx.params;
  const name = existing(pack);
  const incoming = (await req.json()) as SoundPack;

  if (incoming?.name !== name) {
    throw new ApiError(400, `name cannot change (${name} → ${incoming?.name}); create a new pack instead`);
  }
  const current = readSoundPack(name);
  for (const table of ["cues", "beds"] as const) {
    for (const [key, spec] of Object.entries(incoming[table] ?? {})) {
      const before = current[table]?.[key];
      if (before) {
        spec.duration_s = before.duration_s;
        spec.file = before.file; // the file is owned by upload/delete, not by this form
      }
    }
  }

  const check = validateAgainst("sound_pack", incoming);
  if (!check.ok) throw new ApiError(400, `sound pack invalid: ${check.errors.join("; ")}`);

  // an entry a theme names may not vanish through a manifest edit either
  const used = soundUsage()[name] ?? {};
  const present = new Set([...Object.keys(incoming.cues ?? {}), ...Object.keys(incoming.beds ?? {})]);
  const orphaned = Object.entries(used).filter(([key]) => !present.has(key));
  if (orphaned.length) {
    throw new ApiError(
      409,
      orphaned.map(([k, themes]) => `'${k}' is named by ${themes.join(", ")}`).join("; ")
    );
  }

  writeSoundPack(name, incoming);
  return NextResponse.json({ name });
});

export const DELETE = handler(async (_req: Request, ctx: Ctx) => {
  await requireRole("manager");
  const { pack } = await ctx.params;
  const name = existing(pack);

  const used = soundUsage()[name] ?? {};
  const themes = [...new Set(Object.values(used).flat())];
  if (themes.length) {
    throw new ApiError(409, `sound pack ${name} is used by theme(s) ${themes.join(", ")}`);
  }

  rmSync(soundPackDir(name), { recursive: true, force: true });
  return NextResponse.json({ name, deleted: true });
});
