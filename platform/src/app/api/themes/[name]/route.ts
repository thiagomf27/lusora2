import { NextResponse } from "next/server";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Theme } from "@lusora/contracts";
import { handler, requireUser, requireRole, ApiError } from "@/lib/auth";
import { THEME_NAME_HINT, THEME_NAME_RE, serializeTheme, themePath } from "@/lib/themes";
import { validateAgainst } from "@/lib/validate";

type Ctx = { params: Promise<{ name: string }> };

function pathFor(name: string): string {
  if (!THEME_NAME_RE.test(name)) throw new ApiError(400, THEME_NAME_HINT);
  const path = themePath(name);
  if (!existsSync(path)) throw new ApiError(404, `theme ${name} not found`);
  return path;
}

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  await requireUser();
  const { name } = await ctx.params;
  return NextResponse.json(JSON.parse(readFileSync(pathFor(name), "utf8")));
});

/** Overwrite a theme document in place. The name is the filename, so it
 *  cannot change here — renaming would silently break the channels that
 *  reference it by name. Videos already enqueued keep their own snapshot
 *  (cfg.json theme_doc), so an edit only affects future enqueues. */
export const PUT = handler(async (req: Request, ctx: Ctx) => {
  await requireRole("manager");
  const { name } = await ctx.params;
  const path = pathFor(name);
  const theme: Theme = await req.json();

  if (theme?.name !== name) {
    throw new ApiError(400, `name cannot change (${name} → ${theme?.name}); create a new theme instead`);
  }
  const check = validateAgainst("theme", theme);
  if (!check.ok) throw new ApiError(400, `theme invalid: ${check.errors.join("; ")}`);

  writeFileSync(path, serializeTheme(theme));
  return NextResponse.json({ name });
});
