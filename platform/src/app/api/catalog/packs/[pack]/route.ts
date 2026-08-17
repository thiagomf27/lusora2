import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import type { CatalogEntry } from "@lusora/contracts";
import { handler, requireUser, requireRole, ApiError } from "@/lib/auth";
import {
  type ComponentPack,
  implementedComponents,
  packPath,
  readPack,
  validatePackEntries,
  writePack,
} from "@/lib/catalog";
import { removePackEverywhere } from "@/lib/stylePacks";

type Ctx = { params: Promise<{ pack: string }> };

function existingPack(pack: string): ComponentPack {
  let path: string;
  try {
    path = packPath(pack);
  } catch (e) {
    throw new ApiError(400, e instanceof Error ? e.message : "invalid pack");
  }
  if (!existsSync(path)) throw new ApiError(404, `pack ${pack} not found`);
  return readPack(pack);
}

/** The pack file as stored — the shape POST /api/catalog/packs accepts back. */
export const GET = handler(async (_req: Request, ctx: Ctx) => {
  await requireUser();
  const { pack } = await ctx.params;
  return NextResponse.json(existingPack(pack));
});

/** Replace a pack's entries wholesale (bulk edit / re-import). */
export const PUT = handler(async (req: Request, ctx: Ctx) => {
  await requireRole("manager");
  const { pack } = await ctx.params;
  const current = existingPack(pack);
  const body = (await req.json()) as { components?: CatalogEntry[] };
  const components = body.components ?? [];

  const errors = validatePackEntries(pack, components, current.components.map((c) => c.name));
  if (errors.length) throw new ApiError(400, `pack invalid: ${errors.join("; ")}`);

  writePack({ pack, components: [...components].sort((a, b) => a.name.localeCompare(b.name)) });

  // Allowance is by pack, so entries coming and going inside a pack change no
  // style pack's mind; only deleting the pack itself does.
  const kept = new Set(components.map((c) => c.name));
  const dropped = current.components.map((c) => c.name).filter((n) => !kept.has(n));

  const implemented = new Set(implementedComponents());
  return NextResponse.json({
    pack,
    components: components.length,
    removed: dropped,
    no_renderer: components.filter((c) => !implemented.has(c.name)).map((c) => c.name),
  });
});

/** Delete the whole pack file and clear its allowances. */
export const DELETE = handler(async (_req: Request, ctx: Ctx) => {
  await requireRole("manager");
  const { pack } = await ctx.params;
  const current = existingPack(pack);

  writePack({ pack, components: [] }); // an empty pack removes the file
  const { changed, conflicts } = removePackEverywhere(pack);
  return NextResponse.json({
    pack,
    removed: current.components.length,
    cleared_allowances: changed,
    // style packs that allowed ONLY this pack: emptying them would silence
    // them entirely, so they keep the stale name and are reported instead
    orphaned_style_packs: conflicts,
  });
});
