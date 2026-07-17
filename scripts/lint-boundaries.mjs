#!/usr/bin/env node
/**
 * Boundary lint (Core Principle + Repository Structure rules):
 * - contracts imports nothing from siblings
 * - platform and worker never import each other
 * - engine never imports platform/worker
 * - cross-package TS imports only via @lusora/contracts or @lusora/engine (platform only)
 * - worker (Python) may import lusora_contracts, never platform/engine code
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const rules = [
  { pkg: "contracts", forbidden: [/@lusora\/(engine|platform)/, /from ["'].*\.\.\/(engine|platform|worker|library)/] },
  { pkg: "engine", forbidden: [/@lusora\/platform/, /from ["'].*\.\.\/\.\.\/(platform|worker|library)/] },
  { pkg: "platform", forbidden: [/from ["'].*\.\.\/\.\.\/worker/, /lusora_worker/] },
  { pkg: "worker", forbidden: [/from platform|import platform\./, /lusora_platform/, /@lusora\//] },
];

const exts = new Set([".ts", ".tsx", ".mts", ".py"]);
const skipDirs = new Set(["node_modules", ".next", "dist", "build", "__pycache__", ".venv", ".git"]);

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (skipDirs.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (exts.has(name.slice(name.lastIndexOf(".")))) yield p;
  }
}

let failures = 0;
for (const { pkg, forbidden } of rules) {
  const dir = join(root, pkg);
  for (const file of walk(dir)) {
    const src = readFileSync(file, "utf8");
    for (const re of forbidden) {
      if (re instanceof RegExp && re.test(src)) {
        failures++;
        console.error(`✗ boundary violation in ${file.replace(root + "/", "")}: matches ${re}`);
      }
    }
  }
}

if (failures > 0) process.exit(1);
console.log("Boundaries clean.");
