import { NextResponse } from "next/server";
import type { CatalogEntry } from "@lusora/contracts";
import { handler, requireUser, requireRole, ApiError } from "@/lib/auth";
import { findItem, readPack, templateProblems, writePack } from "@/lib/catalog";
import { validateAgainst } from "@/lib/validate";

type Ctx = { params: Promise<{ name: string }> };

/** A data-pack entry that may be written. Core entries are generated. */
function editable(name: string) {
  const item = findItem(name);
  if (!item) throw new ApiError(404, `component ${name} not in the catalog`);
  if (!item.editable) {
    throw new ApiError(
      400,
      `${name} is a core component generated from engine/src/catalog/registry.ts — edit it there and run \`pnpm --filter @lusora/engine run catalog\``
    );
  }
  return item;
}

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  await requireUser();
  const { name } = await ctx.params;
  const item = findItem(name);
  if (!item) throw new ApiError(404, `component ${name} not in the catalog`);
  return NextResponse.json(item);
});

export const PUT = handler(async (req: Request, ctx: Ctx) => {
  await requireRole("manager");
  const { name } = await ctx.params;
  const item = editable(name);
  const entry = (await req.json()) as CatalogEntry;

  if (entry?.name !== name) {
    throw new ApiError(400, `name cannot change (${name} → ${entry?.name}); plans and style packs reference it by name`);
  }
  if (entry.pack !== item.entry.pack) {
    throw new ApiError(400, `pack cannot change (${item.entry.pack} → ${entry.pack})`);
  }
  const check = validateAgainst("catalog_entry", entry);
  if (!check.ok) throw new ApiError(400, `catalog entry invalid: ${check.errors.join("; ")}`);
  const template = templateProblems(entry);
  if (template.length) throw new ApiError(400, `catalog entry invalid: ${template.join("; ")}`);

  const file = readPack(entry.pack);
  writePack({
    pack: entry.pack,
    components: file.components.map((c) => (c.name === name ? entry : c)),
  });
  return NextResponse.json({ name });
});

export const DELETE = handler(async (_req: Request, ctx: Ctx) => {
  await requireRole("manager");
  const { name } = await ctx.params;
  const item = editable(name);

  const file = readPack(item.entry.pack);
  writePack({ pack: item.entry.pack, components: file.components.filter((c) => c.name !== name) });
  // Nothing to clean up in the style packs: allowance is by PACK, and the pack
  // this component belonged to still exists.
  return NextResponse.json({ name });
});
