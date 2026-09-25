/**
 * The edit-pass prompt: what a Claude web chat is given to write the
 * directed-edit block (docs/05-roadmap/directed-edit-test.md, slice 2).
 *
 * GENERATED, not written, so it cannot drift from what the block is judged
 * against. Everything the validator enforces comes out of the same documents
 * the validator reads:
 *
 *  - the component menu, from the merged catalog, narrowed to the video's
 *    RESOLVED `allowed_components` (the channel's component pack and exclusions
 *    applied exactly as at enqueue);
 *  - the budgets, from the style pack, at the estimated duration;
 *  - the moods, from edit_hints.schema.json's own enum;
 *  - the phrase rules and the output shape, from the block's contract.
 *
 * Only the craft preamble is editable: contracts/edit-pass/craft.md, the D43
 * split applied to a prompt that lives outside the system. A golden file,
 * contracts/fixtures/edit_pass_prompt.txt, makes any change to the generated
 * text a diff someone sees in CI.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CatalogEntry, CatalogPropSpec, OverlayDensity } from "@lusora/contracts";
import { loadMergedCatalog } from "./catalog.ts";
import { DEFAULT_WPM } from "./editHints.ts";
import { repoRoot } from "./env.ts";
import { applyComponentPack, applyLook } from "./look.ts";
import { densityPerMinute, overlayBudget } from "./pacing.ts";

/** Share of the estimated budget the prompt asks for; the rest is headroom for
 *  narration that runs faster than the estimate (the validator warns past it). */
const SAFE_BUDGET_SHARE = 0.9;

/** A budget at or above one graphic every this many seconds is no budget at
 *  all: every readable minimum in the catalog is at least 2 s, so more than
 *  that cannot be put on screen. The prompt then says "no practical limit". */
const UNREADABLE_PACE_S = 2;

/** Props a text author cannot supply: file paths and map plates. */
const FILE_PROPS = new Set(["image", "plate", "src"]);
/** The catalog's `emphasis` prop is a visual weight the theme owns (D86). */
const HIDDEN_PROPS = new Set(["emphasis"]);

export interface EditPassStyle {
  name: string;
  overlays?: {
    density?: OverlayDensity;
    allowed_components?: string[];
    emphasis?: { enabled?: boolean; per_minute?: number };
  };
  music?: { min_span_s?: number };
}

export interface EditPassOptions {
  /** The RESOLVED style pack (see resolveStyleForConfig). */
  style: EditPassStyle;
  /** Seconds of narration, when known or estimated; null prints per-minute budgets. */
  durationS?: number | null;
  wpm?: number;
}

// ---------------- resolution ----------------

/**
 * The style pack as a video on this channel would see it: the named pack
 * embedded, then narrowed by `component_pack` and `look.exclude` — the same
 * two functions enqueue runs, in the same order, so the menu Claude is shown is
 * the menu the block will be judged against.
 */
export function resolveStyleForConfig(config: Record<string, unknown>): {
  style: EditPassStyle | null;
  problems: string[];
} {
  const snapshot = structuredClone(config);
  const name = String(snapshot.style_pack ?? "");
  if (snapshot.style_pack_doc === undefined) {
    const path = join(repoRoot(), "contracts", "style-packs", `${name}.json`);
    if (!name || !existsSync(path)) {
      return { style: null, problems: [`style-packs/${name}.json not found in contracts`] };
    }
    snapshot.style_pack_doc = JSON.parse(readFileSync(path, "utf8"));
  }
  const problems = [...applyComponentPack(snapshot), ...applyLook(snapshot)];
  return { style: snapshot.style_pack_doc as EditPassStyle, problems };
}

// ---------------- the menu ----------------

function isFileProp(name: string, spec: CatalogPropSpec): boolean {
  return FILE_PROPS.has(name) || /^path to/i.test(spec.description ?? "");
}

