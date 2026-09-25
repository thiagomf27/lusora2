import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { locatePhrase, scriptSpan, validateEditHints } from "../src/lib/editHints.ts";
import { compareKey, tokenize } from "../src/lib/textmatch.ts";
import { repoRoot } from "../src/lib/env.ts";

/**
 * The directed-edit block (docs/05-roadmap/directed-edit-test.md, slice 1).
 *
 * The cases come from contracts/fixtures/rules/edit_hints_rules.json, and
 * worker/tests/test_edit_hints.py asserts the same table against the Python
 * implementation, so the paste box and the worker cannot disagree about a
 * block. `worker_only` cases need Python-side tables and are skipped here.
 */
interface RuleCase {
  name: string;
  set?: Record<string, unknown>;
  style_set?: Record<string, unknown>;
  duration_s?: number;
  worker_only?: boolean;
  expect: string[];
  warn?: string[];
}

const fixtures = join(repoRoot(), "contracts/fixtures");
const table = JSON.parse(readFileSync(join(fixtures, "rules/edit_hints_rules.json"), "utf8")) as {
  script: string;
  style: Record<string, unknown>;
  base_fixture: string;
  cases: RuleCase[];
};
const base = JSON.parse(readFileSync(join(fixtures, table.base_fixture), "utf8"));

/** The table's `set`: dotted paths, numeric segments index arrays, null deletes. */
function apply<T>(doc: T, changes: Record<string, unknown>): T {
  const out = structuredClone(doc) as Record<string, unknown>;
  for (const [path, value] of Object.entries(changes)) {
    const keys = path.split(".");
    const last = keys.pop()!;
    let node: unknown = out;
    for (const key of keys) {
      node = Array.isArray(node) ? node[Number(key)] : (node as Record<string, unknown>)[key];
    }
    if (Array.isArray(node)) node[Number(last)] = value;
    else if (value === null) delete (node as Record<string, unknown>)[last];
    else (node as Record<string, unknown>)[last] = value;
  }
  return out as T;
}

for (const rule of table.cases) {
  test(`edit hint rules: ${rule.name}`, { skip: rule.worker_only ? "worker-only check" : false }, () => {
    const hints = apply(base, rule.set ?? {});
    const cfg = { style_pack_doc: apply(table.style, rule.style_set ?? {}) };
    const { errors, warnings } = validateEditHints(hints, table.script, cfg, {
      durationS: rule.duration_s ?? null,
    });
    if (rule.expect.length === 0) assert.deepEqual(errors, [], rule.name);
    for (const needle of rule.expect) {
      assert.ok(
        errors.some((e) => e.includes(needle)),
        `${rule.name}: no error with "${needle}" in ${JSON.stringify(errors)}`
      );
    }
    for (const needle of rule.warn ?? []) {
      assert.ok(
        warnings.some((w) => w.includes(needle)),
        `${rule.name}: no warning with "${needle}" in ${JSON.stringify(warnings)}`
      );
    }
  });
}

test("the keys fold case, diacritics and punctuation the way the compiler does", () => {
  assert.equal(compareKey("Número"), "numero");
  assert.equal(compareKey("ofurô."), "ofuro");
  assert.equal(compareKey("Dr."), compareKey("doutor"));
  assert.deepEqual(tokenize("state-of-the-art R$ 5"), ["state", "of", "the", "art", "5"]);
});

test("a phrase is located as whole script words, and the script's own spelling comes back", () => {
  const [span] = locatePhrase(table.script, "numero cinco, o genkan");
  assert.equal(scriptSpan(table.script, span), "Número cinco, o genkan.");
});

test("a dash splits into its own token and the phrase still lands on words", () => {
  const script = "Em 1943, a fábrica — já sem donos — produzia asas.";
  assert.deepEqual(locatePhrase(script, "a fabrica"), [[2, 3]]);
});
