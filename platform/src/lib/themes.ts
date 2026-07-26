/**
 * Theme documents live as one .json per name under contracts/themes — the
 * same files the worker snapshots into cfg.json at enqueue (lib/videos.ts).
 * There is no themes table; these helpers are the whole storage layer.
 */
import { join } from "node:path";
import { repoRoot } from "./env.ts";

/** The name is also the filename, so it must be a safe slug. */
export const THEME_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export const THEME_NAME_HINT =
  "name must be lowercase letters, digits and dashes (e.g. history-dark)";

export function themesDir(): string {
  return join(repoRoot(), "contracts", "themes");
}

export function themePath(name: string): string {
  if (!THEME_NAME_RE.test(name)) throw new Error(THEME_NAME_HINT);
  return join(themesDir(), `${name}.json`);
}

export function serializeTheme(theme: unknown): string {
  return JSON.stringify(theme, null, 2) + "\n";
}
