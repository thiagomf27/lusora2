/**
 * Props to preview a catalog component with.
 *
 * The hand-written set lives in the engine (src/catalog/sample-props.json) and
 * is shared with `preview-all.mjs`, so what the Overlays screen animates is
 * what the batch still-render shows. Entries added as data packs have no
 * hand-written sample, so we synthesize one from the prop spec — enough to see
 * the component move, and editable in the UI.
 */
import type { CatalogEntry, CatalogPropSpec } from "@lusora/contracts";
import samples from "@lusora/engine/src/catalog/sample-props.json";

const HAND_WRITTEN = (samples as { props: Record<string, Record<string, unknown>> }).props;

export function hasHandWrittenSample(name: string): boolean {
  return name in HAND_WRITTEN;
}

/** Words that read as a real value rather than "string1". */
const FILLER = [
  "The Volga crossing",
  "Held until winter",
  "Sixth Army",
  "November 1942",
  "Kalach",
];

function synthesize(key: string, spec: CatalogPropSpec, depth = 0): unknown {
  if (spec.default !== undefined) return spec.default;
  if (spec.enum?.length) return spec.enum[0];

  switch (spec.type) {
    case "number": {
      const min = spec.min ?? 0;
      const max = spec.max ?? Math.max(min + 42, 42);
      if (/lat/i.test(key)) return 48.708;
      if (/(lng|lon)/i.test(key)) return 44.514;
      return Math.round((min + max) / 2) || Math.min(42, max);
    }
    case "boolean":
      return false;
    case "array": {
      const count = Math.max(spec.min ?? 2, 2);
      const item = spec.items ?? { type: "string" };
      return Array.from({ length: Math.min(count, spec.max ?? count) }, (_, i) =>
        synthesize(`${key}_${i}`, item, depth + 1)
      );
    }
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [k, s] of Object.entries(spec.properties ?? {})) {
        if (depth > 2) break;
        out[k] = synthesize(k, s, depth + 1);
      }
      return out;
    }
    default: {
      if (/date/i.test(key)) return "19 Nov 1942";
      if (/(place|city|region|country)/i.test(key)) return "Stalingrad";
      const words = spec.maxWords ?? 6;
      const pick = FILLER[key.length % FILLER.length];
      return pick.split(" ").slice(0, Math.max(words, 1)).join(" ");
    }
  }
}

/** Player length for a preview: what the catalog says the component needs. */
export function previewDuration(entry: CatalogEntry): number {
  return entry.duration_hint_s?.default ?? entry.duration_hint_s?.min ?? 5;
}

/** Sample props for one entry: the engine's set, else synthesized. */
export function sampleProps(entry: CatalogEntry): Record<string, unknown> {
  const written = HAND_WRITTEN[entry.name];
  if (written) return written;
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(entry.props)) {
    // required props plus anything with a default: enough to render, nothing
    // arbitrary layered on top
    if (spec.required || spec.default !== undefined) out[key] = synthesize(key, spec);
  }
  return out;
}
