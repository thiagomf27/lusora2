import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import type { ChannelConfig, SoundPack, StylePack, Theme } from "@lusora/contracts";
import { one } from "@/db/pool";
import { handler, requireUser, requireChannelAccess, ApiError } from "@/lib/auth";
import { loadMergedCatalog } from "@/lib/catalog";
import { repoRoot } from "@/lib/env";
import { readSoundPack } from "@/lib/soundPacks";

type Ctx = { params: Promise<{ id: string }> };

/** One thing a channel could use, and what stops it if anything does. */
export interface LookOffer {
  name: string;
  /** null = the pack and theme both allow it. Otherwise the document that
   *  withholds it, phrased for the screen ("style pack doc-slow"). */
  blockedBy: string | null;
  /** components only: which component pack the entry came from. */
  pack?: string;
  /** sfx cues and moods: the sound this actually plays, and where to hear it.
   *  Resolved here because it takes the theme AND the sound pack to answer. */
  sound?: { name: string; url: string | null };
}

/**
 * The universes the `look.exclude` lists subtract FROM, read out of the
 * channel-config schema itself. Reading them here rather than hardcoding a
 * second copy is what keeps a new transition kind or mood from landing in the
 * contract and staying invisible on the screen.
 */
function excludeUniverse(key: string): string[] {
  const path = join(repoRoot(), "contracts", "schemas", "channel_config.schema.json");
  try {
    const schema = JSON.parse(readFileSync(path, "utf8")) as {
      properties?: { look?: { properties?: { exclude?: { properties?: Record<string, { items?: { enum?: string[] } }> } } } };
    };
    return schema.properties?.look?.properties?.exclude?.properties?.[key]?.items?.enum ?? [];
  } catch {
    return [];
  }
}

