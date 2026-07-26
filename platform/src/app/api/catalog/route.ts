import { NextResponse } from "next/server";
import type { CatalogEntry } from "@lusora/contracts";
import { handler, requireUser, requireRole, ApiError } from "@/lib/auth";
import {
  COMPONENT_NAME_RE,
  PACK_NAME_RE,
  loadMergedCatalog,
  readPack,
  templateCatalog,
  templateProblems,
  writePack,
} from "@/lib/catalog";
import { listStylePacks } from "@/lib/stylePacks";
import { validateAgainst } from "@/lib/validate";

/** The merged catalog plus the style-pack allowances, for the Overlays screen. */
export const GET = handler(async () => {
  await requireUser();
  const merged = loadMergedCatalog();
  return NextResponse.json({
    ...merged,
    stylePacks: listStylePacks(),
    templates: templateCatalog(),
  });
});

/** Create a data-only catalog entry in contracts/component-packs/<pack>.json. */
export const POST = handler(async (req: Request) => {
  await requireRole("manager");
  const body = (await req.json()) as { pack?: string; entry?: CatalogEntry };
  const pack = body.pack ?? "";
  const entry = body.entry;

  if (!PACK_NAME_RE.test(pack) || pack === "core") {
    throw new ApiError(400, "pack must be a lowercase slug and cannot be 'core' (core is generated from the engine registry)");
  }
  if (!entry || !COMPONENT_NAME_RE.test(entry.name ?? "")) {
    throw new ApiError(400, "name must be PascalCase (e.g. FactCard)");
  }
  if (entry.pack !== pack) throw new ApiError(400, `entry.pack must be "${pack}"`);

  const check = validateAgainst("catalog_entry", entry);
  if (!check.ok) throw new ApiError(400, `catalog entry invalid: ${check.errors.join("; ")}`);
  const template = templateProblems(entry);
  if (template.length) throw new ApiError(400, `catalog entry invalid: ${template.join("; ")}`);

  const existing = loadMergedCatalog().items.find((i) => i.entry.name === entry.name);
  if (existing) throw new ApiError(409, `${entry.name} already exists in ${existing.source}`);

  const file = readPack(pack);
  writePack({ pack, components: [...file.components, entry].sort((a, b) => a.name.localeCompare(b.name)) });
  return NextResponse.json({ name: entry.name, pack }, { status: 201 });
});
