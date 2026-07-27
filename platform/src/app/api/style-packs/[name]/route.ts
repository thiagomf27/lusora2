import { NextResponse } from "next/server";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import type { StylePack } from "@lusora/contracts";
import { query } from "@/db/pool";
import { handler, requireUser, requireRole, ApiError } from "@/lib/auth";
import {
  STYLE_PACK_NAME_HINT,
  STYLE_PACK_NAME_RE,
  serializeStylePack,
  stylePackPath,
} from "@/lib/stylePacks";
import { validateAgainst } from "@/lib/validate";

type Ctx = { params: Promise<{ name: string }> };

function pathFor(name: string): string {
  if (!STYLE_PACK_NAME_RE.test(name)) throw new ApiError(400, STYLE_PACK_NAME_HINT);
  const path = stylePackPath(name);
  if (!existsSync(path)) throw new ApiError(404, `style pack ${name} not found`);
  return path;
}

/** Channels are scoped by grant on the list route, but a reference from a
 *  channel the caller cannot see still blocks a delete — the file is global. */
async function referencedBy(name: string): Promise<string[]> {
  const rows = await query<{ name: string }>(
    "SELECT name FROM channels WHERE style_pack = $1 ORDER BY name",
    [name]
  );
  return rows.map((r) => r.name);
}

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  await requireUser();
  const { name } = await ctx.params;
  return NextResponse.json(JSON.parse(readFileSync(pathFor(name), "utf8")));
});

/** Overwrite a style pack document in place. The name is the filename, so it
 *  cannot change here — renaming would silently break the channels that
 *  reference it by name. Videos already enqueued keep their own snapshot
 *  (cfg.json style_pack_doc), so an edit only affects future enqueues.
 *
 *  This rewrites the whole file, so a pack saved here is normalized to
 *  JSON.stringify formatting once. Allowance toggles from the Overlays screen
 *  still go through setComponentAllowance, which splices in place. */
export const PUT = handler(async (req: Request, ctx: Ctx) => {
  await requireRole("manager");
  const { name } = await ctx.params;
  const path = pathFor(name);
  const pack: StylePack = await req.json();

  if (pack?.name !== name) {
    throw new ApiError(
      400,
      `name cannot change (${name} → ${pack?.name}); create a new style pack instead`
    );
  }
  const check = validateAgainst("style_pack", pack);
  if (!check.ok) throw new ApiError(400, `style pack invalid: ${check.errors.join("; ")}`);

  writeFileSync(path, serializeStylePack(pack));
  return NextResponse.json({ name });
});

export const DELETE = handler(async (_req: Request, ctx: Ctx) => {
  await requireRole("manager");
  const { name } = await ctx.params;
  const path = pathFor(name);

  const used = await referencedBy(name);
  if (used.length > 0) {
    throw new ApiError(409, `style pack ${name} is used by ${used.join(", ")}`);
  }

  unlinkSync(path);
  return NextResponse.json({ name, deleted: true });
});
