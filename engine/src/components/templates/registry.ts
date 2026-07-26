/**
 * Overlay templates: the code-free path into the catalog.
 *
 * A catalog entry normally names a React component in ../core. An entry may
 * instead declare `template: "<kind>"`, and TemplateOverlay draws it from data
 * — themed, animated, no new code. That is what makes an overlay authored in
 * the platform usable in the next video.
 *
 * Each kind owns a fixed prop vocabulary. An entry may declare a subset of it
 * (and may add `from_anchor` / `required` / word caps to those props), but not
 * prop names the template would ignore — the platform rejects that, because a
 * planner hinting a prop nothing reads is a silent no-op.
 *
 * The kind list is mirrored in contracts/schemas/catalog_entry.schema.json and
 * edit_plan.schema.json; test/templates.test.ts fails if they drift.
 */
import type { CatalogPropSpec } from "@lusora/contracts";

export const TEMPLATE_KINDS = [
  "card",
  "lower_third",
  "big_number",
  "bullet_list",
  "statement",
] as const;

export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export interface TemplateDef {
  label: string;
  /** what the template draws, for the author choosing one */
  summary: string;
  /** seed text for a new entry's when_to_use — the author sharpens it */
  when_to_use: string;
  when_not_to_use: string;
  props: Record<string, CatalogPropSpec>;
  /** preview props, mirroring engine/src/catalog/sample-props.json in spirit */
  sample: Record<string, unknown>;
  duration_hint_s: { min: number; default: number };
}

const EMPHASIS: CatalogPropSpec = { enum: ["accent", "neutral"], default: "accent" };

export const TEMPLATES: Record<TemplateKind, TemplateDef> = {
  card: {
    label: "Card",
    summary: "A side panel: heading, a few lines of body, an optional source line.",
    when_to_use: "a claim needs a sentence or two of supporting detail on screen",
    when_not_to_use:
      "a single figure (a big_number template or AnimatedCounter); a spoken line (QuoteBlock)",
    props: {
      title: { type: "string", maxWords: 10, required: true },
      body: { type: "string", maxWords: 40 },
      footnote: { type: "string", maxWords: 8, description: "source or caveat, set small" },
      position: { enum: ["left", "right", "center"], default: "right" },
      emphasis: EMPHASIS,
    },
    sample: {
      title: "The pocket held for ten weeks",
      body: "Air supply promised 300 tonnes a day and delivered less than a third of it, in weather that grounded whole squadrons.",
      footnote: "Beevor, Stalingrad (1998)",
      position: "right",
      emphasis: "accent",
    },
    duration_hint_s: { min: 3, default: 5 },
  },

  lower_third: {
    label: "Lower third",
    summary: "A bar at the bottom of frame: one line, an optional second line under it.",
    when_to_use: "labelling who or what is on screen while the shot continues",
    when_not_to_use: "a person's name and role specifically (NamePlate); a date (DateStamp)",
    props: {
      text: { type: "string", maxWords: 8, required: true },
      subtext: { type: "string", maxWords: 10 },
      side: { enum: ["left", "right"], default: "left" },
      emphasis: EMPHASIS,
    },
    sample: {
      text: "62nd Army headquarters",
      subtext: "Tsaritsa gorge, September 1942",
      side: "left",
      emphasis: "accent",
    },
    duration_hint_s: { min: 2, default: 3.5 },
  },

  big_number: {
    label: "Big number",
    summary: "One figure, counted up, with a label under it.",
    when_to_use: "the narration lands a single quantity worth holding on",
    when_not_to_use:
      "two values compared (ComparisonSplit); three or more (BarChart); a figure that should stay in the corner (StatTag)",
    props: {
      value: { type: "number", required: true, from_anchor: "value" },
      label: { type: "string", maxWords: 8, required: true },
      prefix: { type: "string", maxWords: 2 },
      suffix: { type: "string", maxWords: 3 },
      emphasis: EMPHASIS,
    },
    sample: { value: 91, label: "thousand taken prisoner", suffix: "k", emphasis: "accent" },
    duration_hint_s: { min: 2.5, default: 4 },
  },

  bullet_list: {
    label: "Bullet list",
    summary: "Two to six short lines, revealed one after another, under a heading.",
    when_to_use: "the narration enumerates reasons, conditions or consequences",
    when_not_to_use:
      "ordered steps in a process (StepFlow); dated events (Timeline); label/value pairs (FactSheet)",
    props: {
      title: { type: "string", maxWords: 6 },
      items: {
        type: "array",
        required: true,
        min: 2,
        max: 6,
        items: { type: "string", maxWords: 10 },
      },
      marker: { enum: ["dot", "rule", "number"], default: "dot" },
      emphasis: EMPHASIS,
    },
    sample: {
      title: "Why the airlift failed",
      items: [
        "Two airfields inside the pocket, both under fire",
        "Transports diverted to the Caucasus",
        "Fog and ice from mid-December",
      ],
      marker: "rule",
      emphasis: "accent",
    },
    duration_hint_s: { min: 3.5, default: 6 },
  },

  statement: {
    label: "Statement",
    summary: "One line, large and centred, with an accent rule under it.",
    when_to_use: "a single sentence carries the point and deserves the whole frame",
    when_not_to_use:
      "the video's opening title (KineticTitle); a quotation with a speaker (QuoteBlock)",
    props: {
      text: { type: "string", maxWords: 16, required: true },
      kicker: { type: "string", maxWords: 4, description: "small line above, e.g. 'The verdict'" },
      align: { enum: ["left", "center"], default: "center" },
      emphasis: EMPHASIS,
    },
    sample: {
      text: "The Sixth Army was never relieved.",
      kicker: "The verdict",
      align: "center",
      emphasis: "accent",
    },
    duration_hint_s: { min: 2.5, default: 4 },
  },
};

export function isTemplateKind(value: unknown): value is TemplateKind {
  return typeof value === "string" && (TEMPLATE_KINDS as readonly string[]).includes(value);
}

/** Prop names a template-backed entry may declare. */
export function templateVocabulary(kind: TemplateKind): string[] {
  return Object.keys(TEMPLATES[kind].props);
}
