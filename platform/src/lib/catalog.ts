/**
 * The component catalog, as the platform sees it: the generated `core` pack
 * (contracts/catalog.json, owned by engine/src/catalog/registry.ts) merged
 * with the data-only packs in contracts/component-packs/.
 *
 * Mirrors lusora_contracts.load_catalog() on the Python side — the planner and
 * validator read the same merged list. Core entries are read-only here: they
 * are generated, and `engine catalog:check` fails on drift.
 */
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CatalogEntry } from "@lusora/contracts";
import {
  TEMPLATES,
  isTemplateKind,
  templateVocabulary,
} from "@lusora/engine/src/components/templates/registry.ts";
import { repoRoot } from "./env.ts";
import { validateAgainst } from "./validate.ts";

export const PACK_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
export const COMPONENT_NAME_RE = /^[A-Z][A-Za-z0-9]*$/;

export const CORE_SOURCE = "catalog.json";

export interface ComponentPack {
  pack: string;
  components: CatalogEntry[];
}

export interface CatalogItem {
  entry: CatalogEntry;
  /** "catalog.json" for core, else the pack filename. */
  source: string;
  /** Core entries come from the engine registry and cannot be edited here. */
  editable: boolean;
  /** What will actually draw it; null means nothing will. */
  renderedBy: "component" | "template" | null;
  /** Convenience for the UI: renderedBy !== null. */
  implemented: boolean;
  /** Schema violations for this entry (data packs only — core is CI-gated). */
  errors: string[];
}

export interface MergedCatalog {
  version: string;
  items: CatalogItem[];
  /** Pack names that exist as data files (excludes core). */
  dataPacks: string[];
  /** Whole-file problems: bad JSON, wrong `pack`, duplicate names. */
  loadErrors: string[];
}

function packsDir(): string {
  return join(repoRoot(), "contracts", "component-packs");
}

export function packPath(pack: string): string {
  if (!PACK_NAME_RE.test(pack) || pack === "core") throw new Error(`invalid pack name: ${pack}`);
  return join(packsDir(), `${pack}.json`);
}

export function readPack(pack: string): ComponentPack {
  const path = packPath(pack);
  if (!existsSync(path)) return { pack, components: [] };
  return JSON.parse(readFileSync(path, "utf8")) as ComponentPack;
}

export function writePack(data: ComponentPack): void {
  const path = packPath(data.pack);
  if (data.components.length === 0) {
    // an empty pack file would just be a load-time question mark
    if (existsSync(path)) unlinkSync(path);
    return;
  }
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

/**
 * Names registered in the engine's COMPONENTS map, read from the source of
 * engine/src/components/index.ts rather than imported — the same trick
 * engine/test/catalog.test.ts uses, and it keeps Remotion out of this process.
 * A catalog entry without one renders nothing (Composition.tsx returns null).
 */
export function implementedComponents(): string[] {
  const path = join(repoRoot(), "engine", "src", "components", "index.ts");
  if (!existsSync(path)) return [];
  const block = /export const COMPONENTS[^=]*=\s*\{([^}]*)\}/.exec(readFileSync(path, "utf8"));
  if (!block) return [];
  return block[1]
    .split(",")
    .map((line) => line.trim())
    .filter((line) => /^[A-Z][A-Za-z0-9]*$/.test(line));
}

export function loadMergedCatalog(): MergedCatalog {
  const core = JSON.parse(
    readFileSync(join(repoRoot(), "contracts", "catalog.json"), "utf8")
  ) as { version: string; components: CatalogEntry[] };
  const implemented = new Set(implementedComponents());

  const drawnBy = (entry: CatalogEntry): CatalogItem["renderedBy"] =>
    implemented.has(entry.name) ? "component" : isTemplateKind(entry.template) ? "template" : null;

  const items: CatalogItem[] = core.components.map((entry) => ({
    entry,
    source: CORE_SOURCE,
    editable: false,
    renderedBy: drawnBy(entry),
    implemented: drawnBy(entry) !== null,
    errors: [],
  }));
  const seen = new Map(items.map((i) => [i.entry.name, i.source]));
  const dataPacks: string[] = [];
  const loadErrors: string[] = [];

  const dir = packsDir();
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];
  for (const file of files) {
    const stem = file.replace(/\.json$/, "");
    let pack: ComponentPack;
    try {
      pack = JSON.parse(readFileSync(join(dir, file), "utf8")) as ComponentPack;
    } catch (e) {
      loadErrors.push(`${file}: ${e instanceof Error ? e.message : "unreadable"}`);
      continue;
    }
    if (pack.pack !== stem) {
      loadErrors.push(`${file}: 'pack' is ${JSON.stringify(pack.pack)}, expected "${stem}"`);
      continue;
    }
    dataPacks.push(stem);
    for (const entry of pack.components ?? []) {
      const previous = seen.get(entry.name);
      if (previous) {
        loadErrors.push(`${file}: ${entry.name} already defined in ${previous}`);
        continue;
      }
      seen.set(entry.name, file);
      const check = validateAgainst("catalog_entry", entry);
      const errors = [...check.errors];
      if (entry.pack !== stem) errors.push(`pack must be "${stem}"`);
      items.push({
        entry,
        source: file,
        editable: true,
        renderedBy: drawnBy(entry),
        implemented: drawnBy(entry) !== null,
        errors,
      });
    }
  }

  items.sort((a, b) => a.entry.name.localeCompare(b.entry.name));
  return { version: core.version, items, dataPacks, loadErrors };
}

