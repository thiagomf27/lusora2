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
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_THEME,
  achromatic,
  capsTracking,
  chartStyle,
  composition,
  contrastInk,
  contrastRatio,
  plateColor,
  textPlate,
  seriesColors,
  densityScale,
  easingCurve,
  entranceFor,
  mutedInk,
  ruleWidth,
  scrimAlpha,
  surfaceStyle,
  textureLayer,
  typeCase,
  typeScale,
  typeTracking,
  typeWeight,
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

// ---------------- D66: the defaults are the identity ----------------
//
// The load-bearing group for the token set added with the LineChart merge. A
// theme carrying no D66 token has to resolve to exactly what the component
// already hardcoded, or the remaining 25 conversions become a flag day.

test("no typography tokens returns the component's own ratio, weight, case and tracking", () => {
  for (const role of ["title", "number", "kicker", "body", "caption"] as const) {
    assert.equal(typeScale(DEFAULT_THEME, role), 1);
  }
  assert.equal(typeWeight(DEFAULT_THEME, 700), 700); // LineChart's title
  assert.equal(typeWeight(DEFAULT_THEME, 400), 400); // its tick labels
  assert.equal(typeCase(DEFAULT_THEME), "none");
  assert.equal(typeCase(DEFAULT_THEME, "uppercase"), "uppercase"); // an already-upper kicker
  assert.equal(typeTracking(DEFAULT_THEME), undefined); // omitted, so CSS keeps `normal`
  assert.equal(typeTracking(DEFAULT_THEME, 0.08), "0.08em");
});

test("no surface tokens means no spacing change, no rule change and no texture", () => {
  assert.equal(densityScale(DEFAULT_THEME), 1);
  assert.equal(ruleWidth(DEFAULT_THEME, 2), 2);
  assert.equal(ruleWidth(DEFAULT_THEME, 1.584), 1.584); // fractional, and NOT rounded
  assert.equal(textureLayer(DEFAULT_THEME), null);
});

test("no chart tokens keeps the component's own grid, legend, markers and stroke", () => {
  const c = chartStyle(DEFAULT_THEME, { grid: "axes", legend: "bottom", markers: "ends", stroke: 3.6 });
  assert.equal(c.grid, "axes");
  assert.equal(c.legend, "bottom");
  assert.equal(c.markers, "ends");
  assert.equal(c.strokeWidth, 3.6);
  assert.equal(c.formatNumber(40300), "40,300");
});

test("every shipped theme authored before D66 is unchanged by it", () => {
  // The themes that predate D66 carry no typography.scale, no
  // surface.density and no chart block. Their surface/motion blocks must not
  // accidentally switch a D66 resolver off its identity.
  const preD66: Theme = themed({
    surface: { radius: "square", fill: "solid", accent_rule: "none" },
    motion: { easing: "smooth" },
  });
  assert.equal(typeScale(preD66, "title"), 1);
  assert.equal(typeWeight(preD66, 700), 700);
  assert.equal(densityScale(preD66), 1);
  assert.equal(ruleWidth(preD66, 2), 2);
  assert.equal(textureLayer(preD66), null);
  assert.equal(chartStyle(preD66, { grid: "axes", stroke: 3.6 }).strokeWidth, 3.6);
});

test("every shipped theme authored before D70 is unchanged by it", () => {
  const preD70: Theme = themed({
    surface: { radius: "square", fill: "solid", accent_rule: "none" },
    typography: { display: "Inter", body: "Inter", caption_preset: "plain", case: "as_written" },
    chart: { grid: "horizontal", legend: "inline" },
  });
  // Composition: no layout block means the component's own.
  assert.equal(composition(preD70), "centered");
  assert.equal(composition(preD70, "poster"), "poster");
  // `as_written` still leaves a component's own caps alone, and the tracking
  // that goes with them.
  assert.equal(typeCase(preD70, "uppercase"), "uppercase");
  assert.equal(capsTracking(preD70, 0.06), "0.06em");
  // `axis` has no default, so an untouched chart theme keeps neutral at the
  // component's own weight.
  const chart = chartStyle(preD70, { axisWeight: 400 });
  assert.equal(chart.axis, "muted");
  assert.equal(chart.axisInk, preD70.colors.neutral);
  assert.equal(chart.axisWeight, 400);
});

