/**
 * The directed-edit block, judged against its script — the paste box's half.
 *
 * docs/05-roadmap/directed-edit-test.md. The block is written outside the
 * system by a Claude web pass and pasted under the script; this runs the checks
 * that need no audio and no money, so a phrase that does not match is sent back
 * to its author before anything is produced.
 *
 * A mirror of the worker's edithints.py. Both assert
 * contracts/fixtures/rules/edit_hints_rules.json, so they cannot drift. Two
 * checks are worker-only and absent here — a number anchor's value against the
 * number runs actually spoken, and a place against the gazetteer — because
 * they need Python-side tables; the worker runs them before narration.
 */
import type { CatalogEntry, CatalogPropSpec, OverlayDensity } from "@lusora/contracts";
import { loadMergedCatalog } from "./catalog.ts";
import { densityPerMinute, overlayBudget } from "./pacing.ts";
import { compareKey, tokenize } from "./textmatch.ts";
import { getValidator } from "./validate.ts";

/** Words per minute used to estimate time before any audio exists (the
 *  descoberta voice, measured). A per-voice setting replaces it later. */
export const DEFAULT_WPM = 142;
const LONG_PHRASE_WORDS = 8;
const SAFE_BUDGET_SHARE = 0.9;

export interface EditHintsAnchor {
  type: string;
  value: unknown;
  label?: string;
}

export interface EditHintsPin {
  at: string;
  anchor?: EditHintsAnchor;
  overlay?: { component: string; props_hint?: Record<string, unknown> };
  visual_intent?: string;
  queries?: string[];
}

export interface EditHints {
  version?: "1";
  style_pack: string;
  sections: { from: string; mood: string }[];
  pins: EditHintsPin[];
}

export interface EditHintsReport {
  errors: string[];
  warnings: string[];
}

type Span = [number, number];

// ---------------- phrases ----------------

function keyed(script: string): { words: string[]; keys: string[]; owner: number[] } {
  const words = script.split(/\s+/).filter(Boolean);
  const keys: string[] = [];
  const owner: number[] = [];
  words.forEach((word, index) => {
    for (const token of tokenize(word)) {
      keys.push(compareKey(token));
      owner.push(index);
    }
  });
  return { words, keys, owner };
}

const phraseKeys = (phrase: string) => tokenize(phrase).map(compareKey);

function matchesAt(keys: string[], wanted: string[], i: number): boolean {
  for (let j = 0; j < wanted.length; j++) if (keys[i + j] !== wanted[j]) return false;
  return true;
}

/** Every place `phrase` occurs, as inclusive whitespace-word ranges. */
export function locatePhrase(script: string, phrase: string): Span[] {
  const { keys, owner } = keyed(script);
  const wanted = phraseKeys(phrase);
  if (!wanted.length) return [];
  const hits: Span[] = [];
  for (let i = 0; i + wanted.length <= keys.length; i++) {
    if (matchesAt(keys, wanted, i)) hits.push([owner[i], owner[i + wanted.length - 1]]);
  }
  return hits;
}

/** The script's OWN words for a located range. */
export function scriptSpan(script: string, span: Span): string {
  return script.split(/\s+/).filter(Boolean).slice(span[0], span[1] + 1).join(" ");
}

function closest(script: string, phrase: string): string {
  const { words, keys, owner } = keyed(script);
  const wanted = phraseKeys(phrase);
  const length = phrase.split(/\s+/).filter(Boolean).length;
  for (let k = wanted.length - 1; k > 1; k--) {
    const prefix = wanted.slice(0, k);
    for (let i = 0; i + k <= keys.length; i++) {
      if (matchesAt(keys, prefix, i)) return words.slice(owner[i], owner[i] + length).join(" ");
    }
  }
  return "";
}

const short = (text: string) => (text.length <= 50 ? text : text.slice(0, 47) + "…");
const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

