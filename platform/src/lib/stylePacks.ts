/**
 * Style pack documents (contracts/style-packs/*.json) — one .json per name,
 * like themes, and the same files the worker snapshots into cfg.json as
 * `style_pack_doc` at enqueue. There is no style_packs table; these helpers
 * plus the /api/style-packs routes are the whole storage layer.
 *
 * Two write paths, deliberately: the Style Packs screen replaces a whole
 * document (`serializeStylePack`), while `setPackAllowance` below splices
 * a single array in place so toggling one component from the Overlays screen
 * never reformats four unrelated packs.
 *
 * `overlays.allowed_packs` is both the planner's menu filter and a validate
 * rule, so a component in a pack no style pack allows can never appear in a
 * video. Allowance is by PACK, not by component: "this style suits the archive
 * pack" is a statement about a body of work that does not go stale when a
 * component is added to that pack. The Overlays screen therefore edits the
 * allowance of a component's PACK, which is step 4 of "adding a component"
 * whenever the component starts a new pack.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StylePack } from "@lusora/contracts";
import { repoRoot } from "./env.ts";
import { validateAgainst } from "./validate.ts";

export interface StylePackRow {
  name: string;
  /** undefined = the style pack allows every component pack. */
  allowedPacks?: string[];
  /** D44 layer 3: the script prompt this pack's voice implies. */
  scriptPrompt?: string;
}

/** The name is also the filename, so it must be a safe slug. */
export const STYLE_PACK_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export const STYLE_PACK_NAME_HINT =
  "name must be lowercase letters, digits and dashes (e.g. doc-slow)";

export function stylePacksDir(): string {
  return dir();
}

export function stylePackPath(name: string): string {
  if (!STYLE_PACK_NAME_RE.test(name)) throw new Error(STYLE_PACK_NAME_HINT);
  return join(dir(), `${name}.json`);
}

export function serializeStylePack(pack: unknown): string {
  return JSON.stringify(pack, null, 2) + "\n";
}

function dir(): string {
  return join(repoRoot(), "contracts", "style-packs");
}

export function listStylePacks(): StylePackRow[] {
  const d = dir();
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => {
      const doc = JSON.parse(readFileSync(join(d, file), "utf8")) as StylePack;
      return {
        name: file.replace(/\.json$/, ""),
        allowedPacks: doc.overlays?.allowed_packs,
        scriptPrompt: doc.script?.prompt,
      };
    });
}

/**
 * Add / remove one COMPONENT PACK across the style packs, keeping each list
 * sorted. Returns the style packs that changed. Style packs with no
 * `allowed_packs` at all are left alone: they already allow every pack.
 *
 * Only the `allowed_packs` array is rewritten, in place. Re-serializing the
 * whole document would silently reformat a hand-edited contract file —
 * JSON.stringify turns `4.0` into `4` and collapses deliberate one-liners — so
 * every allowance toggle would carry unrelated diff noise.
 */
export function setPackAllowance(componentPack: string, stylePacks: string[]): string[] {
  const want = new Set(stylePacks);
  const changed: string[] = [];
  for (const { name, allowedPacks } of listStylePacks()) {
    if (allowedPacks === undefined) continue;
    const has = allowedPacks.includes(componentPack);
    const shouldHave = want.has(name);
    if (has === shouldHave) continue;

    const path = join(dir(), `${name}.json`);
    const text = readFileSync(path, "utf8");
    const next = shouldHave
      ? insert(allowedPacks, componentPack)
      : allowedPacks.filter((c) => c !== componentPack);
    if (next.length === 0) {
      throw new Error(
        `style pack ${name}: removing '${componentPack}' would leave it allowing no component ` +
          "pack at all — delete the allowed_packs key instead to allow every pack"
      );
    }

    const updated = spliceAllowedPacks(text, next);
    if (updated === null) throw new Error(`style pack ${name}: could not locate allowed_packs`);

    const check = validateAgainst("style_pack", JSON.parse(updated) as StylePack);
    if (!check.ok) throw new Error(`style pack ${name} would become invalid: ${check.errors.join("; ")}`);
    writeFileSync(path, updated);
    changed.push(name);
  }
  return changed;
}

/**
 * Drop a component pack from every style pack that allows it — for when the
 * pack itself is deleted.
 *
 * A style pack left allowing NOTHING is not written: an empty `allowed_packs`
 * would silently stop that style producing overlays at all, which is a worse
 * outcome than a stale name the author can see and fix. Those are returned as
 * conflicts so the caller can say so.
 */
export function removePackEverywhere(componentPack: string): {
  changed: string[];
  conflicts: string[];
} {
  const changed: string[] = [];
  const conflicts: string[] = [];
  for (const { name, allowedPacks } of listStylePacks()) {
    if (!allowedPacks?.includes(componentPack)) continue;
    const next = allowedPacks.filter((p) => p !== componentPack);
    if (next.length === 0) {
      conflicts.push(name);
      continue;
    }
    const path = join(dir(), `${name}.json`);
    const updated = spliceAllowedPacks(readFileSync(path, "utf8"), next);
    if (updated === null) throw new Error(`style pack ${name}: could not locate allowed_packs`);
    writeFileSync(path, updated);
    changed.push(name);
  }
  return { changed, conflicts };
}

/**
 * Add a name without disturbing the existing order: alphabetical lists stay
 * alphabetical, hand-ordered ones just gain an entry at the end.
 */
export function insert(allowed: string[], component: string): string[] {
  const sorted = allowed.every((c, i) => i === 0 || allowed[i - 1].localeCompare(c) <= 0);
  if (!sorted) return [...allowed, component];
  const at = allowed.findIndex((c) => c.localeCompare(component) > 0);
  if (at === -1) return [...allowed, component];
  return [...allowed.slice(0, at), component, ...allowed.slice(at)];
}

/**
 * Replace the `allowed_packs` array in raw JSON text, matching the surrounding
 * indentation and whether the original was written on one line. Returns null if
 * the key is not there. The array only ever holds strings, so "up to the
 * closing bracket" is an unambiguous match.
 */
export function spliceAllowedPacks(text: string, next: string[]): string | null {
  const match = /"allowed_packs"(\s*):(\s*)\[([^\]]*)\]/.exec(text);
  if (!match) return null;
  const [whole, beforeColon, afterColon, body] = match;

  // indentation of the line the key sits on, so a re-emitted block lines up
  const lineStart = text.lastIndexOf("\n", match.index) + 1;
  const indent = /^[ \t]*/.exec(text.slice(lineStart))?.[0] ?? "";

  const rendered =
    body.includes("\n") && next.length > 0
      ? `[\n${next.map((n) => `${indent}  ${JSON.stringify(n)}`).join(",\n")}\n${indent}]`
      : `[${next.map((n) => JSON.stringify(n)).join(", ")}]`;
  const replacement = `"allowed_packs"${beforeColon}:${afterColon}${rendered}`;
  return text.slice(0, match.index) + replacement + text.slice(match.index + whole.length);
}
