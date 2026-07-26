import { NextResponse } from "next/server";
import { handler, requireRole, ApiError } from "@/lib/auth";
import { findItem } from "@/lib/catalog";
import { listStylePacks, setComponentAllowance } from "@/lib/stylePacks";

type Ctx = { params: Promise<{ name: string }> };

/**
 * Set which style packs offer this component (`overlays.allowed_components`).
 * Works for core components too — the allowance is style-pack data, not
 * generated catalog data.
 */
export const PUT = handler(async (req: Request, ctx: Ctx) => {
  await requireRole("manager");
  const { name } = await ctx.params;
  if (!findItem(name)) throw new ApiError(404, `component ${name} not in the catalog`);

  const body = (await req.json()) as { packs?: string[] };
  const packs = body.packs ?? [];
  const known = new Set(listStylePacks().map((p) => p.name));
  const unknown = packs.filter((p) => !known.has(p));
  if (unknown.length) throw new ApiError(400, `unknown style pack(s): ${unknown.join(", ")}`);

  const changed = setComponentAllowance(name, packs);
  return NextResponse.json({ name, changed });
});
