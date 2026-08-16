"use client";
/**
 * Look editor — the "Background image", "Theme selection" and
 * "Overlays, transitions & sound" cards from VidRush.dc.html, shared by the
 * quote statement's Look tab and the brand profile's Visual tab.
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
 * (`/api/channels/[id]/look-options`) rather than from a hardcoded menu.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChannelConfig } from "@lusora/contracts";
import { Button, Toggle } from "@/components/ds";
import scr from "@/app/(app)/screen.module.css";
import s from "./LookEditor.module.css";

type Look = NonNullable<ChannelConfig["look"]>;
type Exclude = NonNullable<Look["exclude"]>;

interface LookOptions {
  theme: string;
  style_pack: string;
  missing: string[];
  components: string[];
  componentsFromPack: boolean;
  transitions: string[];
  defaultTransition: string | null;
  sfxCues: string[];
  sfxEnabled: boolean;
  musicEnabled: boolean;
  moods: string[];
  soundPack: string | null;
  fallbackComponent: string | null;
}
interface BackgroundRow {
  name: string;
  bytes: number;
}

/** The four things a pack/theme offers, and the exclude key each writes to. */
const GROUPS = [
  { key: "components", label: "Overlays", from: "components" },
  { key: "transitions", label: "Transitions", from: "transitions" },
  { key: "sfx_cues", label: "SFX", from: "sfxCues" },
  { key: "moods", label: "Music", from: "moods" },
] as const;
type GroupKey = (typeof GROUPS)[number]["key"];

const GROUP_NOTE: Record<GroupKey, string> = {
  components: "Components the planner may choose from. Excluding one takes it off the menu before the AI sees it.",
  transitions: "Cuts the compiler may place between shots. The style pack's default cannot be excluded.",
  sfx_cues: "Which events may fire a sound effect at all. The theme picks which sound; the pack picks how many.",
  moods: "Moods that have a music bed. An excluded mood plays with no bed under it — silence under the turn.",
};

const PLATES = [
  "linear-gradient(160deg,#1a1a1d,#0d0d0f)",
  "linear-gradient(160deg,#2b2b2e,#141416)",
  "linear-gradient(160deg,#0e3b2c,#061a14)",
  "linear-gradient(160deg,#c9d8e0,#8ea3ae)",
  "linear-gradient(160deg,#efe7d8,#cfc3ac)",
  "linear-gradient(160deg,#3a2a18,#1a1208)",
  "linear-gradient(160deg,#0a0a0b,#000)",
  "linear-gradient(160deg,#e8ded0,#b9a98f)",
];
const plateFor = (key: string) =>
  PLATES[[...key].reduce((a, c) => (a + c.charCodeAt(0)) % PLATES.length, 0)];