function locateOne(script: string, phrase: string, where: string, errors: string[]): Span | null {
  if (!phraseKeys(phrase).length) {
    errors.push(`${where}: has no words to match`);
    return null;
  }
  const hits = locatePhrase(script, phrase);
  if (hits.length === 1) return hits[0];
  if (!hits.length) {
    const near = closest(script, phrase);
    const hint = near ? `; the script says "${near}"` : "";
    errors.push(`${where}: not in the script — copy the words exactly${hint}`);
  } else {
    errors.push(`${where}: appears ${hits.length} times in the script — add words until it appears once`);
  }
  return null;
}

// ---------------- prop values (validators.py check_prop_value) ----------------

/** Python's type(value).__name__, so the two languages say the same thing. */
function pyType(value: unknown): string {
  if (value === null || value === undefined) return "NoneType";
  if (Array.isArray(value)) return "list";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number") return Number.isInteger(value) ? "int" : "float";
  if (typeof value === "string") return "str";
  return "dict";
}

function pyRepr(value: unknown): string {
  if (typeof value === "string") return `'${value}'`;
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(", ")}]`;
  if (typeof value === "boolean") return value ? "True" : "False";
  if (value === null || value === undefined) return "None";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

const isNumber = (v: unknown) => typeof v === "number";

/** One catalog prop value against its spec — validators.py check_prop_value. */
export function checkPropValue(spec: CatalogPropSpec, name: string, value: unknown): string | null {
  const t = spec.type;
  if (t === "string" && typeof value !== "string") return `prop '${name}' must be a string, got ${pyType(value)}`;
  if (t === "number" && !isNumber(value)) return `prop '${name}' must be a number, got ${pyType(value)}`;
  if (t === "boolean" && typeof value !== "boolean") return `prop '${name}' must be a boolean`;
  if (t === "array" && !Array.isArray(value)) return `prop '${name}' must be an array`;
  if (spec.enum && !spec.enum.some((e) => e === value)) {
    return `prop '${name}'=${pyRepr(value)} not in ${pyRepr(spec.enum)}`;
  }
  if (spec.min !== undefined && isNumber(value) && (value as number) < spec.min) {
    return `prop '${name}'=${value} below min ${spec.min}`;
  }
  if (spec.max !== undefined && isNumber(value) && (value as number) > spec.max) {
    return `prop '${name}'=${value} above max ${spec.max}`;
  }
  if (spec.maxWords && typeof value === "string" && wordCount(value) > spec.maxWords) {
    return `prop '${name}' exceeds ${spec.maxWords} words`;
  }
  if (t === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return `prop '${name}' must be an object, got ${pyType(value)}`;
    }
    const declared = spec.properties ?? {};
    const obj = value as Record<string, unknown>;
    for (const [key, sub] of Object.entries(declared)) {
      if (key in obj) {
        const err = checkPropValue(sub, `${name}.${key}`, obj[key]);
        if (err) return err;
      }
    }
    if (Object.keys(declared).length) {
      const unknown = Object.keys(obj).filter((k) => !(k in declared));
      if (unknown.length) return `prop '${name}' has unknown keys ${pyRepr(unknown)}`;
    }
  }
  if (t === "array" && Array.isArray(value) && spec.items) {
    for (let i = 0; i < value.length; i++) {
      const err = checkPropValue(spec.items, `${name}[${i}]`, value[i]);
      if (err) return err;
    }
  }
  return null;
}

// ---------------- the block ----------------

interface StyleDoc {
  name?: string;
  overlays?: {
    density?: OverlayDensity;
    allowed_components?: string[];
    emphasis?: { enabled?: boolean; per_minute?: number };
  };
  music?: { min_span_s?: number };
}

function catalogEntry(name: string): CatalogEntry | null {
  const hit = loadMergedCatalog().items.find((i) => i.entry.name === name);
  return hit ? hit.entry : null;
}

function schemaErrors(hints: unknown): string[] {
  const validate = getValidator("edit_hints");
  if (validate(hints)) return [];
  // Ajv's wording, with the two details jsonschema's messages carry and the
  // author needs to act on: which key was unexpected, and which values are legal.
  return (validate.errors ?? []).map((e) => {
    const params = e.params as { additionalProperty?: string; allowedValues?: unknown[] };
    const path = e.instancePath.replace(/^\//, "") || "/";
    const extra = params.additionalProperty
      ? ` ('${params.additionalProperty}' was unexpected)`
      : params.allowedValues
        ? ` ${pyRepr(params.allowedValues)}`
        : "";
    return `schema ${path}: ${e.message ?? ""}${extra}`;
  });
}

/**
 * Errors and warnings for an edit block against its script.
 *
 * `cfg.style_pack_doc` is the video's RESOLVED pack — allowed_components
 * already narrowed by the channel's component pack and exclusions, exactly as
 * the worker will read it. Without `durationS` the length is estimated from
 * the word count at `wpm`.
 */
export function validateEditHints(
  hints: unknown,
  script: string,
  cfg: { style_pack_doc?: StyleDoc | null },
  opts: { durationS?: number | null; wpm?: number } = {}
): EditHintsReport {
  const schema = schemaErrors(hints);
  if (schema.length) return { errors: schema, warnings: [] };
  const block = hints as EditHints;
  const errors: string[] = [];
  const warnings: string[] = [];

  const style = cfg.style_pack_doc ?? {};
  const secondsPerWord = 60 / (opts.wpm ?? DEFAULT_WPM);
  const durationS = opts.durationS ?? wordCount(script) * secondsPerWord;

  if (style.name && block.style_pack !== style.name) {
    errors.push(
      `style_pack is "${block.style_pack}" but this video uses "${style.name}" — ` +
        `generate the edit pass for "${style.name}"`
    );
  }

  checkSections(block.sections, script, style, secondsPerWord, errors, warnings);

  const located: { n: number; span: Span; pin: EditHintsPin }[] = [];
  block.pins.forEach((pin, index) => {
    const n = index + 1;
    const where = `pin ${n} ("${short(pin.at)}")`;
    const span = locateOne(script, pin.at, where, errors);
    if (span) {
      located.push({ n, span, pin });
      const count = wordCount(pin.at);
      if (count > LONG_PHRASE_WORDS) {
        warnings.push(
          `${where}: ${count} words — longer than ${LONG_PHRASE_WORDS} words; fine if it is needed to be unique`
        );
      }
    }
    checkPinShape(pin, where, errors);
    checkPinOverlay(pin, where, style, errors);
  });

  located.sort((a, b) => a.span[0] - b.span[0]);
  for (let i = 1; i < located.length; i++) {
    const [a, b] = [located[i - 1], located[i]];
    if (b.span[0] <= a.span[1]) {
      errors.push(`pin ${a.n} and pin ${b.n} share words — two pins cannot cover the same words`);
    }
  }

  checkBudgets(block.pins, style, durationS, errors, warnings);
  checkCrowding(located, secondsPerWord, warnings);
  return { errors, warnings };
}

function checkSections(
  sections: EditHints["sections"],
  script: string,
  style: StyleDoc,
  secondsPerWord: number,
  errors: string[],
  warnings: string[]
): void {
  const starts: [number, number][] = [];
  sections.forEach((section, index) => {
    const n = index + 1;
    const where = `section ${n} ("${short(section.from)}")`;
    const span = locateOne(script, section.from, where, errors);
    if (!span) return;
    if (n === 1 && span[0] !== 0) {
      const opening = script.split(/\s+/).filter(Boolean).slice(0, 6).join(" ");
      errors.push(`section 1 must start at the script's first words ("${opening}")`);
    }
    if (starts.length && span[0] <= starts[starts.length - 1][1]) {
      errors.push(`${where}: starts before section ${starts[starts.length - 1][0]} — list sections in script order`);
    }
    starts.push([n, span[0]]);
  });

  const minSpan = Number(style.music?.min_span_s ?? 0);
  if (!minSpan) return;
  const total = wordCount(script);
  starts.forEach(([n, start], i) => {
    const end = i + 1 < starts.length ? starts[i + 1][1] : total;
    const seconds = (end - start) * secondsPerWord;
    if (seconds < minSpan) {
      warnings.push(
        `section ${n} is ~${seconds.toFixed(0)}s long, shorter than the music's minimum span ` +
          `(${minSpan}s) — its mood will be absorbed by its neighbours`
      );
    }
  });
}

