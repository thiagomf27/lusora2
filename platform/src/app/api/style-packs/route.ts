import { NextResponse } from "next/server";
import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StylePack } from "@lusora/contracts";
import { query } from "@/db/pool";
import { handler, requireUser, requireRole, grantedChannelIds, ApiError } from "@/lib/auth";
import {
  STYLE_PACK_NAME_HINT,
  STYLE_PACK_NAME_RE,
  serializeStylePack,
  stylePackPath,
  stylePacksDir,
} from "@/lib/stylePacks";
import { validateAgainst } from "@/lib/validate";

/** List / create style pack documents. Single-pack update: ./[name]/route.ts */

export interface StylePackDocRow {
  name: string;
  doc: StylePack | null;
  errors: string[];
  channels: { id: string; name: string }[];
}

export const GET = handler(async () => {
  const user = await requireUser();
  const granted = await grantedChannelIds(user);
  const channels =
    granted === "all"
      ? await query<{ id: string; name: string; style_pack: string }>(
          "SELECT id, name, style_pack FROM channels ORDER BY name"
        )
      : await query<{ id: string; name: string; style_pack: string }>(
          "SELECT id, name, style_pack FROM channels WHERE id = ANY($1) ORDER BY name",
          [granted]
        );

  const dir = stylePacksDir();
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];
  const rows: StylePackDocRow[] = files.map((file) => {
    const name = file.replace(/\.json$/, "");
    const row: StylePackDocRow = {
      name,
      doc: null,
      errors: [],
      channels: channels
        .filter((c) => c.style_pack === name)
        .map(({ id, name: n }) => ({ id, name: n })),
    };
    try {
      const doc = JSON.parse(readFileSync(join(dir, file), "utf8")) as StylePack;
      const check = validateAgainst("style_pack", doc);
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
  const pack: StylePack = await req.json();

  if (typeof pack?.name !== "string" || !STYLE_PACK_NAME_RE.test(pack.name)) {
    throw new ApiError(400, STYLE_PACK_NAME_HINT);
  }
  const check = validateAgainst("style_pack", pack);
  if (!check.ok) throw new ApiError(400, `style pack invalid: ${check.errors.join("; ")}`);

  const path = stylePackPath(pack.name);
  if (existsSync(path)) throw new ApiError(409, `style pack ${pack.name} already exists`);

  writeFileSync(path, serializeStylePack(pack));
  return NextResponse.json({ name: pack.name }, { status: 201 });
});
