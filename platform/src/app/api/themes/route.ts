import { NextResponse } from "next/server";
import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Theme } from "@lusora/contracts";
import { query } from "@/db/pool";
import { handler, requireUser, requireRole, grantedChannelIds, ApiError } from "@/lib/auth";
import { THEME_NAME_HINT, THEME_NAME_RE, serializeTheme, themePath, themesDir } from "@/lib/themes";
import { validateAgainst } from "@/lib/validate";

/** List / create theme documents. Single-theme update: ./[name]/route.ts */

export interface ThemeRow {
  name: string;
  doc: Theme | null;
  errors: string[];
  channels: { id: string; name: string }[];
}

export const GET = handler(async () => {
  const user = await requireUser();
  const granted = await grantedChannelIds(user);
  const channels =
    granted === "all"
      ? await query<{ id: string; name: string; theme: string }>(
          "SELECT id, name, theme FROM channels ORDER BY name"
        )
      : await query<{ id: string; name: string; theme: string }>(
          "SELECT id, name, theme FROM channels WHERE id = ANY($1) ORDER BY name",
          [granted]
        );

  const dir = themesDir();
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];
  const rows: ThemeRow[] = files.map((file) => {
    const name = file.replace(/\.json$/, "");
    const row: ThemeRow = {
      name,
      doc: null,
      errors: [],
      channels: channels.filter((c) => c.theme === name).map(({ id, name: n }) => ({ id, name: n })),
    };
    try {
      const doc = JSON.parse(readFileSync(join(dir, file), "utf8")) as Theme;
      const check = validateAgainst("theme", doc);
      row.doc = doc;
      row.errors = check.errors;
    } catch (e) {
      row.errors = [e instanceof Error ? e.message : "unreadable"];
    }
    return row;
  });
  return NextResponse.json(rows);
});

export const POST = handler(async (req: Request) => {
  await requireRole("manager");
  const theme: Theme = await req.json();

  if (typeof theme?.name !== "string" || !THEME_NAME_RE.test(theme.name)) {
    throw new ApiError(400, THEME_NAME_HINT);
  }
  const check = validateAgainst("theme", theme);
  if (!check.ok) throw new ApiError(400, `theme invalid: ${check.errors.join("; ")}`);

  const path = themePath(theme.name);
  if (existsSync(path)) throw new ApiError(409, `theme ${theme.name} already exists`);

  writeFileSync(path, serializeTheme(theme));
  return NextResponse.json({ name: theme.name }, { status: 201 });
});