/** A prop's shape, compact: `≤8 words`, `number 0-2`, `a|b|c`, `[{date ≤3w, label ≤8w}, …]`. */
function shape(spec: CatalogPropSpec, nested = false): string {
  if (spec.enum) return spec.enum.map(String).join("|");
  switch (spec.type) {
    case "string": {
      if (!spec.maxWords) return "text";
      const unit = nested ? "w" : spec.maxWords === 1 ? " word" : " words";
      return `≤${spec.maxWords}${unit}`;
    }
    case "number": {
      const range =
        spec.min !== undefined && spec.max !== undefined
          ? ` ${spec.min}-${spec.max}`
          : spec.min !== undefined
            ? ` ≥${spec.min}`
            : spec.max !== undefined
              ? ` ≤${spec.max}`
              : "";
      return `number${range}`;
    }
    case "boolean":
      return "true/false";
    case "array":
      return spec.items ? `[${shape(spec.items, true)}, …]` : "[…]";
    case "object": {
      const fields = Object.entries(spec.properties ?? {})
        .filter(([key, sub]) => !isFileProp(key, sub))
        .map(([key, sub]) => `${key} ${shape(sub, true)}`);
      return `{${fields.join(", ")}}`;
    }
    default:
      return "value";
  }
}

/**
 * The props an author may hint, in catalog order, one per line.
 *
 * A description already printed for the same prop name is not printed again:
 * a pack's shared props (`background`, `size`) carry one long sentence each,
 * and six copies of it are tokens the reader pays for and learns nothing from.
 * `seen` spans one whole render, so the first mention is the full one.
 */
function propLines(entry: CatalogEntry, seen: Map<string, string>): string[] {
  const lines: string[] = [];
  for (const [name, spec] of Object.entries(entry.props)) {
    if (spec.from_anchor || spec.computed || HIDDEN_PROPS.has(name) || isFileProp(name, spec)) continue;
    const required = spec.required && !("default" in spec) ? "*" : "";
    const form = spec.enum ? `= ${shape(spec)}` : `(${shape(spec)})`;
    let note = "";
    if (spec.description) {
      note = seen.get(name) === spec.description ? " — as above" : ` — ${spec.description}`;
      seen.set(name, spec.description);
    }
    lines.push(`    ${name}${required} ${form}${note}`);
  }
  return lines;
}

function componentBlock(entry: CatalogEntry, seen: Map<string, string>): string {
  const takes = entry.anchor_types.length ? ` [anchor: ${entry.anchor_types.join(" | ")}]` : "";
  const lines = [
    `- ${entry.name}${takes}`,
    `  use: ${entry.when_to_use}`,
    `  not: ${entry.when_not_to_use}`,
  ];
  const props = propLines(entry, seen);
  lines.push(props.length ? "  props:" : "  props: none to set", ...props);
  return lines.join("\n");
}

function menuEntries(style: EditPassStyle): { facts: CatalogEntry[]; emphasis: CatalogEntry[] } {
  const allowed = style.overlays?.allowed_components;
  const entries = loadMergedCatalog()
    .items.map((i) => i.entry)
    .filter((e) => !allowed || allowed.includes(e.name))
    // code-point order, not localeCompare: the golden file must not depend on
    // the machine's locale (the planner's menu sorts the same way)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    facts: entries.filter((e) => e.anchor_types.length > 0),
    emphasis: entries.filter((e) => e.anchor_types.length === 0),
  };
}

// ---------------- budgets ----------------

