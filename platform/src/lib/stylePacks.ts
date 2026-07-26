/**
 * Style pack documents (contracts/style-packs/*.json) — read here, and written
 * only through `setComponentAllowance`.
 *
 * `overlays.allowed_components` is both the planner's menu filter and a
 * validate rule, so a new component that no pack lists can never appear in a
 * video. That is step 4 of "adding a component" and the easiest one to forget,
 * which is why the Overlays screen edits it directly.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StylePack } from "@lusora/contracts";
import { repoRoot } from "./env.ts";
import { validateAgainst } from "./validate.ts";

export interface StylePackRow {
  name: string;
  /** undefined = the pack allows every catalog component. */
  allowed?: string[];
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
      return { name: file.replace(/\.json$/, ""), allowed: doc.overlays?.allowed_components };
    });
}

/**
 * Add / remove one component name across the style packs, keeping each pack's
 * list sorted. Returns the packs that changed. Packs with no
 * `allowed_components` at all are left alone: they already allow everything.
 *
 * Only the `allowed_components` array is rewritten, in place. Re-serializing
 * the whole document would silently reformat a hand-edited contract file —
 * JSON.stringify turns `4.0` into `4` and collapses deliberate one-liners —
 * so every allowance toggle would carry unrelated diff noise.
 */
export function setComponentAllowance(component: string, packs: string[]): string[] {
  const want = new Set(packs);
  const changed: string[] = [];
  for (const { name, allowed } of listStylePacks()) {
    if (allowed === undefined) continue;
    const has = allowed.includes(component);
    const shouldHave = want.has(name);
    if (has === shouldHave) continue;

    const path = join(dir(), `${name}.json`);
    const text = readFileSync(path, "utf8");
    const next = shouldHave ? insert(allowed, component) : allowed.filter((c) => c !== component);

    const updated = spliceAllowedComponents(text, next);
    if (updated === null) throw new Error(`style pack ${name}: could not locate allowed_components`);

    const check = validateAgainst("style_pack", JSON.parse(updated) as StylePack);
    if (!check.ok) throw new Error(`style pack ${name} would become invalid: ${check.errors.join("; ")}`);
    writeFileSync(path, updated);
    changed.push(name);
  }
  return changed;
}

/**
 * Add a name without disturbing the existing order: alphabetical lists stay
 * alphabetical, hand-ordered ones (breakdown-fast lists by prominence) just
 * gain an entry at the end.
 */
export function insert(allowed: string[], component: string): string[] {
  const sorted = allowed.every((c, i) => i === 0 || allowed[i - 1].localeCompare(c) <= 0);
  if (!sorted) return [...allowed, component];
  const at = allowed.findIndex((c) => c.localeCompare(component) > 0);
  if (at === -1) return [...allowed, component];
  return [...allowed.slice(0, at), component, ...allowed.slice(at)];
}

/**
 * Replace the `allowed_components` array in raw JSON text, matching the
 * surrounding indentation and whether the original was written on one line.
 * Returns null if the key is not there. The array only ever holds strings, so
 * "up to the closing bracket" is an unambiguous match.
 */
export function spliceAllowedComponents(text: string, next: string[]): string | null {
  const match = /"allowed_components"(\s*):(\s*)\[([^\]]*)\]/.exec(text);
  if (!match) return null;
  const [whole, beforeColon, afterColon, body] = match;

  // indentation of the line the key sits on, so a re-emitted block lines up
  const lineStart = text.lastIndexOf("\n", match.index) + 1;
  const indent = /^[ \t]*/.exec(text.slice(lineStart))?.[0] ?? "";

  const rendered =
    body.includes("\n") && next.length > 0
      ? `[\n${next.map((n) => `${indent}  ${JSON.stringify(n)}`).join(",\n")}\n${indent}]`
      : `[${next.map((n) => JSON.stringify(n)).join(", ")}]`;
  const replacement = `"allowed_components"${beforeColon}:${afterColon}${rendered}`;
  return text.slice(0, match.index) + replacement + text.slice(match.index + whole.length);
}
