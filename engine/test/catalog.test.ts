/**
 * Registry parity: the catalog (what the planner may choose) and COMPONENTS
 * (what the Remotion path can actually draw) are two hand-maintained lists of
 * the same names. A name in one but not the other fails silently in
 * production — Composition.tsx returns null for an unknown component, so the
 * overlay simply never appears — which is exactly the kind of bug a test
 * should catch instead of a viewer.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CatalogEntry } from "@lusora/contracts";
import { CORE_COMPONENTS } from "../src/catalog/registry.ts";
import { isTemplateKind } from "../src/components/templates/registry.ts";

const here = dirname(fileURLToPath(import.meta.url));
const componentsDir = join(here, "../src/components");
const packsDir = join(here, "../../contracts/component-packs");

/**
 * The data packs (contracts/component-packs/*.json), which the planner and the
 * validator read merged with the generated core pack. An entry there is drawn
 * either by a template or — like the `archive` pack — by a React component in
 * components/<pack>, so the same parity rules apply to it.
 */
function dataPackNames(): string[] {
  if (!existsSync(packsDir)) return [];
  return readdirSync(packsDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => f.slice(0, -5));
}

function packEntries(pack: string): CatalogEntry[] {
  const file = join(packsDir, `${pack}.json`);
  if (!existsSync(file)) return [];
  const doc = JSON.parse(readFileSync(file, "utf8")) as {
    pack: string;
    components?: CatalogEntry[];
  };
  return doc.components ?? [];
}

function dataPackEntries(): CatalogEntry[] {
  return dataPackNames().flatMap(packEntries);
}

const ALL_ENTRIES = [...CORE_COMPONENTS, ...dataPackEntries()];

/** Where a pack's implementations live: core/<Name>.tsx, else <pack>/<Name>.tsx. */
function implementationPath(entry: CatalogEntry): string {
  return join(componentsDir, entry.pack === "core" ? "core" : entry.pack, `${entry.name}.tsx`);
}

/**
 * The registered names, read from the source of components/index.ts rather
 * than imported: node --experimental-strip-types cannot load .tsx, so the
 * module itself is unimportable from a test.
 */
function registeredComponents(): string[] {
  const src = readFileSync(join(componentsDir, "index.ts"), "utf8");
  const block = /export const COMPONENTS[^=]*=\s*\{([^}]*)\}/.exec(src);
  assert.ok(block, "could not find the COMPONENTS map in components/index.ts");
  return block[1]
    .split(",")
    .map((line) => line.trim())
    .filter((line) => /^[A-Z][A-Za-z0-9]*$/.test(line));
}

test("every catalog component has an implementation, and vice versa", () => {
  const implemented = registeredComponents().sort();
  assert.ok(implemented.length > 0, "no components parsed out of the registry");

  // A core entry has no other way to be drawn: `template` is reserved for data
  // packs, so a missing component means the overlay never appears.
  assert.deepEqual(
    CORE_COMPONENTS.map((c) => c.name).filter((n) => !implemented.includes(n)),
    [],
    "core catalog entries with no React component (would render nothing)"
  );
  // A pack entry may be drawn by TemplateOverlay instead of by code.
  assert.deepEqual(
    dataPackEntries()
      .filter((e) => !implemented.includes(e.name) && !isTemplateKind(e.template))
      .map((e) => e.name),
    [],
    "pack entries with neither a component nor a template (would render nothing)"
  );
  assert.deepEqual(
    implemented.filter((n) => !ALL_ENTRIES.some((e) => e.name === n)),
    [],
    "components the planner and validator cannot reach (missing catalog entry)"
  );

  for (const entry of ALL_ENTRIES) {
    if (!implemented.includes(entry.name)) continue;
    const where = entry.pack === "core" ? "core" : entry.pack;
    assert.ok(
      existsSync(implementationPath(entry)),
      `${entry.name} is registered but has no file at components/${where}/${entry.name}.tsx`
    );
  }
});

test("catalog entries are well formed", () => {
  const seen = new Set<string>();
  for (const entry of ALL_ENTRIES) {
    assert.ok(!seen.has(entry.name), `duplicate catalog entry ${entry.name} (core and packs share one namespace)`);
    seen.add(entry.name);
    assert.match(entry.name, /^[A-Z][A-Za-z0-9]*$/);
    assert.ok(entry.when_to_use.length > 0 && entry.when_not_to_use.length > 0);

    // Every prop the component accepts must be declared: the validator rejects
    // plans carrying props the catalog does not know ("unknown props").
    const props = Object.entries(entry.props);
    assert.ok(props.length > 0, `${entry.name}: no props declared`);

    // A required prop needs a source the compiler can satisfy, otherwise the
    // planner has to guess it and a miss is a hard CompileError.
    for (const [name, spec] of props) {
      if (!spec.required) continue;
      const sourced =
        spec.from_anchor !== undefined ||
        spec.computed !== undefined ||
        spec.default !== undefined ||
        spec.type === "string" ||
        spec.type === "array" ||
        spec.type === "object" ||
        spec.type === "number";
      assert.ok(sourced, `${entry.name}.${name}: required with no way to fill it`);
    }

    // anchor_types is a hard gate in the compiler: a component that declares one
    // is only ever attached to a matching anchor, so at least one prop should
    // actually read from that anchor.
    if (entry.anchor_types.length > 0) {
      const readsAnchor = props.some(
        ([, spec]) => spec.from_anchor !== undefined || spec.computed !== undefined
      );
      assert.ok(
        readsAnchor,
        `${entry.name}: declares anchor_types but no prop uses from_anchor/computed`
      );
    }
  }
});