function budgetSection(style: EditPassStyle, durationS: number | null, wpm: number): string {
  const density = style.overlays?.density ?? "normal";
  const factRate = densityPerMinute(density);
  const emphasis = style.overlays?.emphasis ?? {};
  const emphasisOn = Boolean(emphasis.enabled);
  const emphasisRate = Number(emphasis.per_minute ?? 1);
  const unreadable = 60 / UNREADABLE_PACE_S;
  const uncapped = factRate >= unreadable && (!emphasisOn || emphasisRate >= unreadable);

  const lines = ["BUDGET"];
  if (uncapped) {
    lines.push(
      "There is no practical limit on graphics in this style. Restraint is your call:",
      "a video with text on every sentence is as broken as one with none. Aim for the",
      "moments an editor would actually cut to."
    );
  } else if (durationS) {
    const minutes = durationS / 60;
    const safeFacts = Math.floor(factRate * minutes * SAFE_BUDGET_SHARE);
    const factCeiling = overlayBudget(density, durationS);
    lines.push(
      `This video is ~${minutes.toFixed(1)} min of narration. Use at most ${safeFacts} fact graphics` +
        ` (hard ceiling ${factCeiling}).`
    );
    if (emphasisOn) {
      const safeEmphasis = Math.floor(emphasisRate * minutes * SAFE_BUDGET_SHARE);
      const emphasisCeiling = Math.ceil(emphasisRate * minutes) + 1;
      lines.push(
        `Use at most ${safeEmphasis} emphasis graphics (hard ceiling ${emphasisCeiling}), counted`,
        "separately — neither budget can borrow from the other."
      );
    }
    lines.push(
      "Staying under the first numbers leaves room for narration that runs faster than",
      "estimated. A budget is a ceiling, not a target."
    );
  } else {
    lines.push(
      `Use at most ${factRate * SAFE_BUDGET_SHARE} fact graphics per minute of narration` +
        (emphasisOn ? `, and ${emphasisRate * SAFE_BUDGET_SHARE} emphasis graphics per minute, counted separately.` : ".")
    );
  }
  const minSpan = Number(style.music?.min_span_s ?? 0);
  if (minSpan) {
    const words = Math.round((minSpan * wpm) / 60);
    lines.push(
      `Sections shorter than ~${minSpan} seconds of speech (~${words} words) are absorbed by their`,
      "neighbours, so do not change the mood for less."
    );
  }
  return lines.join("\n");
}

// ---------------- the prompt ----------------

function moods(): string[] {
  const schema = JSON.parse(
    readFileSync(join(repoRoot(), "contracts/schemas/edit_hints.schema.json"), "utf8")
  );
  return schema.$defs.section.properties.mood.enum as string[];
}

const ANCHOR_VALUES: Record<string, string> = {
  number: 'the figure as a number, e.g. 1200',
  percentage: 'the figure as a number, e.g. 70 (not "70%")',
  comparison: '[{"label": "…", "value": <number>}, …], one per compared quantity',
  place: "the place as the narration names it",
  date: "the date as the narration says it",
  name: "the person's name as the narration says it",
  quote: "the quoted words, verbatim",
};

function anchorSection(facts: CatalogEntry[]): string {
  if (!facts.length) return "";
  const types = [...new Set(facts.flatMap((e) => e.anchor_types as readonly string[]))];
  const order = Object.keys(ANCHOR_VALUES);
  types.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return [
    "ANCHOR (only with a fact graphic)",
    `{"type": "${types.join('" | "')}", "value": …, "label": "<what it is, ≤8 words>"}`,
    ...types.map((t) => `- ${t}: value is ${ANCHOR_VALUES[t]}`),
    'The value must be what the narration says in "at". Never compute or round a new one.',
  ].join("\n");
}

function outputSection(style: EditPassStyle, facts: CatalogEntry[], emphasis: CatalogEntry[]): string {
  const example: string[] = [];
  const text = emphasis.find((e) => e.props.text?.required) ?? emphasis[0];
  if (text) {
    example.push(
      '    {"at": "<phrase>",',
      `     "overlay": {"component": "${text.name}", "props_hint": {…}},`,
      '     "visual_intent": "<optional: scout description of the key shot>",',
      '     "queries": ["<optional: 2-4 word search>", "<2-4 words>"]}'
    );
  }
  const fact = facts[0];
  if (fact) {
    const type = fact.anchor_types[0];
    const value = type === "percentage" || type === "number" ? "70" : '"…"';
    example.push(
      `    {"at": "<phrase with the fact>",`,
      `     "anchor": {"type": "${type}", "value": ${value}, "label": "…"},`,
      `     "overlay": {"component": "${fact.name}", "props_hint": {…}}}`
    );
  }
  if (!example.length) {
    example.push('    {"at": "<phrase>", "visual_intent": "…", "queries": ["…", "…"]}');
  }
  const joined = example.join("\n").replace(/\}\n    \{/g, "},\n    {");
  return [
    "OUTPUT — exactly this, JSON between the markers, nothing before or after:",
    "===LUSORA EDIT v1===",
    "{",
    `  "style_pack": "${style.name}",`,
    '  "sections": [',
    '    {"from": "<the script\'s first words>", "mood": "<mood>"}',
    "  ],",
    '  "pins": [',
    joined,
    "  ]",
    "}",
    "===END===",
    'A pin needs an "overlay", a "visual_intent" + "queries", or both.',
    '"queries" are 2-3 keyword searches of 2-4 words (never more than 5), subject',
    "first, most specific first — stock libraries match words, not meaning.",
    'Never write "source_words", "anchor_ref" or "role": code derives them.',
  ].join("\n");
}

