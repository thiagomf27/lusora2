import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import type { CatalogEntry } from "@lusora/contracts";
import { handler, requireUser, requireRole, ApiError } from "@/lib/auth";
import {
  type ComponentPack,
  PACK_NAME_RE,
  implementedComponents,
  loadMergedCatalog,
  packPath,
  validatePackEntries,
  writePack,
} from "@/lib/catalog";

/** The data packs that exist as files, with their entry counts. */
export const GET = handler(async () => {
  await requireUser();
  const merged = loadMergedCatalog();
  const packs = merged.dataPacks.map((pack) => {
    const items = merged.items.filter((i) => i.entry.pack === pack);
    return {
      pack,
      components: items.length,
      unimplemented: items.filter((i) => !i.implemented).length,
    };
  });
  return NextResponse.json({ packs, loadErrors: merged.loadErrors });
});

/**
 * Import a whole pack at once: `{ pack, components: [...] }` — the same shape
 * as the file on disk, so a pack can be round-tripped out of one install and
 * into another. Either every entry is valid or nothing is written.
 */
export const POST = handler(async (req: Request) => {
  await requireRole("manager");
  const body = (await req.json()) as Partial<ComponentPack> & { components?: CatalogEntry[] };
  const pack = (body.pack ?? "").trim();
  const components = body.components ?? [];

  // existence first, so re-importing a pack reads as a conflict rather than a
  // wall of "already defined" collisions with itself
  if (PACK_NAME_RE.test(pack) && pack !== "core" && existsSync(packPath(pack))) {
    throw new ApiError(409, `pack ${pack} already exists — PUT /api/catalog/packs/${pack} replaces it`);
  }
  const errors = validatePackEntries(pack, components);
  if (errors.length) throw new ApiError(400, `pack invalid: ${errors.join("; ")}`);

  writePack({
    pack,
    components: [...components].sort((a, b) => a.name.localeCompare(b.name)),
  });

  const implemented = new Set(implementedComponents());
  return NextResponse.json(
    {
      pack,
      imported: components.length,
      no_renderer: components.filter((c) => !implemented.has(c.name)).map((c) => c.name),
    },
    { status: 201 }
  );
});
