import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { componentMenu } from "../src/lib/catalog.ts";
import { repoRoot } from "../src/lib/env.ts";

/**
 * The menu is rendered by two implementations — componentMenu() here and
 * _catalog_menu() in the worker's planner agent — and they must produce the
 * same text, because they compose the same prompts for the same models.
 * contracts/fixtures/component_menu.txt is the golden file between them;
 * worker/tests/test_agents.py asserts against the same file, and the
 * fixture's own header carries the command that regenerates it.
 */
function golden(): { selection: string; authoring: string } {
  const text = readFileSync(
    join(repoRoot(), "contracts", "fixtures", "component_menu.txt"),
    "utf8"
  );
  const [before, authoring] = text.split("=== authoring ===\n");
  return {
    selection: before.split("=== selection ===\n")[1].replace(/\n+$/, ""),
    authoring: authoring.replace(/\n+$/, ""),
  };
}

test("the typescript menu is byte-identical to the golden file", () => {
  const { selection, authoring } = golden();
  assert.equal(componentMenu(), selection);
  assert.equal(componentMenu(null, { props: true }), authoring);
});

test("the selection menu carries rules, not prop schemas", () => {
  assert.ok(!componentMenu().includes("props you may hint"));
  assert.ok(componentMenu(null, { props: true }).includes("props you may hint"));
});

test("the menu never offers the emphasis prop, in either mode", () => {
  // the catalog's `emphasis` is a visual weight and the beat sheet's is an
  // overlay class (D59); one word for two meanings in one prompt is a bug
  assert.ok(!componentMenu().includes("emphasis"));
  assert.ok(!componentMenu(null, { props: true }).includes('"emphasis"'));
});

test("the menu names how long a component holds", () => {
  assert.match(componentMenu(["AnimatedCounter"]), /holds ~4s/);
});

test("the menu carries the prop description where props appear", () => {
  // the authoring craft that used to be deleted at the door
  assert.match(
    componentMenu(["AnimatedCounter"], { props: true }),
    /a label that only repeats the voice-over is noise/
  );
});

test("an allowed list filters the menu", () => {
  const menu = componentMenu(["AnimatedCounter"]);
  assert.ok(menu.includes("AnimatedCounter"));
  assert.ok(!menu.includes("QuoteBlock"));
});
