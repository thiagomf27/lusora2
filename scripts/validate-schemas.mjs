#!/usr/bin/env node
/**
 * CI gate: every JSON Schema in contracts/schemas compiles, and every
 * fixture in contracts/fixtures validates against its schema.
 * Also checks catalog.json entries against catalog_entry.schema.json.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemasDir = join(root, "contracts/schemas");
const fixturesDir = join(root, "contracts/fixtures");

const ajv = new Ajv2020.default({ strict: false, allErrors: true });
addFormats.default(ajv);

let failures = 0;
const fail = (msg) => {
  failures++;
  console.error(`✗ ${msg}`);
};

// 1. compile every schema
const validators = {};
for (const file of readdirSync(schemasDir)) {
  if (!file.endsWith(".schema.json")) continue;
  const schema = JSON.parse(readFileSync(join(schemasDir, file), "utf8"));
  try {
    validators[file.replace(".schema.json", "")] = ajv.compile(schema);
    console.log(`✓ compiled ${file}`);
  } catch (e) {
    fail(`${file} does not compile: ${e.message}`);
  }
}

// 2. fixtures validate
const fixtureToSchema = {
  "beat_sheet.json": "beat_sheet",
  "edit_plan.json": "edit_plan",
  "theme.json": "theme",
  "style_pack.json": "style_pack",
  "channel_config.json": "channel_config",
  "cost_event.json": "cost_event",
  "prompt.json": "prompt",
};
for (const [fixture, schemaName] of Object.entries(fixtureToSchema)) {
  const validate = validators[schemaName];
  if (!validate) {
    fail(`no validator for ${schemaName}`);
    continue;
  }
  const data = JSON.parse(readFileSync(join(fixturesDir, fixture), "utf8"));
  if (validate(data)) {
    console.log(`✓ fixture ${fixture} valid against ${schemaName}`);
  } else {
    fail(`fixture ${fixture} invalid: ${ajv.errorsText(validate.errors)}`);
  }
}

// 3. catalog entries validate
const catalog = JSON.parse(readFileSync(join(root, "contracts/catalog.json"), "utf8"));
for (const entry of catalog.components) {
  if (validators.catalog_entry(entry)) {
    console.log(`✓ catalog entry ${entry.name} valid`);
  } else {
    fail(`catalog entry ${entry.name} invalid: ${ajv.errorsText(validators.catalog_entry.errors)}`);
  }
}

// 3b. data-only component packs validate, declare their own filename, and do
//     not shadow a name the engine registry already owns
const packsDir = join(root, "contracts/component-packs");
const coreNames = new Set(catalog.components.map((c) => c.name));
const packFiles = existsSync(packsDir)
  ? readdirSync(packsDir).filter((f) => f.endsWith(".json"))
  : [];
for (const file of packFiles) {
  const pack = JSON.parse(readFileSync(join(packsDir, file), "utf8"));
  const stem = file.replace(/\.json$/, "");
  if (pack.pack !== stem) fail(`component pack ${file}: 'pack' is ${JSON.stringify(pack.pack)}, expected "${stem}"`);
  if (stem === "core") fail(`component pack ${file}: 'core' is generated from the engine registry`);
  for (const entry of pack.components ?? []) {
    if (!validators.catalog_entry(entry)) {
      fail(`${file}: entry ${entry.name} invalid: ${ajv.errorsText(validators.catalog_entry.errors)}`);
      continue;
    }
    if (entry.pack !== stem) fail(`${file}: entry ${entry.name} declares pack ${JSON.stringify(entry.pack)}`);
    if (coreNames.has(entry.name)) fail(`${file}: ${entry.name} already defined in catalog.json`);
    else {
      coreNames.add(entry.name);
      console.log(`✓ pack entry ${entry.name} (${stem}) valid`);
    }
  }
}

// 3c. prompt packs (D42): schema-valid, role matches the directory, name
//     matches the filename, every {{variable}} is one the role declares, and
//     the required ones survive into the composed (editable + welded) text.
//     A prompt that silently drops {{script}} would produce garbage that the
//     planner's repair loop cannot fix.
const promptsRoot = join(root, "contracts/prompts");
const VAR_RE = /\{\{[#/]?([a-z_][a-z0-9_]*)\}\}/g;
const usedVars = (text) => new Set([...String(text ?? "").matchAll(VAR_RE)].map((m) => m[1]));

if (existsSync(promptsRoot)) {
  const roles = JSON.parse(readFileSync(join(promptsRoot, "roles.json"), "utf8")).roles;
  const weldedText = (role, half) => {
    const path = join(promptsRoot, "welded", `${role}.${half}.txt`);
    return existsSync(path) ? readFileSync(path, "utf8") : "";
  };

  for (const [role, def] of Object.entries(roles)) {
    const known = new Set(Object.keys(def.variables));
    const dir = join(promptsRoot, role);
    if (!existsSync(dir)) {
      fail(`prompts: role '${role}' has no directory`);
      continue;
    }
    // welded blocks may only use declared variables too
    for (const half of ["system", "user"]) {
      for (const v of usedVars(weldedText(role, half))) {
        if (!known.has(v)) fail(`prompts/welded/${role}.${half}.txt: unknown variable {{${v}}}`);
      }
    }
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    if (!files.includes("default.json")) fail(`prompts/${role}: no default.json (last layer of the D44 ladder)`);

    for (const file of files) {
      const doc = JSON.parse(readFileSync(join(dir, file), "utf8"));
      const where = `prompts/${role}/${file}`;
      if (!validators.prompt(doc)) {
        fail(`${where}: ${ajv.errorsText(validators.prompt.errors)}`);
        continue;
      }
      if (doc.role !== role) fail(`${where}: role is ${JSON.stringify(doc.role)}, expected "${role}"`);
      if (doc.name !== file.replace(/\.json$/, "")) fail(`${where}: name ${JSON.stringify(doc.name)} does not match the filename`);

      const editable = new Set([...usedVars(doc.system), ...usedVars(doc.user)]);
      for (const v of editable) {
        if (!known.has(v)) fail(`${where}: unknown variable {{${v}}} (role '${role}' declares ${[...known].join(", ")})`);
      }
      const composed = new Set([
        ...editable,
        ...usedVars(weldedText(role, "system")),
        ...usedVars(weldedText(role, "user")),
      ]);
      for (const [name, spec] of Object.entries(def.variables)) {
        if (spec.required && !composed.has(name)) fail(`${where}: required variable {{${name}}} is never used`);
      }
      console.log(`✓ ${where} valid`);
    }
  }
}

// 4. price table sanity
const prices = JSON.parse(readFileSync(join(root, "contracts/prices.json"), "utf8"));
for (const [provider, ops] of Object.entries(prices.prices)) {
  for (const [op, spec] of Object.entries(ops)) {
    if (op === "comment") continue;
    if (typeof spec.unit_price_usd !== "number" || spec.unit_price_usd < 0)
      fail(`prices: ${provider}.${op} has invalid unit_price_usd`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} contract violation(s)`);
  process.exit(1);
}
console.log("\nAll contracts valid.");