/**
 * Sample props are shared by preview-all.mjs and the platform's Overlays
 * screen. A component with no sample previews as an empty frame, which reads
 * as "the animation is broken" rather than "nobody wrote sample props".
 */
test("every catalog component has sample props", () => {
  const file = join(dirname(fileURLToPath(import.meta.url)), "../src/catalog/sample-props.json");
  const { props } = JSON.parse(readFileSync(file, "utf8")) as {
    props: Record<string, Record<string, unknown>>;
  };
  const names = CORE_COMPONENTS.map((c) => c.name);
  assert.deepEqual(
    names.filter((n) => !(n in props)),
    [],
    "catalog components with no entry in sample-props.json"
  );
  // Core MUST have a sample; a pack entry MAY. Synthesis covers a data pack
  // whose props are all required or defaulted, but it drops every optional prop
  // that has neither — so an entry whose point IS an optional prop (a counter's
  // suffix, a lockup's second line) previews as a component nobody would ship.
  // A hand-written sample is the existing escape hatch for exactly that.
  const known = ALL_ENTRIES.map((e) => e.name);
  assert.deepEqual(
    Object.keys(props).filter((n) => !known.includes(n)),
    [],
    "sample props for components that are not in the catalog"
  );
  for (const [name, sample] of Object.entries(props)) {
    const entry = ALL_ENTRIES.find((c) => c.name === name)!;
    const unknown = Object.keys(sample).filter((k) => !(k in entry.props));
    assert.deepEqual(unknown, [], `${name}: sample props not declared in the catalog`);
    const missing = Object.entries(entry.props)
      .filter(([k, spec]) => spec.required && !(k in sample))
      .map(([k]) => k);
    assert.deepEqual(missing, [], `${name}: sample props miss required props`);
  }
});

/**
 * Collision lint: within one RESOLVED MENU, no two entries may be
 * indistinguishable to the planner.
 *
 * A resolved menu is what `applyComponentPack` hands downstream — `core` plus
 * the one pack a channel installed (D66) — so that is the unit checked here,
 * once per pack, rather than the catalog as a whole. Two entries in the same
 * menu that share all three of
 *
 *   - what DRAWS them (`template` kind, or the component name),
 *   - their prop signature,
 *   - their `anchor_types`,
 *
 * give the planner nothing to choose on. The whole catalog sits in the prompt
 * of every plan call, so a pair like that is not merely redundant: it is a coin
 * flip dressed as a decision, and it costs prompt weight in every video ever
 * rendered. `when_not_to_use` exists to remove exactly this ambiguity, and it
 * cannot when there is no difference to name.
 *
 * The lint's REACH is worth stating, because it is easy to mistake for a
 * completeness guarantee. It catches clones drawn by the same template — the
 * `doc-minimal` pack had one. It does NOT catch a restyled twin that ships its
 * own component, because two different component names are two different
 * drawing identities, and it does not catch a twin whose props were renamed
 * (`bars` for `series`) or extended by one. Those need the human test in
 * component-catalog.md — "if the props are identical, it is a theme", where a
 * renamed prop counts as the same prop — which is what retired the `archive`
 * twins in D66.
 */
function collisionKey(entry: CatalogEntry): string {
  const draws = entry.template ?? entry.name;
  const props = Object.keys(entry.props ?? {}).sort().join(",");
  const anchors = [...(entry.anchor_types ?? [])].sort().join(",");
  return `${draws} | props(${props}) | anchors(${anchors})`;
}

test("no two entries in one resolved menu are indistinguishable", () => {
  // core alone is a menu in its own right: a channel with no pack installed.
  const menus: Array<{ name: string; entries: CatalogEntry[] }> = [
    { name: "core", entries: CORE_COMPONENTS },
    ...dataPackNames().map((pack) => ({
      name: `core+${pack}`,
      entries: [...CORE_COMPONENTS, ...packEntries(pack)],
    })),
  ];

  const collisions: string[] = [];
  for (const menu of menus) {
    const byKey = new Map<string, string[]>();
    for (const entry of menu.entries) {
      const key = collisionKey(entry);
      byKey.set(key, [...(byKey.get(key) ?? []), entry.name]);
    }
    for (const [key, names] of byKey) {
      if (names.length > 1) {
        collisions.push(`${menu.name}: ${names.join(" / ")} all resolve to ${key}`);
      }
    }
  }

  assert.deepEqual(
    collisions,
    [],
    "entries the planner is choosing between at random — give one a different " +
      "shape, or delete it and reuse its sibling"
  );
});