function checkPinShape(pin: EditHintsPin, where: string, errors: string[]): void {
  if (!pin.overlay && !pin.visual_intent) errors.push(`${where}: needs an overlay, a visual_intent, or both`);
  if (pin.anchor && !pin.overlay) errors.push(`${where}: an anchor needs an overlay to show it`);
  if (pin.queries?.length && !pin.visual_intent) errors.push(`${where}: queries need a visual_intent beside them`);
  (pin.queries ?? []).forEach((query, i) => {
    const count = wordCount(String(query));
    if (count < 1 || count > 5) {
      errors.push(
        `${where}: queries[${i}] "${short(String(query))}" is ${count} words — a keyword ` +
          "query is 2-4 words, never more than 5"
      );
    }
  });
}

/** Whether the compiler fills this prop from the anchor (`_compile_overlay`). */
function anchorSupplies(anchor: EditHintsAnchor, spec: CatalogPropSpec, prop: string): boolean {
  const ref = spec.from_anchor;
  if (ref) {
    const m = /^(\w+)\[(\d+)\]$/.exec(ref);
    const record = anchor as unknown as Record<string, unknown>;
    if (!m) return record[ref] !== undefined && record[ref] !== null;
    const seq = record[m[1]];
    return Array.isArray(seq) && Number(m[2]) < seq.length;
  }
  return prop === "label" && Boolean(anchor.label);
}

