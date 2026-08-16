/**
 * Prompt packs (D42–D44) — the platform half. Mirrors
 * contracts/py/lusora_contracts/prompts.py; both read the same files, and
 * `contracts/prompts/roles.json` is the shared variable contract so there is
 * no mirrored list to drift.
 *
 * Two halves (D43): the editable document under `contracts/prompts/<role>/`,
 * and the welded contract block under `contracts/prompts/welded/`. Only the
 * first is writable here — the Prompts screen never offers the second, because
 * an edit to it would break the validator that judges the model's output.
 *
 * File-backed like themes and style packs (D10): git is the version history
 * and `pnpm run validate:schemas` is the CI gate.
 */
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./env.ts";
import { validateAgainst } from "./validate.ts";

export const PROMPT_ROLES = ["research", "script", "planner", "spine", "chat"] as const;
export type PromptRole = (typeof PROMPT_ROLES)[number];

export const PROMPT_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
export const PROMPT_NAME_HINT =
  "name must be lowercase letters, digits and dashes (e.g. doc-grave)";

export interface PromptDoc {
  name: string;
  role: PromptRole;
  video_type?: string;
  description?: string;
  system: string;
  user?: string;
  model_hint?: string | null;
  max_tokens?: number | null;
}

export interface RoleVariable {
  required?: boolean;
  source?: string;
}

export interface RoleDef {
  description: string;
  welded: { system: boolean; user: boolean };
  variables: Record<string, RoleVariable>;
}

/** What lands in cfg.json at enqueue: the editable half plus which layer won. */
export interface ResolvedPrompt {
  name: string;
  source: "video" | "channel" | "style_pack" | "default";
  system: string;
  user?: string;
  model_hint?: string | null;
  max_tokens?: number | null;
}

export function isPromptRole(value: unknown): value is PromptRole {
  return typeof value === "string" && (PROMPT_ROLES as readonly string[]).includes(value);
}

function dir(): string {
  return join(repoRoot(), "contracts", "prompts");
}

export function promptPath(role: PromptRole, name: string): string {
  if (!PROMPT_NAME_RE.test(name)) throw new Error(PROMPT_NAME_HINT);
  return join(dir(), role, `${name}.json`);
}

export function loadRoles(): Record<PromptRole, RoleDef> {
  const doc = JSON.parse(readFileSync(join(dir(), "roles.json"), "utf8")) as {
    roles: Record<PromptRole, RoleDef>;
  };
  return doc.roles;
}

