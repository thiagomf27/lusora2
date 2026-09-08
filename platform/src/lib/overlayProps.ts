/**
 * The props an overlay will be DRAWN with, resolved the way the compiler
 * resolves them — so a preview taken before the beat is compiled shows the
 * same component the render will.
 *
 * This mirrors `_compile_overlay` in the worker's compiler (compiler/core.py), in
 * its order, because the order is the meaning: a `props_hint` the model wrote
 * wins, an anchor fills what the model was told not to retype (`from_anchor`),
 * the catalog's own defaults fill the rest, and a bottom-edge position is
 * flipped above the caption band when captions are on (D56).
 *
 * Two steps of the compiler's are NOT mirrored, and are reported instead of
 * faked: `computed` props (geocoding needs the gazetteer, a file on the worker)
 * and the truncation rules that only `validate_beat_sheet` applies. Anything
 * left unfilled that the component needs to draw at all is given a sample
 * value and named in `standIns`, so a preview says which of the words on it
 * came from the beat and which are stand-ins for a value the compile supplies.
 */
import type { Anchor, Beat, CatalogEntry, CatalogPropSpec } from "@lusora/contracts";

/** D56 — the bottom-edge choices the compiler lifts when captions are on. */
const ABOVE_THE_CAPTIONS: Record<string, string> = {
  bottom_left: "top_left",
  bottom_right: "top_right",
  bottom_center: "top_center",
};

const INDEXED = /^([a-z_]+)\[(\d+)\]$/;

/** `from_anchor` reference: a field, or one element of a list-valued field. */
function anchorField(anchor: Anchor, ref: string): unknown {
  const match = INDEXED.exec(ref);
  const record = anchor as unknown as Record<string, unknown>;
  if (!match) return record[ref];
  const seq = record[match[1]];
  const index = Number(match[2]);
  return Array.isArray(seq) && index < seq.length ? seq[index] : undefined;
}

/** Trim an anchor-filled string to the prop's own word limit, as `_fit` does. */
function fit(spec: CatalogPropSpec, value: unknown): unknown {
  const limit = spec.maxWords;
  if (!limit || typeof value !== "string") return value;
  const words = value.split(/\s+/);
  return words.length <= limit ? value : words.slice(0, limit).join(" ");
}

export interface ResolvedOverlayProps {
  props: Record<string, unknown>;
  /** Props this beat's anchor supplies — the model never types these. */
  fromAnchor: string[];
  /** Props nothing supplies yet, drawn with a sample value. */
  standIns: string[];
  /** Why the compile would refuse this overlay, when it would. */
  problem: string | null;
}

export function resolveOverlayProps(
  beat: Beat,
  entry: CatalogEntry,
  options: {
    /** D56 applies only when the video actually burns captions. */
    captionsEnabled?: boolean;
    /** Values to stand in for props nothing supplies yet. */
    fallback?: Record<string, unknown>;
  } = {}
): ResolvedOverlayProps {
  const { captionsEnabled = true, fallback = {} } = options;
  const overlay = beat.overlay;
  const props: Record<string, unknown> = { ...(overlay?.props_hint ?? {}) };
  const fromAnchor: string[] = [];
  const standIns: string[] = [];
  let problem: string | null = null;

  const anchors = beat.anchors ?? [];
  const ref = overlay?.anchor_ref;
  const anchor = ref !== undefined && ref !== null ? anchors[ref] : undefined;

  if (entry.anchor_types.length > 0) {
    if (!anchor) {
      problem = `${entry.name} needs an anchor of type ${entry.anchor_types.join(" or ")}, and this beat gives it none`;
    } else if (!(entry.anchor_types as readonly string[]).includes(anchor.type)) {
      problem = `${entry.name} cannot attach to a ${anchor.type} anchor`;
    }
  }

  for (const [name, spec] of Object.entries(entry.props ?? {})) {
    if (name in props) continue;
    if (anchor && spec.from_anchor) {
      const value = anchorField(anchor, spec.from_anchor);
      if (value !== undefined && value !== null) {
        props[name] = fit(spec, value);
        fromAnchor.push(name);
        continue;
      }
    }
    if (spec.computed) continue; // geocoding is the worker's; reported below
    if (spec.default !== undefined) props[name] = spec.default;
  }

  // The compiler's last anchor fill: a label the anchor carries, for a
  // component that declares one and was given none.
  if (anchor?.label && entry.props?.label && !("label" in (overlay?.props_hint ?? {}))) {
    props.label = fit(entry.props.label, anchor.label);
    if (!fromAnchor.includes("label")) fromAnchor.push("label");
  }

  if (captionsEnabled) {
    for (const [name, spec] of Object.entries(entry.props ?? {})) {
      const current = props[name];
      if (!spec.enum || typeof current !== "string") continue;
      const above = ABOVE_THE_CAPTIONS[current];
      if (above && (spec.enum as unknown[]).map(String).includes(above)) props[name] = above;
    }
  }

  // Whatever is still missing and needed to DRAW: a sample, named as such. A
  // preview of a card with an empty headline answers nothing.
  for (const [name, spec] of Object.entries(entry.props ?? {})) {
    if (props[name] !== undefined) continue;
    if (!spec.required && !spec.computed) continue;
    if (fallback[name] === undefined) continue;
    props[name] = fallback[name];
    standIns.push(name);
  }

  return { props, fromAnchor, standIns, problem };
}
