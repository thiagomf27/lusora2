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

// 3bis. sound packs (D48): schema-valid, the manifest names its own folder, and
//       every declared file EXISTS. A missing file would otherwise surface as a
//       render-time "music file missing" on a real video, long after the edit.
const soundPacksRoot = join(root, "contracts/sound-packs");
if (existsSync(soundPacksRoot)) {
  for (const dir of readdirSync(soundPacksRoot)) {
    const manifestPath = join(soundPacksRoot, dir, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    const pack = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (!validators.sound_pack(pack)) {
      fail(`sound-packs/${dir}: ${ajv.errorsText(validators.sound_pack.errors)}`);
      continue;
    }
    if (pack.name !== dir) fail(`sound-packs/${dir}: 'name' is ${JSON.stringify(pack.name)}, expected "${dir}"`);
    for (const [kind, entries] of [
      ["cue", pack.cues],
      ["bed", pack.beds],
    ]) {
      for (const [key, spec] of Object.entries(entries ?? {})) {
        if (!existsSync(join(soundPacksRoot, dir, spec.file)))
          fail(`sound-packs/${dir}: ${kind} '${key}' points at missing file ${spec.file}`);
      }
    }
    const cueCount = Object.keys(pack.cues ?? {}).length;
    const bedCount = Object.keys(pack.beds ?? {}).length;
    console.log(`✓ sound pack ${dir} valid (${cueCount} cues, ${bedCount} beds)`);
  }
}

// 3ter. themes and style packs are schema-valid, and every cue or bed a theme
//       NAMES exists in the pack it points at. Without this a typo surfaces as
//       a compile-stage failure on a real video; here it is a red CI line.
const themesDir = join(root, "contracts/themes");
if (existsSync(themesDir)) {
  for (const file of readdirSync(themesDir).filter((f) => f.endsWith(".json"))) {
    const theme = JSON.parse(readFileSync(join(themesDir, file), "utf8"));
    if (!validators.theme(theme)) {
      fail(`themes/${file}: ${ajv.errorsText(validators.theme.errors)}`);
      continue;
    }
    if (theme.name !== file.replace(/\.json$/, ""))
      fail(`themes/${file}: 'name' is ${JSON.stringify(theme.name)}, expected the filename`);

    const sound = theme.sound;
    if (!sound) continue;
    if (!sound.pack) {
      // naming cues with no pack to resolve them against is always a mistake
      const named = [sound.entrance, sound.transition].filter((c) => c && c !== "none");
      if (named.length || sound.per_entrance || sound.mood_beds)
        fail(`themes/${file}: sound names cues but sets no 'pack'`);
      continue;
    }
    const manifestPath = join(soundPacksRoot, sound.pack, "manifest.json");
    if (!existsSync(manifestPath)) {
      fail(`themes/${file}: sound.pack '${sound.pack}' has no manifest`);
      continue;
    }
    const pack = JSON.parse(readFileSync(manifestPath, "utf8"));
    const check = (name, where, table) => {
      if (!name || name === "none") return;
      if (!(name in (pack[table] ?? {})))
        fail(`themes/${file}: ${where} names '${name}', absent from sound pack '${sound.pack}'`);
    };
    check(sound.entrance, "sound.entrance", "cues");
    check(sound.transition, "sound.transition", "cues");
    for (const [k, v] of Object.entries(sound.per_entrance ?? {})) check(v, `per_entrance.${k}`, "cues");
    for (const [k, v] of Object.entries(sound.per_component ?? {})) check(v, `per_component.${k}`, "cues");
    for (const [k, v] of Object.entries(sound.mood_beds ?? {})) check(v, `mood_beds.${k}`, "beds");
    console.log(`✓ theme ${theme.name} sound resolves against '${sound.pack}'`);
  }
}

const stylePacksDir = join(root, "contracts/style-packs");
if (existsSync(stylePacksDir)) {
  for (const file of readdirSync(stylePacksDir).filter((f) => f.endsWith(".json"))) {
    const pack = JSON.parse(readFileSync(join(stylePacksDir, file), "utf8"));
    if (!validators.style_pack(pack)) {
      fail(`style-packs/${file}: ${ajv.errorsText(validators.style_pack.errors)}`);
      continue;
    }
    if (pack.name !== file.replace(/\.json$/, ""))
      fail(`style-packs/${file}: 'name' is ${JSON.stringify(pack.name)}, expected the filename`);
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