const PHRASE_RULES = [
  "PHRASE RULES (checked by code — a mismatch is rejected)",
  '- "at" and "from" are copied EXACTLY from the script: same words, same order,',
  "  same spelling, in the script's language.",
  "- 2 to 8 words, and unique in the script. If the words occur twice, add",
  "  words until they occur once. Longer only when that is needed to be unique.",
  '- "at" is where the graphic belongs: start it at the words the graphic is',
  "  about (for a number, the number itself). The graphic appears when they",
  "  are spoken.",
  "- Two pins may not share words.",
  "- Two graphics in consecutive short sentences crowd each other: each needs a",
  "  couple of seconds on screen before the next one starts.",
].join("\n");

const SELF_CHECK = [
  "BEFORE YOU ANSWER, CHECK",
  "- The first section starts at the script's very first words.",
  '- Every "at"/"from" is copied exactly and occurs once in the script.',
  "- No two pins share words.",
  "- Every fact graphic has an anchor whose value is what the narration says.",
  "- Every required prop (*) is present, and every text fits its word limit.",
  "- You did not reprint the script.",
].join("\n");

/** The whole prompt, ending where the script is to be pasted. */
export function renderEditPassPrompt(options: EditPassOptions): string {
  const { style } = options;
  const wpm = options.wpm ?? DEFAULT_WPM;
  const craft = readFileSync(join(repoRoot(), "contracts/edit-pass/craft.md"), "utf8").trimEnd();
  const { facts, emphasis } = menuEntries(style);
  const emphasisOn = Boolean(style.overlays?.emphasis?.enabled);

  const seen = new Map<string, string>();
  const block = (entry: CatalogEntry) => componentBlock(entry, seen);
  const menu: string[] = ["COMPONENTS (the only ones that exist in this style)"];
  if (facts.length) {
    menu.push('Fact graphics — need an "anchor" taken from the words in "at":', ...facts.map(block));
  }
  if (emphasis.length && emphasisOn) {
    menu.push('Emphasis graphics — no anchor; "props_hint" carries the text:', ...emphasis.map(block));
  }
  menu.push("(* = required. Leave out any prop you have no reason to set.)");
  const shown = { facts, emphasis: emphasisOn ? emphasis : [] };

  return [
    craft,
    budgetSection(style, options.durationS ?? null, wpm),
    PHRASE_RULES,
    ["MOODS (use exactly one of these words)", moods().join(", ")].join("\n"),
    menu.join("\n"),
    anchorSection(shown.facts),
    outputSection(style, shown.facts, shown.emphasis),
    SELF_CHECK,
    "THE SCRIPT:",
  ]
    .filter(Boolean)
    .join("\n\n") + "\n";
}

// ---------------- the golden file ----------------

export const FIXTURE_PATH = "contracts/fixtures/edit_pass_prompt.txt";

export const FIXTURE_HEADER = `# Golden file: the edit-pass prompt for descoberta-doc at 20 minutes, with no
# channel narrowing (core + the pack's own menu).
#
# Rendered by renderEditPassPrompt() in platform/src/lib/editPassPrompt.ts and
# asserted by platform/test/editPassPrompt.test.ts. A diff here means the
# prompt an edit pass is given has changed — usually because the catalog did.
# That is allowed; it is not allowed to happen unseen.
#
# Regenerate with:
#   pnpm edit-pass-prompt --write-fixture
#
`;

/** The golden file's exact contents, from the contracts as they stand. */
export function renderFixture(): string {
  const { style, problems } = resolveStyleForConfig({ style_pack: "descoberta-doc" });
  if (!style) throw new Error(problems.join("; "));
  return FIXTURE_HEADER + renderEditPassPrompt({ style, durationS: 20 * 60 });
}
