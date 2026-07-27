/**
 * D46 surface + motion token resolution.
 *
 * The first group is the load-bearing one: a theme carrying none of the new
 * tokens must resolve to exactly the values the components hardcoded before
 * D46. That is what lets the 26 core components be converted one at a time
 * instead of all at once — an unconverted component and a converted one have to
 * look identical under an untouched theme.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { Theme } from "@lusora/contracts";
import {
  DEFAULT_THEME,
  easingCurve,
  entranceFor,
  surfaceStyle,
} from "../src/themes/runtime.ts";
import { PANEL_ENTRANCES, TEXT_ENTRANCES } from "../src/themes/entrance.ts";

const themed = (extra: Partial<Theme>): Theme => ({ ...DEFAULT_THEME, ...extra });

// ---------------- defaults reproduce the pre-D46 look ----------------

test("a theme with no surface tokens keeps the component's own values", () => {
  const s = surfaceStyle(DEFAULT_THEME, { radius: 12, alpha: "e6", accentRule: "top" });
  assert.equal(s.borderRadius, 12); // FactCard's literal borderRadius
  assert.equal(s.background, `${DEFAULT_THEME.colors.bg}e6`); // its literal fill
  assert.equal(s.accentRule, "top");
});

test("components with different base radii both keep theirs", () => {
  // the card template sat at 12, the lower third at 8
  assert.equal(surfaceStyle(DEFAULT_THEME, { radius: 12 }).borderRadius, 12);
  assert.equal(surfaceStyle(DEFAULT_THEME, { radius: 8 }).borderRadius, 8);
});

test("a lower third keeps its own e0 alpha, not the card's e6", () => {
  const s = surfaceStyle(DEFAULT_THEME, { alpha: "e0" });
  assert.equal(s.background, `${DEFAULT_THEME.colors.bg}e0`);
});

test("no motion tokens means the pre-D46 curve", () => {
  assert.deepEqual(easingCurve(DEFAULT_THEME), [0.16, 1, 0.3, 1]);
});

test("no motion tokens means the component's own entrance", () => {
  assert.equal(entranceFor(DEFAULT_THEME, "FactCard", PANEL_ENTRANCES, "slide"), "slide");
  assert.equal(entranceFor(DEFAULT_THEME, "NamePlate", PANEL_ENTRANCES, "rise"), "rise");
});

// ---------------- surface ----------------

test("radius scales the component's value rather than replacing it", () => {
  assert.equal(surfaceStyle(themed({ surface: { radius: "square" } }), { radius: 12 }).borderRadius, 0);
  assert.equal(surfaceStyle(themed({ surface: { radius: "square" } }), { radius: 8 }).borderRadius, 0);
  // rounded keeps the 12:8 proportion between the two components
  assert.equal(surfaceStyle(themed({ surface: { radius: "rounded" } }), { radius: 12 }).borderRadius, 28);
  assert.equal(surfaceStyle(themed({ surface: { radius: "rounded" } }), { radius: 8 }).borderRadius, 18);
});

test("fill: solid is opaque, none removes the panel", () => {
  const bg = DEFAULT_THEME.colors.bg;
  assert.equal(surfaceStyle(themed({ surface: { fill: "solid" } })).background, `${bg}ff`);
  assert.equal(surfaceStyle(themed({ surface: { fill: "none" } })).background, "transparent");
});

test("accent_rule overrides the component's placement only when set", () => {
  assert.equal(surfaceStyle(themed({ surface: { fill: "solid" } }), { accentRule: "left" }).accentRule, "left");
  assert.equal(
    surfaceStyle(themed({ surface: { accent_rule: "none" } }), { accentRule: "left" }).accentRule,
    "none"
  );
});

// ---------------- motion ----------------

test("the theme default overrides every component's fallback", () => {
  const theme = themed({ motion: { entrance: "pop" } });
  assert.equal(entranceFor(theme, "FactCard", PANEL_ENTRANCES, "slide"), "pop");
  assert.equal(entranceFor(theme, "NamePlate", PANEL_ENTRANCES, "rise"), "pop");
});

test("per_component beats the theme default", () => {
  const theme = themed({
    motion: { entrance: "slide", per_component: { ChapterCard: "typewriter" } },
  });
  assert.equal(entranceFor(theme, "ChapterCard", TEXT_ENTRANCES, "rise"), "typewriter");
  assert.equal(entranceFor(theme, "FactCard", PANEL_ENTRANCES, "rise"), "slide");
});

test("an unsupported entrance degrades to fade, never renders broken", () => {
  const theme = themed({ motion: { entrance: "typewriter" } });
  // BarChart has no text to type
  assert.equal(entranceFor(theme, "BarChart", PANEL_ENTRANCES, "rise"), "fade");
  // ...but a text component honors it
  assert.equal(entranceFor(theme, "HammerStatement", TEXT_ENTRANCES, "rise"), "typewriter");
});

test("a per_component override for an unsupported entrance also degrades", () => {
  const theme = themed({ motion: { per_component: { BarChart: "typewriter" } } });
  assert.equal(entranceFor(theme, "BarChart", PANEL_ENTRANCES, "rise"), "fade");
});

test("every easing token resolves to a bezier", () => {
  for (const easing of ["smooth", "snap", "spring", "linear"] as const) {
    const curve = easingCurve(themed({ motion: { easing } }));
    assert.equal(curve.length, 4);
    assert.ok(curve.every((n) => typeof n === "number" && Number.isFinite(n)));
  }
});
