/**
 * The template kinds live in three places: the engine registry (what can
 * actually be drawn), catalog_entry.schema.json (what an entry may declare) and
 * edit_plan.schema.json (what the compiler may emit). A kind present in one but
 * not the others either cannot be authored or cannot be rendered — both fail
 * quietly, which is exactly what this catches.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TEMPLATES, TEMPLATE_KINDS, isTemplateKind } from "../src/components/templates/registry.ts";

const contracts = join(dirname(fileURLToPath(import.meta.url)), "../../contracts");
const readSchema = (name: string) =>
  JSON.parse(readFileSync(join(contracts, "schemas", `${name}.schema.json`), "utf8"));

test("template kinds match both schemas", () => {
  const kinds = [...TEMPLATE_KINDS].sort();
  assert.deepEqual(Object.keys(TEMPLATES).sort(), kinds, "registry keys vs TEMPLATE_KINDS");

  const entryEnum = readSchema("catalog_entry").properties.template.enum as string[];
  assert.deepEqual([...entryEnum].sort(), kinds, "catalog_entry.schema.json template enum");

  const planEnum = readSchema("edit_plan").$defs.overlayItem.properties.template.enum as string[];
  assert.deepEqual([...planEnum].sort(), kinds, "edit_plan.schema.json overlay template enum");
});

test("every template is authorable and previewable", () => {
  for (const kind of TEMPLATE_KINDS) {
    const def = TEMPLATES[kind];
    assert.ok(def.label && def.summary, `${kind}: needs a label and summary`);
    assert.ok(def.when_to_use && def.when_not_to_use, `${kind}: needs seed selection rules`);

    const vocabulary = Object.keys(def.props);
    assert.ok(vocabulary.length > 0, `${kind}: no props`);

    // a required prop with no anchor source must be something the author can type
    for (const [name, spec] of Object.entries(def.props)) {
      if (!spec.required) continue;
      assert.ok(
        spec.type !== undefined || spec.enum !== undefined || spec.from_anchor !== undefined,
        `${kind}.${name}: required prop with no type`
      );
    }

    // the sample must be renderable: only known props, and every required one
    const unknown = Object.keys(def.sample).filter((k) => !vocabulary.includes(k));
    assert.deepEqual(unknown, [], `${kind}: sample props outside the vocabulary`);
    const missing = Object.entries(def.props)
      .filter(([k, spec]) => spec.required && !(k in def.sample))
      .map(([k]) => k);
    assert.deepEqual(missing, [], `${kind}: sample misses required props`);

    assert.ok(
      def.duration_hint_s.default >= def.duration_hint_s.min,
      `${kind}: default duration below min`
    );
  }
});

test("isTemplateKind rejects anything else", () => {
  assert.ok(isTemplateKind("card"));
  assert.ok(!isTemplateKind("Card"));
  assert.ok(!isTemplateKind(undefined));
  assert.ok(!isTemplateKind("FactCard"));
});

test("core entries never declare a template", async () => {
  const { CORE_COMPONENTS } = await import("../src/catalog/registry.ts");
  const withTemplate = CORE_COMPONENTS.filter((c) => c.template !== undefined).map((c) => c.name);
  assert.deepEqual(withTemplate, [], "core components are code-backed");
});