test("`sentence` takes a component's own caps away, which `as_written` cannot", () => {
  const sentence = themed({
    typography: { display: "Inter", body: "Inter", caption_preset: "plain", case: "sentence" },
  });
  assert.equal(typeCase(sentence, "uppercase"), "none");
  // The +0.06em existed only to open up the caps, so it goes with them.
  assert.equal(capsTracking(sentence, 0.06), undefined);
  const upper = themed({
    typography: { display: "Inter", body: "Inter", caption_preset: "plain", case: "upper" },
  });
  assert.equal(typeCase(upper, "none"), "uppercase");
});

test("chart.axis: ink promotes an annotation to content, in colour and weight", () => {
  const ink = themed({ chart: { axis: "ink" } });
  const style = chartStyle(ink, { axisWeight: 400 });
  assert.equal(style.axisInk, ink.colors.text);
  assert.ok(style.axisWeight > 400, "an ink axis is set heavier than a muted one");
});

test("mutedInk returns the theme's own neutral whenever it is already readable", () => {
  // The identity that makes this a resolver rather than a token: every shipped
  // theme clears 3:1, so every one of them renders unchanged. `standard` was the
  // exception until D71 turned it mono — its neutral was #b9c0ca on a near-white
  // page, which is a FILL and 1.7:1 as ink. The synthetic case below keeps that
  // pair pinned now that no shipped theme carries it.
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../contracts/themes");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const theme = JSON.parse(readFileSync(join(dir, file), "utf8")) as Theme;
    assert.equal(mutedInk(theme), theme.colors.neutral, `${file}: mutedInk moved a readable neutral`);
  }
  // And it only ever moves TOWARDS readable, from either direction.
  const light = {
    ...DEFAULT_THEME,
    colors: { bg: "#ffffff", text: "#000000", accent: "#0000ff", neutral: "#f2f2f2" },
  };
  assert.notEqual(mutedInk(light), "#f2f2f2");
  const wasStandard = {
    ...DEFAULT_THEME,
    colors: { bg: "#f5f6f7", text: "#111827", accent: "#2858e8", neutral: "#b9c0ca" },
  };
  assert.notEqual(mutedInk(wasStandard), "#b9c0ca", "a fill-weight neutral is not ink");
});

// ---------------- D66: the tokens actually move ----------------

test("scale moves display type further than caption type", () => {
  const generous = themed({ typography: { ...DEFAULT_THEME.typography, scale: "generous" } });
  assert.ok(typeScale(generous, "title") > typeScale(generous, "caption"));
  const compact = themed({ typography: { ...DEFAULT_THEME.typography, scale: "compact" } });
  assert.ok(typeScale(compact, "title") < typeScale(compact, "caption"));
});

test("weight shifts rather than replaces, so a title and a label stay apart", () => {
  const bold = themed({ typography: { ...DEFAULT_THEME.typography, weight: "bold" } });
  const light = themed({ typography: { ...DEFAULT_THEME.typography, weight: "light" } });
  assert.ok(typeWeight(bold, 700) > typeWeight(bold, 400));
  assert.ok(typeWeight(light, 700) >= typeWeight(light, 400));
  assert.equal(typeWeight(light, 400), 300); // clamped, never invisible
  assert.equal(typeWeight(bold, 900), 900); // clamped at the top
});

test("tracking is additive, so a title at 0em is still reachable by `wide`", () => {
  const wide = themed({ typography: { ...DEFAULT_THEME.typography, tracking: "wide" } });
  assert.equal(typeTracking(wide), "0.07em");
  assert.equal(typeTracking(wide, 0.2), "0.27em");
  const tight = themed({ typography: { ...DEFAULT_THEME.typography, tracking: "tight" } });
  assert.equal(typeTracking(tight), "-0.03em");
  assert.equal(typeTracking(tight, -0.04), "-0.05em"); // floored
});

test("rule and stroke scale the component's own width", () => {
  const heavy = themed({ surface: { rule: "heavy" } });
  const hair = themed({ surface: { rule: "hairline" } });
  assert.equal(ruleWidth(heavy, 2), 5);
  assert.equal(ruleWidth(hair, 2), 1);
  assert.equal(ruleWidth(hair, 1), 1); // never disappears
  assert.ok(chartStyle(themed({ chart: { stroke: "heavy" } }), { stroke: 4 }).strokeWidth > 4);
  assert.ok(chartStyle(themed({ chart: { stroke: "hairline" } }), { stroke: 4 }).strokeWidth < 4);
});

