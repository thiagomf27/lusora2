import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EDIT_MARKER,
  END_MARKER,
  checkEditPaste,
  editPassLogPath,
  logCheck,
  materializeEditPaste,
  splitEditPaste,
  validateScript,
} from "../src/lib/editPaste.ts";
import { loadMergedCatalog } from "../src/lib/catalog.ts";
import { repoRoot } from "../src/lib/env.ts";

/**
 * The directed-edit paste box (docs/05-roadmap/directed-edit-test.md, slice 3):
 * split, check, log, write. Built on the block and script of the first hand
 * run, so the happy path is a real edit pass.
 */
const fixtures = join(repoRoot(), "contracts/fixtures");
const rules = JSON.parse(readFileSync(join(fixtures, "rules/edit_hints_rules.json"), "utf8"));
const block = readFileSync(join(fixtures, "edit_hints.json"), "utf8");
const script: string = rules.script;

const coreNames = loadMergedCatalog()
  .items.filter((i) => (i.entry.pack ?? "core") === "core")
  .map((i) => i.entry.name);
const testChannel = {
  style_pack: "directed-test",
  component_pack: "basic",
  look: { exclude: { components: coreNames } },
};

const paste = (body: string, head = script) => `${head}\n\n${EDIT_MARKER}\n${body}\n${END_MARKER}\n`;

// ---------------- split ----------------

test("the paste splits into the script and the block", () => {
  const split = splitEditPaste(paste(block));
  assert.ok(split.ok);
  assert.equal(split.value.script, script);
  assert.deepEqual(JSON.parse(split.value.blockText), JSON.parse(block));
});

test("fences, CRLF and commentary after the end marker are tolerated", () => {
  const wrapped = `${script}\r\n\r\n\`\`\`\r\n${EDIT_MARKER}\r\n\`\`\`json\r\n${block}\r\n\`\`\`\r\n${END_MARKER}\r\n\`\`\`\r\nHope this helps!`;
  const split = splitEditPaste(wrapped);
  assert.ok(split.ok, JSON.stringify(split));
  assert.equal(split.value.script, script);
  assert.deepEqual(JSON.parse(split.value.blockText), JSON.parse(block));
});

test("a paste with no marker, two markers, no end or no script is refused with the reason", () => {
  const cases: [string, string][] = [
    [script, "no ===LUSORA EDIT v1=== line"],
    [paste(block) + paste(block), "appears 2 times"],
    [`${script}\n${EDIT_MARKER}\n${block}\n`, "no ===END=== line"],
    [paste(block, ""), "the script goes first"],
    [paste(""), "is empty"],
  ];
  for (const [text, needle] of cases) {
    const split = splitEditPaste(text);
    assert.ok(!split.ok && split.error.includes(needle), `${needle}: ${JSON.stringify(split)}`);
  }
});

// ---------------- the script's rules ----------------

const scriptRules = JSON.parse(readFileSync(join(fixtures, "rules/script_rules.json"), "utf8"));
for (const rule of scriptRules.cases as { name: string; text: string; expect: string[] }[]) {
  test(`script rules: ${rule.name}`, () => {
    const found = validateScript(rule.text);
    if (!rule.expect.length) assert.deepEqual(found, []);
    for (const needle of rule.expect) {
      assert.ok(found.some((v) => v.includes(needle)), `${rule.name}: no "${needle}" in ${JSON.stringify(found)}`);
    }
  });
}

// ---------------- the check ----------------

test("the first hand run's paste passes, with its warnings and its numbers", () => {
  const check = checkEditPaste(paste(block), testChannel);
  assert.deepEqual(check.errors, []);
  assert.ok(check.ok);
  assert.equal(check.pasteBack, null);
  assert.ok(check.warnings.some((w) => w.includes("Número três, o ofurô")));
  assert.deepEqual(check.stats, {
    words: 262,
    estimatedSeconds: 111,
    sections: 3,
    pins: 15,
    graphics: 13,
    shots: 9,
  });
});

