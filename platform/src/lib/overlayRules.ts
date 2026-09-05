/**
 * The overlay rules, on the platform side.
 *
 * The worker's `validate_beat_sheet` has always applied these; the editor route
 * did not, so an overlay the chat agent invented — a component that does not
 * exist, one the channel forbids, one attached to an anchor it cannot take —
 * was written to beats.json and stopped the video later, at compile, with an
 * error about a stage the human never touched.
 *
 * `contracts/fixtures/rules/overlay_rules.json` is the shared expectation
 * table: worker/tests/test_validators.py and platform/test/overlayRules.test.ts
 * assert the same cases against the two implementations, so they cannot drift.
 */
import type { Beat, BeatOverlay, CatalogEntry } from "@lusora/contracts";
import { loadMergedCatalog } from "./catalog.ts";

export interface OverlayPolicy {
  /** Components this channel installed; null/undefined means the whole catalog. */
  allowed?: string[] | null;
  /** D59 — whether the pure-text/exhibit class is available at all. */
  emphasisEnabled?: boolean;
}

/** Read the policy out of a video's frozen cfg snapshot. */
export function overlayPolicy(cfg: unknown): OverlayPolicy {
  const overlays =
    ((cfg as { style_pack_doc?: { overlays?: Record<string, unknown> } } | null)?.style_pack_doc
      ?.overlays ?? {}) as Record<string, unknown>;
  const emphasis = (overlays.emphasis ?? {}) as { enabled?: boolean };
  return {
    allowed: (overlays.allowed_components as string[] | undefined) ?? null,
    emphasisEnabled: Boolean(emphasis.enabled),
  };
}

function catalogEntry(name: string): CatalogEntry | null {
  const hit = loadMergedCatalog().items.find((i) => i.entry.name === name);
  return hit ? hit.entry : null;
}

/**
 * Which class an overlay belongs to (D86). The CATALOG decides: a component
 * whose anchor_types are empty carries no fact by construction, so an overlay
 * naming one is emphasis whatever the sheet declares.
 */
export function overlayRole(overlay: BeatOverlay, entry?: CatalogEntry | null): "anchor" | "emphasis" {
  if (entry && entry.anchor_types.length === 0) return "emphasis";
  if (overlay.role === "anchor" || overlay.role === "emphasis") return overlay.role;
  return overlay.emphasis ? "emphasis" : "anchor";
}

/** A prop value that is really a prop SCHEMA — the common model failure. */
function looksLikeASchema(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value as Record<string, unknown>);
  return keys.some((k) => ["type", "enum", "required", "maxWords", "min", "max"].includes(k));
}

/** Every problem with one beat's overlay. Empty when it is legal. */
export function validateOverlay(beat: Beat, policy: OverlayPolicy): string[] {
  const overlay = beat.overlay;
  if (!overlay) return [];
  const where = `beat ${beat.id}`;
  const errors: string[] = [];

  const name = String(overlay.component ?? "");
  const entry = catalogEntry(name);
  if (!entry) return [`${where}: overlay component '${name}' not in catalog`];

  if (policy.allowed && policy.allowed.length && !policy.allowed.includes(name)) {
    errors.push(
      `${where}: component '${name}' not in style pack allowed_components ${JSON.stringify(policy.allowed)}`
    );
  }

  // A TIMED beat carries no script_text, so it can carry no anchor and every
  // overlay on one is pure text by construction — it sits outside the class
  // system entirely (D86), the same exemption the worker makes.
  const structural = beat.kind === "timed";
  const role = structural ? "anchor" : overlayRole(overlay, entry);
  if (!structural && role === "emphasis" && !policy.emphasisEnabled) {
    errors.push(
      `${where}: '${name}' carries no anchor type, so it can only ever be an emphasis ` +
        `overlay — and this style pack does not use that class`
    );
  }

  const anchors = beat.anchors ?? [];
  if (entry.anchor_types.length > 0) {
    if (overlay.anchor_ref === undefined || overlay.anchor_ref === null) {
      errors.push(
        `${where}: component '${name}' requires an anchor_ref (types ${JSON.stringify(entry.anchor_types)})`
      );
    } else if (overlay.anchor_ref >= anchors.length) {
      errors.push(`${where}: anchor_ref ${overlay.anchor_ref} out of range`);
    } else if (
      !(entry.anchor_types as readonly string[]).includes(String(anchors[overlay.anchor_ref].type))
    ) {
      errors.push(
        `${where}: component '${name}' cannot attach to anchor type '${anchors[overlay.anchor_ref].type}'`
      );
    }
  }

  for (const [prop, value] of Object.entries(overlay.props_hint ?? {})) {
    const spec = entry.props?.[prop];
    if (!spec) {
      errors.push(`${where}: overlay prop '${prop}' unknown for ${name}`);
    } else if (looksLikeASchema(value)) {
      errors.push(
        `${where}: overlay props_hint '${prop}' looks like a prop schema — props_hint ` +
          `carries concrete values, never the schema itself`
      );
    }
  }

  return errors;
}

/** Every overlay problem in a sheet. */
export function validateOverlays(beats: Beat[], policy: OverlayPolicy): string[] {
  return beats.flatMap((beat) => validateOverlay(beat, policy));
}
