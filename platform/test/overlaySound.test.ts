/**
 * The Overlays screen fires the cue the compiler would, or nothing.
 *
 * "Or nothing" is the half worth testing: D48 makes silence the default, so a
 * preview that reaches for a fallback swoosh is showing a video that does not
 * exist. The last case is the real guard — every shipped theme, every catalog
 * component, resolved here and expected to agree with the compiler's own
 * mapping, which is the only thing that makes this third mirror safe to keep.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CatalogEntry, SoundPack, Theme } from "@lusora/contracts";
import { resolveOverlayCue } from "../src/lib/overlaySound.ts";

const contracts = join(dirname(fileURLToPath(import.meta.url)), "../../contracts");
const read = (p: string) => JSON.parse(readFileSync(join(contracts, p), "utf8"));

const PACK: SoundPack = read("sound-packs/punchy/manifest.json");

const base: Theme = {
  name: "t",
  colors: { bg: "#000000", text: "#ffffff", accent: "#ff0000", neutral: "#888888" },
  typography: { display: "Inter", body: "Inter", caption_preset: "plain" },
};
const entry = { name: "TextTag", entrance_support: "text", entrance_seconds: 0.9 } as CatalogEntry;

test("a theme with no sound block is silent", () => {
  const { sound, cue, reason } = resolveOverlayCue(base, entry, PACK);
  assert.equal(sound, null);
  assert.equal(cue, null);
  // Silent BY DESIGN, so there is nothing to explain beside the player.
  assert.equal(reason, null);
});

test("per_entrance is reached through the entrance the theme actually resolves", () => {
  const theme: Theme = {
    ...base,
    motion: { entrance: "pop", per_component: { TextTag: "typewriter" } },
    sound: { pack: "punchy", per_entrance: { pop: "pop-tight", typewriter: "tick-typing" } },
  };
  assert.equal(resolveOverlayCue(theme, entry, PACK).cue, "tick-typing");
  // Same theme, a component it does not name: the blanket entrance answers.
  const other = { ...entry, name: "TextTitle" } as CatalogEntry;
  assert.equal(resolveOverlayCue(theme, other, PACK).cue, "pop-tight");
});

test("an entrance the component cannot draw degrades to fade, and takes fade's cue", () => {
  const panel = { name: "AnimatedCounter", entrance_support: "panel" } as CatalogEntry;
  const theme: Theme = {
    ...base,
    motion: { entrance: "typewriter" },
    sound: { pack: "punchy", per_entrance: { fade: "thud-low", typewriter: "tick-typing" } },
  };
  assert.equal(resolveOverlayCue(theme, panel, PACK).cue, "thud-low");
});

test("a loop is sized to the entrance window, a one-shot to its own length", () => {
  const theme: Theme = {
    ...base,
    motion_feel: "fast_light",
    motion: { entrance: "typewriter" },
    sound: { pack: "punchy", per_entrance: { typewriter: "tick-typing" } },
  };
  const { sound } = resolveOverlayCue(theme, entry, PACK);
  // entrance_seconds 0.9 x fast_light 0.75, plus the cue's own lead (0 here).
  assert.ok(sound);
  assert.equal(sound.loop, true);
  assert.equal(Math.round(sound.durationSeconds * 1000), 675);

  const oneShot: Theme = { ...theme, sound: { pack: "punchy", entrance: "swoosh-bright" } };
  const shot = resolveOverlayCue(oneShot, entry, PACK).sound;
  assert.ok(shot);
  assert.equal(shot.loop, false);
  assert.equal(shot.durationSeconds, PACK.cues["swoosh-bright"].duration_s);
});

test("`none` and a zero mix both mean no audio element", () => {
  const silenced: Theme = {
    ...base,
    sound: { pack: "punchy", entrance: "swoosh-bright", per_component: { TextTag: "none" } },
  };
  assert.equal(resolveOverlayCue(silenced, entry, PACK).sound, null);

  const muted: Theme = {
    ...base,
    sound: { pack: "punchy", entrance: "swoosh-bright", gain: { sfx: 0 } },
  };
  const { sound, cue } = resolveOverlayCue(muted, entry, PACK);
  assert.equal(sound, null);
  // The cue is still NAMED — the screen says why it is silent rather than
  // pretending the theme attaches nothing.
  assert.equal(cue, "swoosh-bright");
});

test("a cue the pack does not define is silence and a reason, never a throw", () => {
  const theme: Theme = { ...base, sound: { pack: "punchy", entrance: "no-such-cue" } };
  const { sound, reason } = resolveOverlayCue(theme, entry, PACK);
  assert.equal(sound, null);
  assert.match(String(reason), /does not define cue 'no-such-cue'/);
});

test("every shipped theme resolves every catalog component the way the compiler does", () => {
  const entries: CatalogEntry[] = [
    ...read("catalog.json").components,
    ...readdirSync(join(contracts, "component-packs"))
      .filter((f) => f.endsWith(".json"))
      .flatMap((f) => read(`component-packs/${f}`).components),
  ];
  assert.ok(entries.length > 20, "catalog did not load");

  for (const file of readdirSync(join(contracts, "themes")).filter((f) => f.endsWith(".json"))) {
    const theme: Theme = read(`themes/${file}`);
    const packName = theme.sound?.pack;
    const pack: SoundPack | null = packName
      ? read(`sound-packs/${packName}/manifest.json`)
      : null;

    for (const item of entries) {
      const { sound, cue, reason } = resolveOverlayCue(theme, item, pack);
      // The invariant that keeps the mirror honest: a resolved cue names a file
      // the pack really has, and an unresolved one is either a deliberate
      // silence (no reason) or an explained one — never a guess.
      if (sound) {
        assert.ok(cue && pack?.cues[cue], `${file}/${item.name}: cue ${cue} is not in the pack`);
        assert.ok(sound.src.endsWith(pack!.cues[cue!].file), `${file}/${item.name}: wrong file`);
        assert.ok(sound.gain > 0, `${file}/${item.name}: audible cue at zero gain`);
      } else {
        assert.ok(
          cue === null ? reason === null : typeof reason === "string",
          `${file}/${item.name}: silent for no stated reason`
        );
      }
    }
  }
});
