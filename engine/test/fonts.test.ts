/**
 * The packaged faces (D70): the generated module must match the directory, and
 * every family a shipped theme names must actually be in it.
 *
 * The second check is the one that matters. Before D70 nothing packaged fonts
 * at all, so a theme could name any family and the render fell back to whatever
 * the machine had — two themes with different type voices came out in the same
 * two faces, silently. A theme naming an unpackaged family still renders, and
 * still renders WRONG, so this has to be a test rather than a runtime error.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { FONT_FACE_CSS, PACKAGED_FAMILIES } from "../src/themes/fonts.generated.ts";

const engineRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(engineRoot, "..");

const familyOf = (file: string) =>
  basename(file, ".woff2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();

test("fonts.generated.ts is in sync with engine/fonts", () => {
  const onDisk = readdirSync(join(engineRoot, "fonts"))
    .filter((f) => f.endsWith(".woff2"))
    .sort()
    .map(familyOf);
  assert.deepEqual([...PACKAGED_FAMILIES], onDisk, "run `node scripts/pack-fonts.mjs`");

  const before = readFileSync(join(engineRoot, "src/themes/fonts.generated.ts"), "utf8");
  execFileSync("node", [join(engineRoot, "scripts/pack-fonts.mjs")], { stdio: "pipe" });
  const after = readFileSync(join(engineRoot, "src/themes/fonts.generated.ts"), "utf8");
  assert.equal(after, before, "fonts.generated.ts drifted — run `node scripts/pack-fonts.mjs`");
});

test("every face is inlined, not linked", () => {
  for (const family of PACKAGED_FAMILIES) {
    assert.match(FONT_FACE_CSS, new RegExp(`font-family:'${family}'`), `${family} has no @font-face`);
  }
  // A render must not need the network, and a face that arrives late renders
  // the first frames in the fallback.
  assert.equal(FONT_FACE_CSS.includes("http"), false, "a @font-face src points off-machine");
  assert.equal(
    (FONT_FACE_CSS.match(/data:font\/woff2;base64,/g) ?? []).length,
    PACKAGED_FAMILIES.length
  );
});

test("every shipped theme names a packaged family", () => {
  const dir = join(repoRoot, "contracts/themes");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const theme = JSON.parse(readFileSync(join(dir, file), "utf8"));
    for (const role of ["display", "body"] as const) {
      assert.ok(
        (PACKAGED_FAMILIES as readonly string[]).includes(theme.typography[role]),
        `${file}: typography.${role} is "${theme.typography[role]}", which engine/fonts does not carry — ` +
          `it will render in the fallback stack instead`
      );
    }
  }
});