test("a theme names a chart choice and the component's own is overridden", () => {
  const c = chartStyle(themed({ chart: { grid: "full", legend: "inline", markers: "dot" } }), {
    grid: "axes",
    legend: "bottom",
    markers: "ends",
  });
  assert.equal(c.grid, "full");
  assert.equal(c.legend, "inline");
  assert.equal(c.markers, "dot");
});

test("compact numbers are compact, and plain ones are not", () => {
  const compact = chartStyle(themed({ chart: { number_format: "compact" } })).formatNumber;
  // A decimal only when there is a fraction to show. `.0` is not precision, it
  // is noise, and every reference sets 50K and 32K rather than 50.0K (D71).
  assert.equal(compact(50000), "50K");
  assert.equal(compact(32000), "32K");
  assert.equal(compact(52_400), "52.4K");
  assert.equal(compact(1_240_000), "1.2M");
  assert.equal(compact(2_000_000), "2M");
  assert.equal(compact(940), "940");
  assert.equal(chartStyle(DEFAULT_THEME).formatNumber(50000), "50,000");
});

test("texture is a deterministic style object, not a random one", () => {
  const paper = themed({ surface: { texture: "paper" } });
  assert.deepEqual(textureLayer(paper), textureLayer(paper));
  assert.notDeepEqual(textureLayer(paper), textureLayer(themed({ surface: { texture: "grain" } })));
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


// ---------------- D71: a panel's colour, and a palette with no colour in it ----------------

const MONO: Theme = {
  ...DEFAULT_THEME,
  colors: { bg: "#0a0a0a", text: "#ffffff", accent: "#ffffff", neutral: "#c9c9c9" },
};

test("plate: omitted is the page, `invert` is the ink, `accent` is the accent", () => {
  // The identity: every theme authored before D71 says nothing and keeps `page`.
  assert.equal(plateColor(MONO), MONO.colors.bg);
  assert.equal(plateColor(DEFAULT_THEME), DEFAULT_THEME.colors.bg);

  const inverted = { ...MONO, surface: { plate: "invert" as const } };
  assert.equal(plateColor(inverted), MONO.colors.text);

  // `accent` is the tag idiom: the chip IS the accent, and its ink is whatever
  // reads on it — which is what lets a yellow tag carry black type without the
  // component knowing the tag is yellow.
  const tag = {
    ...MONO,
    colors: { ...MONO.colors, accent: "#f5c518" },
    surface: { plate: "accent" as const },
  };
  assert.equal(plateColor(tag), "#f5c518");
  assert.ok(contrastRatio(contrastInk(tag, plateColor(tag)), "#f5c518") >= 4.5);
  // And the ink follows without being told, because contrastInk already picks
  // whichever of the theme's two colours holds contrast against what it is on.
  assert.equal(contrastInk(inverted, plateColor(inverted)), MONO.colors.bg);
  assert.equal(contrastInk(MONO, plateColor(MONO)), MONO.colors.text);
});

test("surfaceStyle paints with the plate colour, not the page colour", () => {
  const inverted = { ...MONO, surface: { plate: "invert" as const, fill: "solid" as const } };
  assert.ok(surfaceStyle(inverted).background.startsWith(MONO.colors.text));
  const page = { ...MONO, surface: { fill: "solid" as const } };
  assert.ok(surfaceStyle(page).background.startsWith(MONO.colors.bg));
});

test("every shipped theme is unchanged by the plate token", () => {
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../contracts/themes");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const theme = JSON.parse(readFileSync(join(dir, file), "utf8")) as Theme;
    // Keyed on whether the token is SET, not on which value it holds: the
    // identity is "a theme that did not ask keeps the page", and enumerating
    // the values means every new one has to be remembered here.
    if (theme.surface?.plate !== undefined) continue;
    assert.equal(plateColor(theme), theme.colors.bg, `${file}: plate moved without being asked`);
  }
});

test("text_plate: omitted leaves bare type, `on` plates it", () => {
  // The identity: the pack drew bare type before the token, and a theme that
  // does not mention it still does.
  assert.equal(textPlate(DEFAULT_THEME), false);
  assert.equal(textPlate(MONO), false);
  assert.equal(textPlate({ ...MONO, surface: { text_plate: "on" as const } }), true);
  assert.equal(textPlate({ ...MONO, surface: { text_plate: "off" as const } }), false);

  // It is NOT `fill` wearing a different name: `paper-print` paints no panels
  // and still wants its labels chipped, which is the pair that ruled `fill` out.
  const paperish = { ...MONO, surface: { fill: "none" as const, text_plate: "on" as const } };
  assert.equal(surfaceStyle(paperish).background, "transparent");
  assert.equal(textPlate(paperish), true);
});

test("every shipped theme that does not ask for text_plate keeps bare type", () => {
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../contracts/themes");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const theme = JSON.parse(readFileSync(join(dir, file), "utf8")) as Theme;
    if (theme.surface?.text_plate !== undefined) continue;
    assert.equal(textPlate(theme), false, `${file}: text plated without being asked`);
  }
});

