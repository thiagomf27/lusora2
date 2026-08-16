import { NextResponse } from "next/server";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { StylePack, VideoType } from "@lusora/contracts";
import { handler, requireUser } from "@/lib/auth";
import { packNames } from "@/lib/catalog";
import { repoRoot } from "@/lib/env";
import { PROMPT_ROLES, listPrompts } from "@/lib/prompts";
import { listPipelines } from "@/lib/pipelines";
import { listSoundPacks } from "@/lib/soundPacks";
import { stylePacksDir } from "@/lib/stylePacks";

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

export interface StylePackOption {
  name: string;
  /** The video type the pack implements, when it declares one. The channel
   *  form uses it to put the packs matching the chosen type first. */
  video_type?: VideoType;
}

/** Style packs carry their video type, so the picker can be narrowed. An
 *  unreadable pack still appears by name — the Style Packs screen is where
 *  its errors are shown. */
function stylePackOptions(): StylePackOption[] {
  const dir = stylePacksDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => {
      const name = file.replace(/\.json$/, "");
      try {
        const doc = JSON.parse(readFileSync(join(dir, file), "utf8")) as StylePack;
        return { name, video_type: doc.video_type };
      } catch {
        return { name };
      }
    });
}

export const GET = handler(async () => {
  await requireUser();
  let componentPacks: string[] = [];
  try {
    componentPacks = packNames();
  } catch {
    componentPacks = [];
  }
  // Prompt names per role (D42): layer 2 of the resolution ladder is a channel
  // field, so the channel form needs the list.
  const prompts = Object.fromEntries(
    PROMPT_ROLES.map((role) => [role, listPrompts(role).map((p) => p.name)])
  ) as Record<(typeof PROMPT_ROLES)[number], string[]>;

  return NextResponse.json({
    themes: listNames("themes"),
    // D60 — the stage lists a channel (or the home composer) can pin.
    pipelines: listPipelines(),
    soundPacks: listSoundPacks(),
    stylePacks: stylePackOptions(),
    componentPacks,
    prompts,
  });
});
