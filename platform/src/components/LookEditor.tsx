"use client";
/**
 * Look editor — "Background image", "Theme selection" and "Overlays,
 * transitions & sound", shared by the quote statement's Look tab and the
 * Channel screen's Visual tab.
 *
 * Two ideas, both real:
 *
 *  - The BACKGROUND is the plate behind an overlay that does not fill the
 *    frame (the D55 fallback card above all). It comes from the channel's own
 *    background library, and is copied into the video folder at enqueue.
 *  - Overlays, transitions, SFX cues and music beds come from the style pack
 *    and the theme. This screen does not add to them; it EXCLUDES, and the
 *    exclusion is applied to the embedded documents at enqueue.
 *
 * Which is why every list below is drawn from the pack and theme themselves
 * (`/api/channels/[id]/look-options`) rather than from a hardcoded menu — and
 * why the things the pack withholds are drawn LOCKED rather than hidden. A
 * screen that shows only what is available cannot answer "where is Timeline?".
 * Three states, three affordances:
 *
 *    in use     — the pack offers it, this channel keeps it. Click to exclude.
 *    excluded   — this channel's own `look.exclude`. Click to restore.
 *    blocked    — the style pack or theme withholds it. Read-only here; the
 *                 pack is a shared document and is edited on its own screen.
 *
 * `sections` is what makes this one component serve both the simplified screen
 * and anything that needs a subset: the caller picks the cards, the card code
 * is not duplicated per screen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { CatalogEntry, ChannelConfig, Theme } from "@lusora/contracts";
import { Button, Dropdown, Toggle } from "@/components/ds";
import { previewDuration, previewPropsFor } from "@/lib/overlaySamples";
import { SoundThumb, TransitionThumb } from "@/components/LookThumbs";
import scr from "@/app/(app)/screen.module.css";
import s from "./LookEditor.module.css";

// Remotion's Thumbnail touches window on mount; the grid is client-only.
const OverlayThumb = dynamic(() => import("@/components/OverlayThumb"), { ssr: false });
const ThemeFrame = dynamic(() => import("@/components/ThemePreview").then((m) => m.ThemeFrame), {
  ssr: false,
});

export type LookSection = "background" | "theme" | "elements";
const ALL_SECTIONS: LookSection[] = ["background", "theme", "elements"];

type Look = NonNullable<ChannelConfig["look"]>;
type Exclusions = NonNullable<Look["exclude"]>;

interface LookOffer {
  name: string;
  blockedBy: string | null;
  pack?: string;
  sound?: { name: string; url: string | null };
}
interface LookOptions {
  theme: string;
  style_pack: string;
  missing: string[];
  offers: {
    components: LookOffer[];
    transitions: LookOffer[];
    sfx_cues: LookOffer[];
    moods: LookOffer[];
  };
  locks: { sfx: string | null; music: string | null };
  componentPack: string | null;
  usableComponents: number;
  defaultTransition: string | null;
  fallbackComponent: string | null;
  soundPack: string | null;
}
interface BackgroundRow {
  name: string;
  bytes: number;
}
interface CatalogItem {
  entry: CatalogEntry;
  renderedBy: "component" | "template" | null;
}
interface ThemeRow {
  name: string;
  doc: Theme | null;
}

/**
 * The four things a pack and theme offer, one menu entry each.
 *
 * Shown one at a time rather than stacked: overlays alone is a scrolling grid
 * of forty-three rendered stills, and putting transitions, cues and moods below
 * it means the three short lists are never on screen at the same time as the
 * thing they belong with. The menu keeps the card one screen tall whichever
 * group is being edited.
 */
const GROUPS = [
  {
    key: "components" as const,
    from: "components" as const,
    label: "Overlays",
    note: "The planner's menu. Excluding one takes it off the menu before the AI sees it.",
  },
  {
    key: "transitions" as const,
    from: "transitions" as const,
    label: "Transitions",
    note: "Cuts the compiler may place between shots. Excluding the pack's default is allowed — the default moves to a survivor at enqueue. `crossfade` and `fade` are the same dissolve today; `fade_to_black` dips through black.",
  },
  {
    key: "sfx_cues" as const,
    from: "sfx_cues" as const,
    label: "Sound effects",
    note: "Which events may fire a cue at all. The theme picks which sound; the pack picks how many.",
  },
  {
    key: "moods" as const,
    from: "moods" as const,
    label: "Music beds",
    note: "Moods that have a bed. An excluded mood plays with no music under it — silence under the turn.",
  },
];
type GroupKey = (typeof GROUPS)[number]["key"];