/**
 * What this channel's theme and style pack OFFER — the menu the `look.exclude`
 * lists subtract from. Resolved server-side so the Look tab and the channel's
 * Visual tab do not each re-derive it, and so the quote statement can ask about
 * a theme / pack it has not saved yet (`?theme=`, `?style_pack=`).
 *
 * Returns the WHOLE universe with a `blockedBy` per entry, not just the allowed
 * subset: a screen that only lists what is available cannot show why the thing
 * you were looking for is not on it. Withheld and excluded are different states
 * and the editor draws them differently — one is the pack's decision and is
 * read-only here, the other is this channel's and is a click.
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
  const byPack = `style pack ${packName}`;
  const byTheme = `theme ${themeName}`;

  // A pack with no allow-list allows the whole catalog; say which it is, so the
  // screen can tell the difference between "the pack picked these" and "nothing
  // has been narrowed yet".
  const allowedPacks = pack?.overlays?.allowed_packs;
  // Allowance is by pack: within the chosen pack either everything is on the
  // menu or nothing is, so this is a single yes/no rather than a name filter.
  // `core` is never something a style pack opts into: packs are additive over
  // it, so `allowed_packs` names the EXTRA packs a style suits (see look.ts).
  const styleAllowsPack = (p: string) =>
    p === "core" || !allowedPacks || allowedPacks.length === 0 || allowedPacks.includes(p);
  const catalog = loadMergedCatalog().items.map((i) => i.entry);

  // `core` PLUS at most one installed pack — packs are additive (D66), and this
  // has to mirror `applyComponentPack` exactly or the screen reports a menu the
  // enqueue will not produce. Reported BEFORE the style pack because it is the
  // harder constraint: the style pack declining a component is an editorial
  // choice, the component not being installed is a fact.
  //
  // A present-but-empty param means the unset field, which resolves to `core`;
  // only an absent param falls back to what the channel has saved.
  const packParam = url.searchParams.get("component_pack");
  const componentPack = (packParam !== null ? packParam : row.config.component_pack) || "core";
  const installedPacks = componentPack === "core" ? ["core"] : ["core", componentPack];
  const byComponentPack = `component pack ${componentPack}`;

  const components: LookOffer[] = catalog
    .map((entry) => ({
      name: entry.name,
      pack: entry.pack,
      blockedBy: !installedPacks.includes(entry.pack)
        ? byComponentPack
        : styleAllowsPack(entry.pack)
          ? null
          : `${byPack} (allows ${allowedPacks!.join(", ")})`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // How many overlays this combination actually leaves. Zero is a configuration
  // that cannot be enqueued, and the screen says so rather than letting someone
  // find out when they queue a video.
  const usableComponents = components.filter((c) => !c.blockedBy).length;

  const packTransitions = pack?.transitions?.allowed ?? [];
  const transitions: LookOffer[] = excludeUniverse("transitions").map((name) => ({
    name,
    blockedBy: packTransitions.includes(name as never) ? null : byPack,
  }));

  // `sfx.cues` defaults to ["entrance"] in the schema, and a pack that ships
  // silent withholds every cue however the theme is written — the compiler ANDs
  // the two switches (`sound_enabled`), so the screen has to as well.
  const packCues = pack?.sfx?.cues ?? ["entrance"];
  const sfxPackEnabled = pack?.sfx?.enabled !== false;

  // The sound a row would actually make. It takes both documents to answer —
  // the theme names the cue, the pack holds the bytes — so it is resolved here
  // rather than leaving the screen to join them and get it subtly wrong.
  const soundPackName = row.config.source_policy?.sound_pack ?? theme?.sound?.pack ?? null;
  let soundDoc: SoundPack | null = null;
  if (soundPackName) {
    try {
      soundDoc = readSoundPack(soundPackName);
    } catch {
      soundDoc = null;
    }
  }
  const audio = (kind: "cues" | "beds", entry: string | undefined) => {
    if (!entry || entry === "none") return undefined;
    const file = (soundDoc?.[kind] as Record<string, { file: string }> | undefined)?.[entry]?.file;
    return {
      name: entry,
      // `file` is a relative path inside the pack ("sfx/swoosh-soft.mp3") and the
      // route is a catch-all, so encode the SEGMENTS and leave the separators.
      url: file && soundPackName
        ? `/api/sounds/${encodeURIComponent(soundPackName)}/audio/` +
          file.split("/").map(encodeURIComponent).join("/")
        : null,
    };
  };

  const sfxCues: LookOffer[] = excludeUniverse("sfx_cues").map((name) => ({
    name,
    blockedBy: !sfxPackEnabled ? byPack : packCues.includes(name as never) ? null : byPack,
    // `entrance` plays the theme's entrance cue; `transition` its transition
    // cue. `per_entrance` overrides are per component and cannot be previewed
    // by an event name, so the base cue is what is offered here.
    sound: audio("cues", name === "entrance" ? theme?.sound?.entrance : theme?.sound?.transition),
  }));

  // A mood mapped to "none" is deliberate silence in `compile_music`, which is
  // the same outcome as a mood the theme never named.
  const beds = theme?.sound?.mood_beds ?? {};
  const moods: LookOffer[] = excludeUniverse("moods").map((name) => {
    const bed = (beds as Record<string, string>)[name];
    return {
      name,
      blockedBy: bed && bed !== "none" ? null : byTheme,
      sound: audio("beds", bed),
    };
  });

  const soundPack = soundPackName;
  const musicPackEnabled = pack?.music?.enabled !== false;

  return NextResponse.json({
    theme: themeName,
    style_pack: packName,
    missing: [
      pack ? null : `style-packs/${packName}.json`,
      theme ? null : `themes/${themeName}.json`,
    ].filter(Boolean),
    componentPack,
    usableComponents,
    offers: { components, transitions, sfx_cues: sfxCues, moods },
    // Why a master switch is inert. `sound_enabled` in the compiler is an AND
    // of the channel's switch and the pack's, and neither one can conjure a
    // pack of bytes to play — so all three are reasons the toggle does nothing.
    // Whole sentences, not fragments: the screen prints them as written, which
    // is the only way "no sound pack" and "the pack ships silent" both read.
    locks: {
      sfx: !soundPack
        ? `No sound pack: the theme ${themeName} names none and this channel sets none.`
        : !sfxPackEnabled
          ? `The style pack ${packName} ships silent.`
          : null,
      music: !soundPack
        ? `No sound pack: the theme ${themeName} names none and this channel sets none.`
        : !musicPackEnabled
          ? `The style pack ${packName} turns music off.`
          : Object.keys(beds).length === 0
            ? `The theme ${themeName} defines no music beds.`
            : null,
    },
    // Retained: the plain allowed-lists, which are what `look.ts` narrows.
    components: catalog.filter((e) => e.pack === componentPack && styleAllowsPack(e.pack)).map((e) => e.name).sort(),
    componentsFromPack: !!allowedPacks,
    allowedPacks: allowedPacks ?? null,
    transitions: packTransitions,
    defaultTransition: pack?.transitions?.default ?? null,
    sfxCues: packCues,
    sfxEnabled: sfxPackEnabled,
    musicEnabled: musicPackEnabled,
    moods: Object.keys(beds),
    soundPack,
    fallbackComponent: pack?.fallback?.component ?? null,
  });
});