function checkPinOverlay(pin: EditHintsPin, where: string, style: StyleDoc, errors: string[]): void {
  const overlay = pin.overlay;
  if (!overlay) return;
  const name = overlay.component;
  const entry = catalogEntry(name);
  if (!entry) {
    errors.push(`${where}: component '${name}' is not in the catalog`);
    return;
  }
  const allowed = style.overlays?.allowed_components;
  if (allowed && allowed.length && !allowed.includes(name)) {
    errors.push(`${where}: component '${name}' is not in the style pack's allowed_components ${pyRepr(allowed)}`);
  }

  const anchor = pin.anchor;
  const emphasisEnabled = Boolean(style.overlays?.emphasis?.enabled);
  const takes = entry.anchor_types as readonly string[];
  if (!takes.length) {
    if (anchor) errors.push(`${where}: '${name}' carries no fact, so it takes no anchor — remove the anchor`);
    if (!emphasisEnabled) {
      errors.push(
        `${where}: '${name}' is an emphasis graphic, and this style pack does not use ` +
          "emphasis — choose a component that shows a fact"
      );
    }
  } else if (!anchor) {
    errors.push(`${where}: '${name}' shows a fact and needs an anchor (types ${pyRepr([...takes])})`);
  } else if (!takes.includes(anchor.type)) {
    errors.push(`${where}: '${name}' cannot attach to anchor type '${anchor.type}' — it takes ${pyRepr([...takes])}`);
  }

  if (anchor?.type === "comparison") {
    const items = anchor.value;
    const wellFormed =
      Array.isArray(items) &&
      items.length >= 2 &&
      items.every(
        (it) =>
          typeof it === "object" && it !== null &&
          typeof (it as { label?: unknown }).label === "string" &&
          typeof (it as { value?: unknown }).value === "number"
      );
    if (!wellFormed) {
      errors.push(
        `${where}: a comparison anchor's value is a list of {"label": "…", "value": number} ` +
          "objects, one per compared quantity"
      );
    }
  }

  const hint = overlay.props_hint ?? {};
  for (const [prop, value] of Object.entries(hint)) {
    const spec = entry.props[prop];
    if (!spec) {
      errors.push(`${where}: prop '${prop}' unknown for ${name}`);
      continue;
    }
    const err = checkPropValue(spec, prop, value);
    if (err) {
      errors.push(`${where}: props_hint ${err} — props_hint carries concrete values, never the prop schema itself`);
    }
  }

  for (const [prop, spec] of Object.entries(entry.props)) {
    if (!spec.required || prop in hint || "default" in spec || spec.computed) continue;
    if (anchor && anchorSupplies(anchor, spec, prop)) continue;
    errors.push(`${where}: '${name}' needs required prop '${prop}' in props_hint`);
  }
}