export default function LookEditor({
  channelId,
  cfg,
  themes,
  onChange,
  disabled = false,
}: {
  channelId: string;
  cfg: ChannelConfig;
  themes: string[];
  onChange: (next: ChannelConfig) => void;
  disabled?: boolean;
}) {
  const [options, setOptions] = useState<LookOptions | null>(null);
  const [backgrounds, setBackgrounds] = useState<BackgroundRow[]>([]);
  const [group, setGroup] = useState<GroupKey>("components");
  const [search, setSearch] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const look: Look = cfg.look ?? {};
  const exclude: Exclude = look.exclude ?? {};

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

  // The menu follows the theme / pack currently chosen, saved or not.
  useEffect(() => {
    if (!channelId) return;
    const params = new URLSearchParams({ theme: cfg.theme, style_pack: cfg.style_pack });
    fetch(`/api/channels/${channelId}/look-options?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setOptions)
      .catch(() => setOptions(null));
  }, [channelId, cfg.theme, cfg.style_pack]);

  function setExcluded(key: GroupKey, values: string[]) {
    patch((d) => {
      const next = { ...(d.look?.exclude ?? {}) } as Record<string, string[]>;
      if (values.length) next[key] = values;
      else delete next[key];
      d.look = { ...d.look, exclude: Object.keys(next).length ? (next as Exclude) : undefined };
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

  const available: string[] = useMemo(() => {
    if (!options) return [];
    const from = GROUPS.find((g) => g.key === group)!.from;
    return (options[from] as string[]) ?? [];
  }, [options, group]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? available.filter((n) => n.toLowerCase().includes(q)) : available;
  }, [available, search]);

  const excludedHere = ((exclude as Record<string, string[] | undefined>)[group] ?? []) as string[];
  const selectedBackground = look.background?.image ?? null;
  const activeCount = (key: GroupKey) =>
    ((exclude as Record<string, string[] | undefined>)[key] ?? []).length;

  return (
    <div className={scr.stack}>
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

      <div className={scr.card}>
        <h2 className={scr.h2}>Theme selection</h2>
        <p className={scr.cardSub}>The styling for the motion-graphics templates used in generated videos.</p>
        <div className={scr.stackTight}>
          {themes.map((name) => (
            <button key={name} type="button" disabled={disabled}
                    className={`${s.themeOption}${cfg.theme === name ? " " + s.on : ""}`}
                    onClick={() => patch((d) => { d.theme = name; })}>
              <span className={s.themePlate} style={{ background: plateFor(name) }} />
              <span style={{ minWidth: 0 }}>
                <span className={s.themeName}>{name}</span>
                <div className={s.themeDesc}>
                  Colours, typography, motion feel, and the sound cues that ship with it.
                </div>
              </span>
            </button>
          ))}
          {themes.length === 0 && <div className={scr.toggleDesc}>No themes on disk.</div>}
        </div>
      </div>

      <div className={scr.card}>
        <h2 className={scr.h2}>Overlays, transitions &amp; sound</h2>
        <p className={scr.cardSub}>
          These come from the style pack <strong>{cfg.style_pack}</strong> and the theme{" "}
          <strong>{cfg.theme}</strong>. You cannot add to them here — you exclude the ones this{" "}
          {channelId ? "brand" : "video"} should not use, and the exclusion is applied to the embedded
          documents when the video is queued.
        </p>

        <div>
          <div className={scr.toggleRow}>
            <div className={scr.toggleMain}>
              <div className={scr.toggleName}>Captions</div>
              <div className={scr.toggleDesc}>Burned in by the renderer, using the theme&apos;s preset.</div>
            </div>
            <Toggle checked={cfg.captions?.enabled !== false} disabled={disabled}
                    onChange={(on) => patch((d) => { d.captions = { ...d.captions, enabled: on }; })} />
          </div>
          <div className={scr.toggleRow}>
            <div className={scr.toggleMain}>
              <div className={scr.toggleName}>Music bed</div>
              <div className={scr.toggleDesc}>
                The master switch. Off, no bed is produced whatever the theme offers.
              </div>
            </div>
            <Toggle checked={cfg.source_policy?.music?.enabled !== false} disabled={disabled}
                    onChange={(on) => patch((d) => { d.source_policy.music = { ...d.source_policy.music, enabled: on }; })} />
          </div>
          <div className={scr.toggleRow}>
            <div className={scr.toggleMain}>
              <div className={scr.toggleName}>Sound effects</div>
              <div className={scr.toggleDesc}>
                The master switch. Off, no cue fires whatever the pack allows.
              </div>
            </div>
            <Toggle checked={cfg.source_policy?.sfx?.enabled !== false} disabled={disabled}
                    onChange={(on) => patch((d) => { d.source_policy.sfx = { ...d.source_policy.sfx, enabled: on }; })} />
          </div>
        </div>

        <div className={s.exHead} style={{ marginTop: 20 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className={scr.eyebrow} style={{ marginBottom: 4 }}>Exclusions</div>
            <div className={scr.toggleDesc}>{GROUP_NOTE[group]}</div>
          </div>
          <div className={s.exTabs}>
            {GROUPS.map((g) => (
              <button key={g.key} type="button"
                      className={`${s.exTab}${group === g.key ? " " + s.on : ""}`}
                      onClick={() => { setGroup(g.key); setSearch(""); }}>
                {g.label}
                {activeCount(g.key) > 0 && <span className={s.count}>{activeCount(g.key)}</span>}
              </button>
            ))}
          </div>
        </div>

        {options?.missing?.length ? (
          <div className={`${scr.notice} ${scr.noticeDanger}`}>
            Not on disk: {options.missing.join(", ")} — the menu below is empty until it exists.
          </div>
        ) : null}

        <div className={s.exLayout}>
          <div>
            <div className={s.search}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="var(--text-faint)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="7.2" cy="7.2" r="4.4" />
                <path d="M10.6 10.6L13.5 13.5" />
              </svg>
              <input className={s.searchInput} value={search} placeholder="Search"
                     onChange={(e) => setSearch(e.currentTarget.value)} />
            </div>
            <div className={s.items}>
              {filtered.map((name) => {
                const off = excludedHere.includes(name);
                const isDefault = group === "transitions" && options?.defaultTransition === name;
                const isFallback = group === "components" && options?.fallbackComponent === name;
                return (
                  <button key={name} type="button"
                          disabled={disabled || isDefault}
                          title={isDefault ? "the style pack's default transition cannot be excluded" : undefined}
                          className={`${s.item}${off ? " " + s.off : ""}`}
                          onClick={() => toggleExcluded(group, name)}>
                    <span className={s.itemMain}>
                      <span className={s.itemName}>{name}</span>
                      {isDefault && <span className={s.itemNote}>pack default</span>}
                      {isFallback && <span className={s.itemNote}>used for fallback cards</span>}
                    </span>
                    <span className={s.state}>{off ? "Excluded" : "In use"}</span>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <div className={s.emptyNote}>
                  {available.length === 0
                    ? group === "components" && options && !options.componentsFromPack
                      ? "This style pack allows the whole catalog and the catalog is empty."
                      : "The pack and theme offer nothing here."
                    : "Nothing matches that search."}
                </div>
              )}
            </div>
          </div>

          <div className={s.excluded}>
            <div className={s.excludedHead}>
              <span className={s.excludedTitle}>Excluded</span>
              <span className={s.excludedCount}>{excludedHere.length}</span>
            </div>
            <div className={s.chips}>
              {excludedHere.map((name) => (
                <span key={name} className={s.chip}>
                  {name}
                  {!disabled && (
                    <button type="button" className={s.chipX} onClick={() => toggleExcluded(group, name)}>×</button>
                  )}
                </span>
              ))}
              {excludedHere.length === 0 && (
                <span className={s.emptyNote}>Nothing excluded — everything the pack offers is in use.</span>
              )}
            </div>
            {excludedHere.length > 0 && !disabled && (
              <div className={s.warn}>
                <Button size="sm" variant="ghost" onClick={() => setExcluded(group, [])}>Clear</Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