/**
 * Validate a whole pack's worth of entries: schema, name shape, declared pack,
 * and collisions against everything already in the catalog. `ignoreNames` are
 * the entries being replaced (they may keep their own names).
 */
export function validatePackEntries(
  pack: string,
  entries: CatalogEntry[],
  ignoreNames: string[] = []
): string[] {
  const errors: string[] = [];
  if (!PACK_NAME_RE.test(pack) || pack === "core") {
    return ["pack must be a lowercase slug and cannot be 'core' (core is generated from the engine registry)"];
  }
  if (!Array.isArray(entries) || entries.length === 0) return ["the pack has no components"];

  const taken = new Map(
    loadMergedCatalog()
      .items.filter((i) => !ignoreNames.includes(i.entry.name))
      .map((i) => [i.entry.name, i.source])
  );
  const seenHere = new Set<string>();

  for (const [i, entry] of entries.entries()) {
    const where = entry?.name ? `${entry.name}` : `components[${i}]`;
    if (!entry || !COMPONENT_NAME_RE.test(entry.name ?? "")) {
      errors.push(`${where}: name must be PascalCase (e.g. FactCard)`);
      continue;
    }
    if (entry.pack !== pack) {
      errors.push(`${where}: declares pack ${JSON.stringify(entry.pack)}, expected "${pack}"`);
    }
    if (seenHere.has(entry.name)) errors.push(`${where}: listed twice in this pack`);
    seenHere.add(entry.name);
    const clash = taken.get(entry.name);
    if (clash) errors.push(`${where}: already defined in ${clash}`);

    const check = validateAgainst("catalog_entry", entry);
    for (const e of check.errors) errors.push(`${where}: ${e}`);
    for (const e of templateProblems(entry)) errors.push(`${where}: ${e}`);
  }
  return errors;
}

/**
 * A template draws a fixed set of props. An entry may declare a subset (and
 * narrow it further), but a prop the template does not read is worse than
 * useless: the planner would fill it and nothing would show.
 */
export function templateProblems(entry: CatalogEntry): string[] {
  if (entry.template === undefined) return [];
  if (!isTemplateKind(entry.template)) {
    return [`unknown template ${JSON.stringify(entry.template)}`];
  }
  const vocabulary = templateVocabulary(entry.template);
  const unknown = Object.keys(entry.props ?? {}).filter((p) => !vocabulary.includes(p));
  if (unknown.length === 0) return [];
  return [
    `template "${entry.template}" does not read ${unknown.join(", ")} — it draws ${vocabulary.join(", ")}`,
  ];
}

/** Template definitions, for the authoring form and the previews. */
export function templateCatalog() {
  return Object.entries(TEMPLATES).map(([kind, def]) => ({ kind, ...def }));
}

/** Locate an entry across core + data packs. */
export function findItem(name: string): CatalogItem | null {
  return loadMergedCatalog().items.find((i) => i.entry.name === name) ?? null;
}

/** Merged component menu for the editor chat agent's prompt. */
export function componentMenu(): string {
  return loadMergedCatalog()
    .items.map(
      ({ entry }) =>
        `- ${entry.name} (anchors: ${entry.anchor_types.join("/") || "pure text"}): ${entry.when_to_use}`
    )
    .join("\n");
}

/** Pack names offered as `component_pack` in channel config (core + data). */
export function packNames(): string[] {
  const merged = loadMergedCatalog();
  return [...new Set(merged.items.map((i) => i.entry.pack))].sort();
}