test("a palette with no chroma in it gets a ramp with no chroma in it", () => {
  assert.equal(achromatic(MONO), true);
  const coloured = {
    ...DEFAULT_THEME,
    colors: { bg: "#f5f6f7", text: "#111827", accent: "#2858e8", neutral: "#b9c0ca" },
  };
  assert.equal(achromatic(coloured), false);

  const ramp = seriesColors(MONO);
  // Six steps, because a pie takes six slices and `ramp[i % 3]` wrapped white
  // back round to slice four.
  assert.equal(ramp.length, 6);
  for (const c of ramp) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    assert.equal(r, g, `${c} is not grey`);
    assert.equal(g, b, `${c} is not grey`);
  }
  // Every mark clears the 3:1 a non-text mark has to hold against the plate,
  // and no two adjacent steps collapse into each other.
  for (const c of ramp) assert.ok(contrastRatio(c, MONO.colors.bg) >= 3, `${c} is unreadable`);
  assert.equal(new Set(ramp).size, ramp.length);

  // The same has to hold with the palette the other way up: sRGB is not linear,
  // so a floor tuned against a black page is wrong against a white one.
  const monoLight = {
    ...DEFAULT_THEME,
    colors: { bg: "#ffffff", text: "#111111", accent: "#111111", neutral: "#767676" },
  };
  assert.equal(achromatic(monoLight), true);
  const lightRamp = seriesColors(monoLight);
  assert.equal(lightRamp.length, 6);
  for (const c of lightRamp) {
    assert.ok(contrastRatio(c, monoLight.colors.bg) >= 3, `${c} is unreadable on a light page`);
  }

  // A theme that names a colour keeps the engine's hues.
  assert.ok(seriesColors(coloured).some((c) => !/^#(\w\w)\1\1$/.test(c)));
});

test("contrastRatio is WCAG, so a component can ask about a ground the theme does not own", () => {
  assert.equal(Math.round(contrastRatio("#ffffff", "#000000")), 21);
  assert.equal(contrastRatio("#ffffff", "#ffffff"), 1);
  // The case DocumentCard hit: a white accent stamped on white paper.
  assert.ok(contrastRatio("#ffffff", "#f2f2f2") < 3);
});


// ---------------- D72: the shot turned down under an overlay ----------------

test("scrim is inert until a theme asks, and only `standard` asks", () => {
  // The identity: omitted means 0, so a theme from before D72 mounts no element
  // at all and every existing render is untouched.
  assert.equal(scrimAlpha(DEFAULT_THEME), 0);
  assert.equal(scrimAlpha({ ...DEFAULT_THEME, layout: { scrim: "none" } }), 0);

  const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../contracts/themes");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const theme = JSON.parse(readFileSync(join(dir, file), "utf8")) as Theme;
    if (theme.layout?.scrim && theme.layout.scrim !== "none") continue;
    assert.equal(scrimAlpha(theme), 0, `${file}: dimmed the shot without asking`);
  }
});

test("scrim steps up, and never reaches opaque", () => {
  const soft = scrimAlpha({ ...DEFAULT_THEME, layout: { scrim: "soft" } });
  const heavy = scrimAlpha({ ...DEFAULT_THEME, layout: { scrim: "heavy" } });
  assert.ok(soft > 0 && soft < heavy && heavy < 1);
  // A scrim turns the shot DOWN. One that hid it would be a background, and the
  // theme already has `colors.bg` for that.
  assert.ok(heavy <= 0.75, "a scrim that opaque is a backdrop, not a dim");
});
