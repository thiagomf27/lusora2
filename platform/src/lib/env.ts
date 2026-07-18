/**
 * Loads the repo-root .env (D26: one shared file for platform + worker).
 * Tiny parser, no dependency; existing process.env vars win.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      for (const line of readFileSync(candidate, "utf8").split("\n")) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        const [, key, raw] = m;
        if (process.env[key] !== undefined) continue;
        process.env[key] = raw.replace(/^["']|["']$/g, "");
      }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

export function requireEnv(name: string): string {
  loadEnv();
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

/** Repo root (the directory holding pnpm-workspace.yaml). */
export function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("repo root not found (pnpm-workspace.yaml)");
}
