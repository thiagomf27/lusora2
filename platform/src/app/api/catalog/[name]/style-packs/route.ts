import { NextResponse } from "next/server";
import { handler, requireRole, ApiError } from "@/lib/auth";
import { findItem } from "@/lib/catalog";
import { listStylePacks, setPackAllowance } from "@/lib/stylePacks";

type Ctx = { params: Promise<{ name: string }> };

/**
 * Set which style packs allow this component's PACK (`overlays.allowed_packs`).
 *
 * The allowance is by pack, so this is not really about the component in the
 * URL — it is about the pack the component belongs to, and toggling it moves
 * every sibling in that pack with it. The route stays keyed on the component
 * because that is where the question gets asked (the Overlays screen, looking
 * at one component and wondering why no video ever draws it), and the response
 * says which pack was actually moved so the screen can be honest about it.
 */
export const PUT = handler(async (req: Request, ctx: Ctx) => {
  await requireRole("manager");
  const { name } = await ctx.params;
  const item = findItem(name);
  if (!item) throw new ApiError(404, `component ${name} not in the catalog`);

  const body = (await req.json()) as { packs?: string[] };
  const packs = body.packs ?? [];
  const known = new Set(listStylePacks().map((p) => p.name));
  const unknown = packs.filter((p) => !known.has(p));
  if (unknown.length) throw new ApiError(400, `unknown style pack(s): ${unknown.join(", ")}`);

  const componentPack = item.entry.pack;
  const changed = setPackAllowance(componentPack, packs);
  return NextResponse.json({ name, componentPack, changed });
});
