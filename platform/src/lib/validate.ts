/**
 * Ajv validators over the contracts schemas. Collect ALL violations
 * (Core Principle 5) — callers surface the full list.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { ValidateFunction } from "ajv";
import { repoRoot } from "./env.ts";

const g = globalThis as unknown as { __lusoraAjv?: Map<string, ValidateFunction> };
const cache = (g.__lusoraAjv ??= new Map());

function ajv() {
  const instance = new (Ajv2020 as unknown as { default: typeof Ajv2020 }).default({
    strict: false,
    allErrors: true,
    useDefaults: false,
  });
  (addFormats as unknown as { default: typeof addFormats }).default(instance);
  return instance;
}

export function getValidator(schemaName: string): ValidateFunction {
  let v = cache.get(schemaName);
  if (!v) {
    const schema = JSON.parse(
      readFileSync(join(repoRoot(), "contracts/schemas", `${schemaName}.schema.json`), "utf8")
    );
    v = ajv().compile(schema);
    cache.set(schemaName, v);
  }
  return v;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateAgainst(schemaName: string, data: unknown): ValidationResult {
  const v = getValidator(schemaName);
  const ok = v(data) as boolean;
  return {
    ok,
    errors: ok
      ? []
      : (v.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim()),
  };
}
