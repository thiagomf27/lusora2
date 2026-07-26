/**
 * Ajv validators over the contracts schemas. Collect ALL violations
 * (Core Principle 5) — callers surface the full list.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { ValidateFunction } from "ajv";
import { repoRoot } from "./env.ts";

interface CachedValidator {
  validate: ValidateFunction;
  /** mtime+size of the schema file the validator was compiled from. */
  stamp: string;
}

const g = globalThis as unknown as { __lusoraAjv?: Map<string, CachedValidator> };
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

/**
 * Compiled validator for a schema, recompiled when the file changes.
 *
 * The cache used to be keyed on the name alone, which meant a long-running
 * process (a `next dev` server, or a deployed platform) kept validating against
 * whatever the schema said when it started. Editing a contract then produced
 * "must NOT have additional properties" for a field that plainly exists in the
 * file — a confusing failure that a restart "fixed". One stat() per validation
 * is cheaper than that.
 */
export function getValidator(schemaName: string): ValidateFunction {
  const path = join(repoRoot(), "contracts/schemas", `${schemaName}.schema.json`);
  const st = statSync(path);
  const stamp = `${st.mtimeMs}:${st.size}`;

  const hit = cache.get(schemaName);
  if (hit && hit.stamp === stamp) return hit.validate;

  const validate = ajv().compile(JSON.parse(readFileSync(path, "utf8")));
  cache.set(schemaName, { validate, stamp });
  return validate;
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