function checkBudgets(
  pins: EditHintsPin[],
  style: StyleDoc,
  durationS: number,
  errors: string[],
  warnings: string[]
): void {
  let anchorCount = 0;
  let emphasisCount = 0;
  for (const pin of pins) {
    const entry = pin.overlay ? catalogEntry(pin.overlay.component) : null;
    if (!entry) continue;
    if (entry.anchor_types.length) anchorCount++;
    else emphasisCount++;
  }

  const minutes = durationS / 60;
  const density = style.overlays?.density ?? "normal";
  const ceiling = overlayBudget(density, durationS);
  const safe = Math.floor(densityPerMinute(density) * minutes * SAFE_BUDGET_SHARE);
  if (anchorCount > ceiling) {
    errors.push(`${anchorCount} fact graphics exceed the budget (max ${ceiling} for ~${durationS.toFixed(0)}s)`);
  } else if (anchorCount > safe) {
    warnings.push(
      `${anchorCount} fact graphics is above the safe budget of ${safe} — if the narration ` +
        "runs faster than estimated this fails after narration"
    );
  }

  const emphasis = style.overlays?.emphasis ?? {};
  if (!emphasis.enabled) return;
  const perMinute = Number(emphasis.per_minute ?? 1);
  const maxEmphasis = Math.ceil(perMinute * minutes) + 1;
  const safeEmphasis = Math.floor(perMinute * minutes * SAFE_BUDGET_SHARE);
  if (emphasisCount > maxEmphasis) {
    errors.push(
      `${emphasisCount} emphasis graphics exceed the budget (max ${maxEmphasis} for ~${durationS.toFixed(0)}s)`
    );
  } else if (emphasisCount > safeEmphasis) {
    warnings.push(
      `${emphasisCount} emphasis graphics is above the safe budget of ${safeEmphasis} — if the ` +
        "narration runs faster than estimated this fails after narration"
    );
  }
}

/** A graphic whose next neighbour starts before it is readable (see the worker). */
function checkCrowding(
  located: { n: number; span: Span; pin: EditHintsPin }[],
  secondsPerWord: number,
  warnings: string[]
): void {
  const graphics = located.filter((l) => l.pin.overlay);
  for (let i = 0; i + 1 < graphics.length; i++) {
    const { n, span, pin } = graphics[i];
    const next = graphics[i + 1];
    const component = pin.overlay!.component;
    const minimum = Number(catalogEntry(component)?.duration_hint_s?.min ?? 0);
    const seconds = (next.span[0] - span[0]) * secondsPerWord;
    if (minimum && seconds < minimum) {
      warnings.push(
        `pin ${n} ("${short(pin.at)}"): ${component} gets ~${seconds.toFixed(1)}s before pin ${next.n} ` +
          `("${short(next.pin.at)}") starts, and needs ${minimum}s to be readable — the compiler ` +
          "would drop it; move one of the two pins, or drop one"
      );
    }
  }
}