/** The contract half; "" when this role has none for that half. */
export function weldedText(role: PromptRole, half: "system" | "user"): string {
  const path = join(dir(), "welded", `${role}.${half}.txt`);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

export function listPrompts(role?: PromptRole): PromptDoc[] {
  const roles = role ? [role] : PROMPT_ROLES;
  const out: PromptDoc[] = [];
  for (const r of roles) {
    const d = join(dir(), r);
    if (!existsSync(d)) continue;
    for (const file of readdirSync(d).filter((f) => f.endsWith(".json")).sort()) {
      out.push(JSON.parse(readFileSync(join(d, file), "utf8")) as PromptDoc);
    }
  }
  return out;
}

export function readPrompt(role: PromptRole, name: string): PromptDoc | null {
  const path = promptPath(role, name);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as PromptDoc;
}

export function writePrompt(doc: PromptDoc): void {
  writeFileSync(promptPath(doc.role, doc.name), JSON.stringify(doc, null, 2) + "\n");
}

/** `default` is the last layer of the D44 ladder — removing it would leave a
 *  channel with no prompt at all, so it is not deletable. */
export function deletePrompt(role: PromptRole, name: string): string[] {
  if (name === "default") return ["the built-in default cannot be deleted"];
  const path = promptPath(role, name);
  if (!existsSync(path)) return [`prompts/${role}/${name}.json does not exist`];
  unlinkSync(path);
  return [];
}

const SECTION_RE = /\{\{#([a-z_][a-z0-9_]*)\}\}([\s\S]*?)\{\{\/\1\}\}/g;
const VAR_RE = /\{\{([a-z_][a-z0-9_]*)\}\}/g;
const ANY_VAR_RE = /\{\{[#/]?([a-z_][a-z0-9_]*)\}\}/g;

/** Every variable name a template touches, block markers included. */
export function usedVariables(text: string | undefined): string[] {
  return [...new Set([...String(text ?? "").matchAll(ANY_VAR_RE)].map((m) => m[1]))];
}

/**
 * mustache-lite, identical to the Python side: `{{var}}` substitutes and
 * `{{#var}}…{{/var}}` keeps its body only when `var` is non-empty, so an
 * optional section takes its own label with it when the value is missing.
 */
export function render(template: string, variables: Record<string, unknown>): string {
  const present = (name: string) => {
    const v = variables[name];
    if (v === undefined || v === null || v === false || v === "") return false;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  };

  let text = String(template ?? "");
  let previous = "";
  while (previous !== text) {
    previous = text;
    text = text.replace(SECTION_RE, (_all, name: string, body: string) =>
      present(name) ? body : ""
    );
  }
  return text.replace(VAR_RE, (_all, name: string) => {
    const v = variables[name];
    if (v === undefined || v === null || v === false) return "";
    return String(v);
  });
}

/** (system, user) for one call: editable half rendered, welded half appended. */
export function compose(
  role: PromptRole,
  doc: Pick<PromptDoc, "system" | "user">,
  variables: Record<string, unknown>
): { system: string; user: string } {
  const half = (which: "system" | "user") => {
    const editable = render(doc[which] ?? "", variables).trim();
    const contract = render(weldedText(role, which), variables).trim();
    return [editable, contract].filter(Boolean).join("\n\n");
  };
  return { system: half("system"), user: half("user") };
}

/**
 * Schema + the variable contract. Unknown variables are rejected (a `{{typo}}`
 * silently renders as nothing), and a required variable that survives in
 * neither half means the model would never see the thing it is working on.
 */
export function validatePrompt(doc: PromptDoc): string[] {
  const errors: string[] = [];
  if (!isPromptRole(doc?.role)) return [`role must be one of ${PROMPT_ROLES.join(", ")}`];
  if (!PROMPT_NAME_RE.test(doc.name ?? "")) errors.push(PROMPT_NAME_HINT);

  const check = validateAgainst("prompt", doc);
  errors.push(...check.errors);

  const def = loadRoles()[doc.role];
  const known = new Set(Object.keys(def.variables));
  const editable = usedVariables(doc.system).concat(usedVariables(doc.user));
  for (const name of new Set(editable)) {
    if (!known.has(name)) {
      errors.push(`unknown variable {{${name}}} — role '${doc.role}' offers ${[...known].join(", ")}`);
    }
  }
  const composed = new Set([
    ...editable,
    ...usedVariables(weldedText(doc.role, "system")),
    ...usedVariables(weldedText(doc.role, "user")),
  ]);
  for (const [name, spec] of Object.entries(def.variables)) {
    if (spec.required && !composed.has(name)) errors.push(`required variable {{${name}}} is never used`);
  }
  return errors;
}

/**
 * The D44 ladder: per-video override → channel config → style pack → default.
 * Called once at enqueue; the resolved TEXT (not the name) is what the snapshot
 * carries, so editing a prompt afterwards cannot change this video and a re-run
 * reproduces the same words.
 *
 * The welded half is deliberately NOT snapshotted: it has to match the
 * validator that will judge the output, not the one that existed at enqueue.
 */
export function resolvePrompt(
  cfg: Record<string, unknown>,
  role: PromptRole,
  overrides?: Record<string, unknown> | null
): { resolved: ResolvedPrompt } | { problem: string } {
  // Two roles are PHASES of another agent, so their channel layer sits inside
  // that agent's block rather than in one of their own: the spine under the
  // planner (D52), research under the script (D64). Neither exists as a
  // top-level channel-config field, so reading cfg[role] would silently
  // resolve every channel to the default.
  const roleCfg = (
    role === "spine"
      ? ((cfg.planner as { spine?: { prompt?: string } } | undefined)?.spine ?? {})
      : role === "research"
        ? ((cfg.script as { research?: { prompt?: string } } | undefined)?.research ?? {})
        : (cfg[role] ?? {})
  ) as { prompt?: string };
  const overrideCfg = ((overrides?.[role] ?? {}) as { prompt?: string }).prompt;
  const packCfg =
    role === "script"
      ? ((cfg.style_pack_doc as { script?: { prompt?: string } } | undefined)?.script?.prompt)
      : undefined;

  const layers: [ResolvedPrompt["source"], string | undefined][] = [
    ["video", overrideCfg],
    ["channel", roleCfg.prompt],
    ["style_pack", packCfg],
    ["default", "default"],
  ];

  for (const [source, name] of layers) {
    if (!name) continue;
    if (!PROMPT_NAME_RE.test(name)) return { problem: `${role} prompt ${JSON.stringify(name)}: ${PROMPT_NAME_HINT}` };
    const doc = readPrompt(role, name);
    if (!doc) {
      // A named prompt that does not exist is a config error, not a reason to
      // silently narrate in the wrong voice.
      if (source === "default") return { problem: `prompts/${role}/default.json is missing` };
      return { problem: `${role} prompt '${name}' not found in contracts/prompts/${role}` };
    }
    return {
      resolved: {
        name: doc.name,
        source,
        system: doc.system,
        ...(doc.user ? { user: doc.user } : {}),
        ...(doc.model_hint ? { model_hint: doc.model_hint } : {}),
        ...(doc.max_tokens ? { max_tokens: doc.max_tokens } : {}),
      },
    };
  }
  return { problem: `no prompt resolved for role ${role}` };
}