export default function LookEditor({
  channelId,
  cfg,
  themes,
  onChange,
  disabled = false,
  sections = ALL_SECTIONS,
  scope = "channel",
}: {
  channelId: string;
  cfg: ChannelConfig;
  /** Theme names, as a fallback ordering — the docs are fetched for previews. */
  themes: string[];
  onChange: (next: ChannelConfig) => void;
  disabled?: boolean;
  sections?: LookSection[];
  /** Whose exclusions these are. Both edit the same `look` block — a video's
   *  ride the enqueue deep-merge — but the copy has to say which. */
  scope?: "channel" | "video";
}) {
  const [options, setOptions] = useState<LookOptions | null>(null);
  const [backgrounds, setBackgrounds] = useState<BackgroundRow[]>([]);
  const [themeRows, setThemeRows] = useState<ThemeRow[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [templates, setTemplates] = useState<{ kind: string; sample: Record<string, unknown> }[]>([]);
  const [group, setGroup] = useState<GroupKey>("components");
  const [search, setSearch] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const show = (name: LookSection) => sections.includes(name);
  const look: Look = cfg.look ?? {};
  const exclude: Exclusions = look.exclude ?? {};

  const patch = useCallback(
    (fn: (d: ChannelConfig) => void) => {
      const next = structuredClone(cfg);
      fn(next);
      onChange(next);
    },
    [cfg, onChange]
  );

  const loadBackgrounds = useCallback(() => {
    if (!channelId) return;
    fetch(`/api/channels/${channelId}/backgrounds`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setBackgrounds)
      .catch(() => setBackgrounds([]));
  }, [channelId]);

  useEffect(loadBackgrounds, [loadBackgrounds]);

  // Theme documents for the preview panel, and the catalog for the overlay
  // grid. Both are process-wide data, so they are fetched once, not per theme.
  useEffect(() => {
    fetch("/api/themes")
      .then((r) => (r.ok ? r.json() : []))
      .then(setThemeRows)
      .catch(() => setThemeRows([]));
    fetch("/api/catalog")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setCatalog(d.items ?? []);
        setTemplates(d.templates ?? []);
      })
      .catch(() => undefined);
  }, []);

  // The menu follows the theme / style pack / component pack currently chosen,
  // saved or not — the component pack included, because switching it changes
  // which overlays are installed and therefore why a card is blocked.
  useEffect(() => {
    if (!channelId) return;
    const params = new URLSearchParams({
      theme: cfg.theme,
      style_pack: cfg.style_pack,
      component_pack: cfg.component_pack ?? "",
    });
    fetch(`/api/channels/${channelId}/look-options?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setOptions)
      .catch(() => setOptions(null));
  }, [channelId, cfg.theme, cfg.style_pack, cfg.component_pack]);

  function setExcluded(key: GroupKey, values: string[]) {
    patch((d) => {
      const next = { ...(d.look?.exclude ?? {}) } as Record<string, string[]>;
      if (values.length) next[key] = values;
      else delete next[key];
      d.look = { ...d.look, exclude: Object.keys(next).length ? (next as Exclusions) : undefined };
      if (!d.look.exclude && !d.look.background) delete d.look;
    });
  }

  function toggleExcluded(key: GroupKey, name: string) {
    const current = ((exclude as Record<string, string[] | undefined>)[key] ?? []).slice();
    const at = current.indexOf(name);
    if (at >= 0) current.splice(at, 1);
    else current.push(name);
    setExcluded(key, current);
  }

  function chooseBackground(name: string | null) {
    patch((d) => {
      const nextLook = { ...(d.look ?? {}) };
      if (name) nextLook.background = { ...nextLook.background, image: name };
      else delete nextLook.background;
      d.look = nextLook;
      if (!d.look.exclude && !d.look.background) delete d.look;
    });
  }

  async function upload(file: File) {
    setNote(null);
    const form = new FormData();
    form.set("file", file);
    const res = await fetch(`/api/channels/${channelId}/backgrounds`, { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNote(body.error ?? `upload failed (${res.status})`);
      return;
    }
    loadBackgrounds();
    chooseBackground(body.name);
  }

  const themeNames = themeRows.length ? themeRows.map((t) => t.name) : themes;
  const activeTheme = themeRows.find((t) => t.name === cfg.theme)?.doc ?? null;
  /** What the active group offers, and what this channel has already taken out
   *  of it. Both keyed off `group`, so the menu is the only thing that decides
   *  which list the card is editing. */
  const activeOffers = options?.offers?.[GROUPS.find((g) => g.key === group)!.from] ?? [];
  const excludedHere = ((exclude as Record<string, string[] | undefined>)[group] ?? []) as string[];

  /** Catalog entry per offered component, so a card can be drawn from it. */
  const componentCards = useMemo(() => {
    const byName = new Map(catalog.map((i) => [i.entry.name, i]));
    return (options?.offers.components ?? []).map((offer) => ({
      offer,
      item: byName.get(offer.name) ?? null,
    }));
  }, [catalog, options]);

  /** Every pack a channel could draw from — `core` is one of them, not a floor
   *  under the others. */
  const componentPacks = useMemo(() => {
    const names = new Set(componentCards.map((c) => c.offer.pack).filter((p): p is string => !!p));
    return [...names].sort();
  }, [componentCards]);

  /**
   * The grid shows `core` plus the CHOSEN pack, and nothing else. Another
   * pack's components are not this channel's to consider — drawn blocked they
   * were cards of noise around the ones that matter. A component still blocked
   * here is one the style pack declines, which is worth seeing.
   */
  const packCards = useMemo(() => {
    // core PLUS the installed pack: packs are additive (D66), so a channel on
    // A pack draws its own entries AND all of core. Filtering to the
    // installed pack alone showed two cards for a menu of twenty-eight.
    const installed = cfg.component_pack && cfg.component_pack !== "core"
      ? ["core", cfg.component_pack]
      : ["core"];
    return componentCards.filter(({ offer }) => installed.includes(offer.pack ?? "core"));
  }, [componentCards, cfg.component_pack]);

  const visibleCards = useMemo(() => {
    const q = search.trim().toLowerCase();
    return packCards.filter(({ offer }) => (q ? offer.name.toLowerCase().includes(q) : true));
  }, [packCards, search]);

  const selectedBackground = look.background?.image ?? null;

  /** A master switch the pack or theme has already decided. Drawn off and
   *  locked: leaving it live would promise a sound that cannot play. */
  function SoundSwitch({
    name,
    desc,
    lock,
    checked,
    onToggle,
  }: {
    name: string;
    desc: string;
    lock: string | null;
    checked: boolean;
    onToggle: (on: boolean) => void;
  }) {
    return (
      <div className={`${scr.toggleRow}${lock ? " " + s.lockedRow : ""}`}>
        <div className={scr.toggleMain}>
          <div className={scr.toggleName}>
            {name}
            {lock && <span className={s.lockTag}>Blocked</span>}
          </div>
          <div className={scr.toggleDesc}>{lock ?? desc}</div>
        </div>
        <Toggle
          checked={lock ? false : checked}
          disabled={disabled || !!lock}
          title={lock ?? undefined}
          onChange={onToggle}
        />
      </div>
    );
  }

  return (
    <div className={scr.stack}>
      {show("background") && (
        <div className={scr.card}>
          <h2 className={scr.h2}>Background image</h2>
          <p className={scr.cardSub}>
            The plate behind anything that does not fill the frame — a title card standing in for a shot the
            sources could not match, above all. Without one, both renderers draw a flat colour fill.
          </p>
          <div className={s.bgLayout}>
            <div className={s.gallery}>
              <button
                type="button"
                disabled={disabled}
                className={`${s.swatch} ${s.swatchNone}${selectedBackground ? "" : " " + s.on}`}
                onClick={() => chooseBackground(null)}
              >
                Colour fill
              </button>
              {backgrounds.map((bg) => (
                <button
                  key={bg.name}
                  type="button"
                  disabled={disabled}
                  title={bg.name}
                  className={`${s.swatch}${selectedBackground === bg.name ? " " + s.on : ""}`}
                  onClick={() => chooseBackground(bg.name)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/channels/${channelId}/backgrounds/${encodeURIComponent(bg.name)}`} alt="" />
                  <span className={s.swatchName}>{bg.name}</span>
                </button>
              ))}
            </div>

            <div className={s.selected}>
              <div className={s.selectedHead}>
                <span className={s.selectedTitle}>Selected image</span>
                <button type="button" className={s.uploadBtn} disabled={disabled}
                        onClick={() => fileInput.current?.click()}>
                  Upload image
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 11V3.5M5 6.5L8 3.5l3 3M3 12.5h10" />
                  </svg>
                </button>
                <input
                  ref={fileInput}
                  className={s.hidden}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    const f = e.currentTarget.files?.[0];
                    if (f) upload(f);
                    e.currentTarget.value = "";
                  }}
                />
              </div>
              <div className={s.preview}>
                {selectedBackground ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={`/api/channels/${channelId}/backgrounds/${encodeURIComponent(selectedBackground)}`} alt={selectedBackground} />
                ) : (
                  <span className={s.previewNote}>
                    No background — a card stands on a flat colour fill.
                  </span>
                )}
              </div>
              {selectedBackground && (
                <div className={s.selectedFoot}>
                  <span className={s.previewNote}>{selectedBackground}</span>
                  <div className={s.fitRow}>
                    {(["cover", "contain"] as const).map((fit) => (
                      <button key={fit} type="button" disabled={disabled}
                              className={`${scr.segment}${(look.background?.fit ?? "cover") === fit ? " " + scr.on : ""}`}
                              onClick={() => patch((d) => {
                                d.look = { ...d.look, background: { ...d.look?.background, fit } };
                              })}>
                        {fit}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {note && <div className={s.previewNote} style={{ color: "var(--status-danger-fg)", marginTop: 10 }}>{note}</div>}
            </div>
          </div>
        </div>
      )}

      {show("theme") && (
        <div className={scr.card}>
          <h2 className={scr.h2}>Theme selection</h2>
          <p className={scr.cardSub}>
            Colours, typography, motion feel and the sound cues that ship with them. The theme is the only
            half of the look the AI never sees — it reaches the renderer and nothing else.
          </p>
          <div className={s.themeLayout}>
            <div className={s.themeList}>
              {themeNames.map((name) => {
                const doc = themeRows.find((t) => t.name === name)?.doc ?? null;
                const colors = doc?.colors;
                return (
                  <button key={name} type="button" disabled={disabled}
                          className={`${s.themeOption}${cfg.theme === name ? " " + s.on : ""}`}
                          onClick={() => patch((d) => { d.theme = name; })}>
                    <span className={s.themePlate} style={{ background: colors?.bg ?? "var(--surface-field)" }}>
                      {colors && (
                        <>
                          <span className={s.plateBar} style={{ background: colors.accent }} />
                          <span className={s.plateBar} style={{ background: colors.text, opacity: 0.7 }} />
                        </>
                      )}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span className={s.themeName}>{name}</span>
                      <div className={s.themeDesc}>
                        {doc
                          ? `${doc.typography?.display ?? "—"} · ${doc.motion_feel ?? "neutral"}${doc.grain && doc.grain !== "none" ? ` · ${doc.grain}` : ""}`
                          : "not readable on disk"}
                      </div>
                    </span>
                  </button>
                );
              })}
              {themeNames.length === 0 && <div className={scr.toggleDesc}>No themes on disk.</div>}
            </div>
            <div className={s.themePreview}>
              {activeTheme ? (
                <ThemeFrame theme={activeTheme} />
              ) : (
                <div className={s.previewNote}>
                  {cfg.theme
                    ? `themes/${cfg.theme}.json is not readable — nothing to preview.`
                    : "Pick a theme to preview it."}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {show("elements") && (
        <div className={scr.card}>
          <h2 className={scr.h2}>Overlays, transitions &amp; sound</h2>
          <p className={scr.cardSub}>
            These come from the style pack <strong>{cfg.style_pack}</strong> and the theme{" "}
            <strong>{cfg.theme}</strong>. You cannot add to them here — you exclude the ones this{" "}
            {scope} should not use, and the exclusion is applied to the embedded documents when the video is
            queued. Anything <em>blocked</em> is the pack&apos;s or the theme&apos;s decision; change it on{" "}
            <Link href="/style-packs">Style packs</Link> or <Link href="/themes">Themes</Link>.
          </p>

          {options?.missing?.length ? (
            <div className={`${scr.notice} ${scr.noticeDanger}`}>
              Not on disk: {options.missing.join(", ")} — the menus below are empty until it exists.
            </div>
          ) : null}

          <div>
            <div className={scr.toggleRow}>
              <div className={scr.toggleMain}>
                <div className={scr.toggleName}>Captions</div>
                <div className={scr.toggleDesc}>Burned in by the renderer, using the theme&apos;s preset.</div>
              </div>
              <Toggle checked={cfg.captions?.enabled !== false} disabled={disabled}
                      onChange={(on) => patch((d) => { d.captions = { ...d.captions, enabled: on }; })} />
            </div>
            <SoundSwitch
              name="Music bed"
              desc="The master switch. Off, no bed is produced whatever the theme offers."
              lock={options?.locks?.music ?? null}
              checked={cfg.source_policy?.music?.enabled !== false}
              onToggle={(on) => patch((d) => { d.source_policy.music = { ...d.source_policy.music, enabled: on }; })}
            />
            <SoundSwitch
              name="Sound effects"
              desc="The master switch. Off, no cue fires whatever the pack allows."
              lock={options?.locks?.sfx ?? null}
              checked={cfg.source_policy?.sfx?.enabled !== false}
              onToggle={(on) => patch((d) => { d.source_policy.sfx = { ...d.source_policy.sfx, enabled: on }; })}
            />
          </div>

          <div className={s.groupTabs}>
            {GROUPS.map((g) => {
              const count = ((exclude as Record<string, string[] | undefined>)[g.key] ?? []).length;
              return (
                <button key={g.key} type="button"
                        className={`${s.groupTab}${group === g.key ? " " + s.on : ""}`}
                        onClick={() => { setGroup(g.key); setSearch(""); }}>
                  {g.label}
                  {count > 0 && <span className={s.excount}>{count}</span>}
                </button>
              );
            })}
          </div>

          <div className={s.groupHead}>
            <div className={scr.toggleDesc}>{GROUPS.find((g) => g.key === group)!.note}</div>
            {excludedHere.length > 0 && !disabled && (
              <Button size="sm" variant="ghost" onClick={() => setExcluded(group, [])}>
                Clear {excludedHere.length}
              </Button>
            )}
          </div>

          {group === "components" ? (
            <>
              <div className={s.packPick}>
                <Dropdown
                  label="Component pack"
                  disabled={disabled}
                  options={componentPacks.length ? componentPacks : ["core"]}
                  value={cfg.component_pack || "core"}
                  onChange={(v) => patch((d) => { d.component_pack = v; })}
                />
                <div className={scr.toggleDesc}>
                  The one pack this channel draws from — <strong>core</strong> is a pack like any
                  other here, not a floor under the rest. The {packCards.length} component
                  {packCards.length === 1 ? "" : "s"} in{" "}
                  <strong>{cfg.component_pack || "core"}</strong> are the whole menu; nothing in any
                  other pack reaches the planner.
                </div>
              </div>

              {options && options.usableComponents === 0 && (
                <div className={`${scr.notice} ${scr.noticeDanger}`}>
                  {/* one child: .notice is a flex row, so inline <strong>s would
                      each become a flex item and the sentence would break up */}
                  <span>
                    <strong>{cfg.component_pack || "core"}</strong> shares no component with what the
                    style pack <strong>{cfg.style_pack}</strong> allows, so this channel has no
                    overlay to draw and a video will be refused at enqueue. Pick another component
                    pack, or widen the style pack&apos;s allowed components on{" "}
                    <Link href="/style-packs">Style packs</Link>.
                  </span>
                </div>
              )}

              <div className={s.search}>
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="var(--text-faint)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="7.2" cy="7.2" r="4.4" />
                  <path d="M10.6 10.6L13.5 13.5" />
                </svg>
                <input className={s.searchInput} value={search} placeholder="Search overlays"
                       onChange={(e) => setSearch(e.currentTarget.value)} />
              </div>

              <div className={s.cardGrid}>
                {visibleCards.map(({ offer, item }) => {
                  const off = excludedHere.includes(offer.name);
                  const blocked = offer.blockedBy;
                  const isFallback = options?.fallbackComponent === offer.name;
                  const state = blocked ? "Blocked" : off ? "Excluded" : "In use";
                  return (
                    <button
                      key={offer.name}
                      type="button"
                      disabled={disabled || !!blocked}
                      title={blocked ? `Blocked by ${blocked}` : offer.name}
                      className={`${s.overlayCard}${off ? " " + s.off : ""}${blocked ? " " + s.blocked : ""}`}
                      onClick={() => toggleExcluded("components", offer.name)}
                    >
                      <span className={s.thumb}>
                        {item && activeTheme ? (
                          <OverlayThumb
                            component={offer.name}
                            props={previewPropsFor(item, templates)}
                            theme={activeTheme}
                            template={item.entry.template ?? null}
                            durationSeconds={previewDuration(item.entry)}
                          />
                        ) : (
                          <span className={s.thumbEmpty}>{item ? "no theme" : "not in the catalog"}</span>
                        )}
                      </span>
                      <span className={s.overlayFoot}>
                        <span className={s.overlayName}>{offer.name}</span>
                        <span className={`${s.state} ${blocked ? s.stateBlocked : off ? s.stateOff : s.stateOn}`}>
                          {state}
                        </span>
                      </span>
                      {blocked && <span className={s.blockNote}>Blocked by {blocked}</span>}
                      {!blocked && isFallback && <span className={s.blockNote}>Used for fallback cards</span>}
                    </button>
                  );
                })}
                {visibleCards.length === 0 && (
                  <div className={s.emptyNote}>
                    {packCards.length === 0
                      ? `The ${cfg.component_pack || "core"} pack has no components in the catalog.`
                      : "Nothing in this pack matches that search."}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className={s.exampleGrid}>
              {activeOffers.map((offer) => {
                const off = excludedHere.includes(offer.name);
                const isDefault = group === "transitions" && options?.defaultTransition === offer.name;
                const blocked = offer.blockedBy;
                const state = blocked ? "Blocked" : off ? "Excluded" : "In use";
                return (
                  <div
                    key={offer.name}
                    className={`${s.exampleCard}${off ? " " + s.off : ""}${blocked ? " " + s.blocked : ""}`}
                  >
                    <div className={s.exampleTop}>
                      {group === "transitions" ? (
                        <TransitionThumb kind={offer.name} />
                      ) : (
                        <SoundThumb
                          url={offer.sound?.url ?? null}
                          name={offer.sound?.name ?? null}
                          label={group === "moods" ? "bed" : "cue"}
                        />
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={disabled || !!blocked}
                      title={blocked ? `Blocked by ${blocked}` : undefined}
                      className={s.exampleFoot}
                      onClick={() => toggleExcluded(group, offer.name)}
                    >
                      <span className={s.exampleName}>
                        {offer.name}
                        {isDefault && !blocked && <span className={s.pillNote}>pack default</span>}
                      </span>
                      <span className={`${s.state} ${blocked ? s.stateBlocked : off ? s.stateOff : s.stateOn}`}>
                        {state}
                      </span>
                    </button>
                    {blocked && <span className={s.blockNote}>Blocked by {blocked}</span>}
                    {!blocked && isDefault && off && (
                      <span className={s.blockNote}>
                        The pack&apos;s default — the compiler will fall back to another allowed
                        transition for anything the planner leaves unspecified.
                      </span>
                    )}
                  </div>
                );
              })}
              {activeOffers.length === 0 && (
                <span className={s.emptyNote}>Nothing on disk to offer here.</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