test("a block problem becomes a repair request for Claude", () => {
  const broken = block.replace('"Número cinco, o genkan"', '"Número cinco, a genkan"');
  const check = checkEditPaste(paste(broken), testChannel);
  assert.ok(!check.ok);
  assert.ok(check.pasteBack?.includes("not in the script"));
  assert.ok(check.pasteBack?.includes("Do not change, reprint or shorten the script"));
});

test("a script problem goes to the human and never into the repair request", () => {
  const check = checkEditPaste(paste(block, script.replace("Olha agora", "**Olha** agora")), testChannel);
  assert.ok(!check.ok);
  assert.ok(check.scriptErrors.some((e) => e.includes("markdown bold")));
  // the block is fine, so there is nothing to send Claude
  assert.equal(check.pasteBack, null);
});

test("invalid JSON is Claude's to fix", () => {
  const check = checkEditPaste(paste(block.replace(/}\s*$/, "")), testChannel);
  assert.ok(check.errors[0].startsWith("the block is not valid JSON"));
  assert.ok(check.pasteBack);
});

test("the menu is the channel's: a core component is refused on the basic-only test channel", () => {
  const withCore = block.replace('"component": "TextTitle"', '"component": "HammerStatement"');
  const check = checkEditPaste(paste(withCore), testChannel);
  assert.ok(check.errors.some((e) => e.includes("allowed_components")));
});

// ---------------- the round-trip log ----------------

test("an attempt is a distinct block, not a click", () => {
  const log = editPassLogPath(join(mkdtempSync(join(tmpdir(), "editpass-")), "videos"));
  const good = paste(block);
  const bad = paste(block.replace('"Número cinco, o genkan"', '"Número cinco, a genkan"'));
  assert.equal(logCheck(log, "s1", "CH", bad, checkEditPaste(bad, testChannel)), 1);
  // the same block again — a second click, not a second round-trip
  assert.equal(logCheck(log, "s1", "CH", bad, checkEditPaste(bad, testChannel)), 1);
  // editing only the SCRIPT half is not a new block either
  const badEdited = bad.replace("Olha agora", "Olhe agora");
  assert.equal(logCheck(log, "s1", "CH", badEdited, checkEditPaste(badEdited, testChannel)), 1);
  assert.equal(logCheck(log, "s1", "CH", good, checkEditPaste(good, testChannel)), 2);
  // another session counts from one
  assert.equal(logCheck(log, "s2", "CH", good, checkEditPaste(good, testChannel)), 1);
  const lines = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((l) => [l.paste_session, l.attempt, l.ok]), [["s1", 1, false], ["s1", 2, true], ["s2", 1, true]]);
});

// ---------------- into the folder ----------------

test("an accepted paste writes the script, the block and the session into the folder", () => {
  const root = mkdtempSync(join(tmpdir(), "editpass-"));
  const log = editPassLogPath(join(root, "videos"));
  const folder = join(root, "videos", "vid_x");
  const text = paste(block);
  const check = checkEditPaste(text, testChannel);
  logCheck(log, "s1", "CH", text, check);
  const written = materializeEditPaste(folder, log, "vid_x", "CH", "s1", check, new Set(["script.txt", "edit_hints.json"]));
  assert.deepEqual(written, ["script.txt", "edit_hints.json", "edit_pass.json"]);
  assert.equal(readFileSync(join(folder, "script.txt"), "utf8"), script + "\n");
  assert.equal(JSON.parse(readFileSync(join(folder, "edit_hints.json"), "utf8")).version, "1");
  assert.equal(JSON.parse(readFileSync(join(folder, "edit_pass.json"), "utf8")).attempts, 1);
  const last = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)).pop();
  assert.deepEqual([last.event, last.video_id], ["submit", "vid_x"]);
});

test("a pipeline that does not run the edit_hints stage never receives the block", () => {
  const root = mkdtempSync(join(tmpdir(), "editpass-"));
  const folder = join(root, "videos", "vid_y");
  const check = checkEditPaste(paste(block), testChannel);
  assert.throws(
    () => materializeEditPaste(folder, join(root, "log.jsonl"), "vid_y", "CH", "s1", check, new Set(["script.txt"])),
    /does not take a directed edit/
  );
  assert.ok(!existsSync(join(folder, "script.txt")), "nothing is written when the block would be ignored");
});
