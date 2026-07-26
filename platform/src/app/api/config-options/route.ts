import { NextResponse } from "next/server";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { handler, requireUser } from "@/lib/auth";
import { packNames } from "@/lib/catalog";
import { repoRoot } from "@/lib/env";

/** Enumerable channel-config options sourced from the contracts data files:
 *  themes and style packs are one .json per name; component packs come from
 *  the merged catalog's `pack` values (core + contracts/component-packs).
 *  Providers / LLMs are small hardcoded registries mirrored in the form, so
 *  they are not returned here. */
function listNames(dir: string): string[] {
  const full = join(repoRoot(), "contracts", dir);
  if (!existsSync(full)) return [];
  return readdirSync(full)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

export const GET = handler(async () => {
  await requireUser();
  let componentPacks: string[] = [];
  try {
    componentPacks = packNames();
  } catch {
    componentPacks = [];
  }
  return NextResponse.json({
    themes: listNames("themes"),
    stylePacks: listNames("style-packs"),
    componentPacks,
  });
});
