/**
 * `engine catalog` — regenerate contracts/catalog.json from the registry.
 * Modes: `write` (regenerate) | `check` (CI drift gate: fail if the file
 * differs from what the registry produces).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { buildCatalog } from "./registry.ts";

const here = dirname(fileURLToPath(import.meta.url));
const catalogPath = join(here, "../../../contracts/catalog.json");

const mode = process.argv[2] ?? "check";
const generated = JSON.stringify(buildCatalog(), null, 2) + "\n";

if (mode === "write") {
  writeFileSync(catalogPath, generated);
  console.log(`wrote ${catalogPath}`);
} else {
  const current = readFileSync(catalogPath, "utf8");
  if (current !== generated) {
    console.error(
      "catalog drift: contracts/catalog.json does not match the engine registry.\n" +
        "Run `pnpm --filter @lusora/engine run catalog` and commit the result."
    );
    process.exit(1);
  }
  console.log("catalog in sync.");
}
