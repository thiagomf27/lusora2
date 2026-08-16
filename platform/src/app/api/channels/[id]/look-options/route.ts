import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import type { ChannelConfig, StylePack, Theme } from "@lusora/contracts";
import { one } from "@/db/pool";
import { handler, requireUser, requireChannelAccess, ApiError } from "@/lib/auth";
import { loadMergedCatalog } from "@/lib/catalog";
import { repoRoot } from "@/lib/env";

type Ctx = { params: Promise<{ id: string }> };

/**
 * What this channel's theme and style pack OFFER — the menu the `look.exclude`
 * lists subtract from. Resolved server-side so the Look tab and the brand
 * profile do not each re-derive it, and so the quote statement can ask about a
 * theme / pack it has not saved yet (`?theme=`, `?style_pack=`).
 */
export const GET = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  await requireChannelAccess(user, id);

  const row = await one<{ config: ChannelConfig }>("SELECT config FROM channels WHERE id = $1", [id]);
  if (!row) throw new ApiError(404, `channel ${id} not found`);

  const url = new URL(req.url);
  const themeName = url.searchParams.get("theme") ?? row.config.theme;
  const packName = url.searchParams.get("style_pack") ?? row.config.style_pack;

  const read = <T,>(dir: string, name: string): T | null => {
    const path = join(repoRoot(), "contracts", dir, `${name}.json`);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf8")) as T;
    } catch {
      return null;
    }
  };
  const pack = read<StylePack>("style-packs", packName);
  const theme = read<Theme>("themes", themeName);

  // A pack with no allow-list allows the whole catalog; say which it is, so the
  // screen can tell the difference between "the pack picked these" and "nothing
  // has been narrowed yet".
  const allowed = pack?.overlays?.allowed_components;
  const catalog = loadMergedCatalog().items.map((i) => i.entry.name).sort();

  return NextResponse.json({
    theme: themeName,
    style_pack: packName,
    missing: [
      pack ? null : `style-packs/${packName}.json`,
      theme ? null : `themes/${themeName}.json`,
    ].filter(Boolean),
    components: allowed ?? catalog,
    componentsFromPack: !!allowed,
    transitions: pack?.transitions?.allowed ?? [],
    defaultTransition: pack?.transitions?.default ?? null,
    sfxCues: pack?.sfx?.cues ?? (pack?.sfx ? ["entrance"] : []),
    sfxEnabled: pack?.sfx?.enabled !== false,
    musicEnabled: pack?.music?.enabled !== false,
    moods: Object.keys(theme?.sound?.mood_beds ?? {}),
    soundPack: theme?.sound?.pack ?? null,
    fallbackComponent: pack?.fallback?.component ?? null,
  });
});
