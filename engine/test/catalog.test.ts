/**
 * Registry parity: the catalog (what the planner may choose) and COMPONENTS
 * (what the Remotion path can actually draw) are two hand-maintained lists of
 * the same names. A name in one but not the other fails silently in
 * production — Composition.tsx returns null for an unknown component, so the
 * overlay simply never appears — which is exactly the kind of bug a test
 * should catch instead of a viewer.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CORE_COMPONENTS } from "../src/catalog/registry.ts";

const componentsDir = join(dirname(fileURLToPath(import.meta.url)), "../src/components");

/**
 * The registered names, read from the source of components/index.ts rather
 * than imported: node --experimental-strip-types cannot load .tsx, so the
 * module itself is unimportable from a test.
 */
function registeredComponents(): string[] {
  const src = readFileSync(join(componentsDir, "index.ts"), "utf8");
  const block = /export const COMPONENTS[^=]*=\s*\{([^}]*)\}/.exec(src);
  assert.ok(block, "could not find the COMPONENTS map in components/index.ts");
  return block[1]
    .split(",")
    .map((line) => line.trim())
    .filter((line) => /^[A-Z][A-Za-z0-9]*$/.test(line));
}

test("every catalog component has an implementation, and vice versa", () => {
  const catalog = CORE_COMPONENTS.map((c) => c.name).sort();
  const implemented = registeredComponents().sort();
  assert.ok(implemented.length > 0, "no components parsed out of the registry");
  assert.deepEqual(
    catalog.filter((n) => !implemented.includes(n)),
    [],
    "catalog entries with no React component (would render nothing)"
  );
  assert.deepEqual(
    implemented.filter((n) => !catalog.includes(n)),
    [],
    "components the planner and validator cannot reach (missing catalog entry)"
  );
  for (const name of implemented) {
    assert.ok(
      existsSync(join(componentsDir, "core", `${name}.tsx`)),
      `${name} is registered but has no file in components/core`
    );
  }
});

test("catalog entries are well formed", () => {
  const seen = new Set<string>();
  for (const entry of CORE_COMPONENTS) {
    assert.ok(!seen.has(entry.name), `duplicate catalog entry ${entry.name}`);
    seen.add(entry.name);
    assert.match(entry.name, /^[A-Z][A-Za-z0-9]*$/);
    assert.ok(entry.when_to_use.length > 0 && entry.when_not_to_use.length > 0);

    // Every prop the component accepts must be declared: the validator rejects
    // plans carrying props the catalog does not know ("unknown props").
    const props = Object.entries(entry.props);
    assert.ok(props.length > 0, `${entry.name}: no props declared`);

    // A required prop needs a source the compiler can satisfy, otherwise the
    // planner has to guess it and a miss is a hard CompileError.
    for (const [name, spec] of props) {
      if (!spec.required) continue;
      const sourced =
        spec.from_anchor !== undefined ||
        spec.computed !== undefined ||
        spec.default !== undefined ||
        spec.type === "string" ||
        spec.type === "array" ||
        spec.type === "object" ||
        spec.type === "number";
      assert.ok(sourced, `${entry.name}.${name}: required with no way to fill it`);
    }

    // anchor_types is a hard gate in the compiler: a component that declares one
    // is only ever attached to a matching anchor, so at least one prop should
    // actually read from that anchor.
    if (entry.anchor_types.length > 0) {
      const readsAnchor = props.some(
        ([, spec]) => spec.from_anchor !== undefined || spec.computed !== undefined
      );
      assert.ok(
        readsAnchor,
        `${entry.name}: declares anchor_types but no prop uses from_anchor/computed`
      );
    }
  }
});

/**
 * Sample props are shared by preview-all.mjs and the platform's Overlays
 * screen. A component with no sample previews as an empty frame, which reads
 * as "the animation is broken" rather than "nobody wrote sample props".
 */
test("every catalog component has sample props", () => {
  const file = join(dirname(fileURLToPath(import.meta.url)), "../src/catalog/sample-props.json");
  const { props } = JSON.parse(readFileSync(file, "utf8")) as {
    props: Record<string, Record<string, unknown>>;
  };
  const names = CORE_COMPONENTS.map((c) => c.name);
  assert.deepEqual(
    names.filter((n) => !(n in props)),
    [],
    "catalog components with no entry in sample-props.json"
  );
  assert.deepEqual(
    Object.keys(props).filter((n) => !names.includes(n)),
    [],
    "sample props for components that are not in the catalog"
  );
  for (const [name, sample] of Object.entries(props)) {
    const entry = CORE_COMPONENTS.find((c) => c.name === name)!;
    const unknown = Object.keys(sample).filter((k) => !(k in entry.props));
    assert.deepEqual(unknown, [], `${name}: sample props not declared in the catalog`);
    const missing = Object.entries(entry.props)
      .filter(([k, spec]) => spec.required && !(k in sample))
      .map(([k]) => k);
    assert.deepEqual(missing, [], `${name}: sample props miss required props`);
  }
});
