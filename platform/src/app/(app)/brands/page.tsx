"use client";
/**
 * Brand profiles — ported from VidRush.dc.html (isBrands).
 *
 * In the mockup a brand is a row of its own that several channels point at.
 * Here the brand profile IS the channel's config document — theme, sound,
 * captions and source policy all live on it — so the brand picker is a
 * channel picker and "channels applied" is the one channel it belongs to.
 *
 * Not drawn, because nothing backs them: the background-image gallery, and
 * per-template blocklisting (the real allow-list is
 * `style_pack.overlays.allowed_components`, a shared document, so it is shown
 * read-only with a link to the Style packs screen instead).
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ChannelConfig } from "@lusora/contracts";
import { Dropdown, StatusBadge, TextInput, Toggle } from "@/components/ds";
import SourcePolicyEditor, { mediaMode } from "@/components/SourcePolicyEditor";
import LookEditor from "@/components/LookEditor";
import scr from "../screen.module.css";
import s from "./brands.module.css";

const TABS = ["Profile", "Visual", "Sourcing"];

interface ChannelRow {
  id: string;
  name: string;
  language: string;
  video_type: string;
  theme: string;
  style_pack: string;
  active: boolean;
}
interface StylePackRow {
  name: string;
  doc: { overlays?: { allowed_components?: string[]; density?: unknown } } | null;
}

/** Deterministic plate per brand so the swatches read as identities, not noise. */
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

function BrandsScreen() {
  const params = useSearchParams();
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [selected, setSelected] = useState(params.get("channel") ?? "");
  const [cfg, setCfg] = useState<ChannelConfig | null>(null);
  const [tab, setTab] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [options, setOptions] = useState<{ themes: string[]; soundPacks: string[]; componentPacks: string[] }>({
    themes: [],
    soundPacks: [],
    componentPacks: [],
  });
  const [stylePacks, setStylePacks] = useState<StylePackRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [role, setRole] = useState("");

  const canEdit = role === "admin" || role === "manager";

  const loadChannels = useCallback(async () => {
    const res = await fetch("/api/channels");
    if (!res.ok) return;
    const rows: ChannelRow[] = await res.json();
    setChannels(rows);
    setSelected((prev) => prev || rows[0]?.id || "");
  }, []);

  useEffect(() => {
    loadChannels();
    fetch("/api/auth/me").then(async (r) => r.ok && setRole((await r.json()).role ?? ""));
    fetch("/api/config-options")
      .then((r) => (r.ok ? r.json() : null))
      .then((o) => o && setOptions({
        themes: o.themes ?? [],
        soundPacks: o.soundPacks ?? [],
        componentPacks: o.componentPacks ?? [],
      }))
      .catch(() => undefined);
    fetch("/api/style-packs")
      .then((r) => (r.ok ? r.json() : []))
      .then(setStylePacks)
      .catch(() => setStylePacks([]));
  }, [loadChannels]);

  useEffect(() => {
    if (!selected) return setCfg(null);
    setNote(null);
    fetch(`/api/channels/${selected}/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setCfg)
      .catch(() => setCfg(null));
  }, [selected]);

  function patch(fn: (d: ChannelConfig) => void) {
    setCfg((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
  }

  async function save() {
    if (!cfg) return;
    setSaving(true);
    setNote(null);
    try {
      const res = await fetch(`/api/channels/${selected}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      const body = await res.json().catch(() => ({}));
      setNote(res.ok ? { text: "Saved." } : { text: body.error ?? `save failed (${res.status})`, bad: true });
      if (res.ok) loadChannels();
    } finally {
      setSaving(false);
    }
  }

  const channel = channels.find((c) => c.id === selected) ?? null;
  const pack = stylePacks.find((p) => p.name === cfg?.style_pack);
  const allowed = pack?.doc?.overlays?.allowed_components ?? [];
  const chain = cfg?.source_policy?.visual?.chain ?? [];

  return (
    <div className={scr.screen}>
      <div className={scr.sticky}>
        <div className={scr.head}>
          <div className={scr.headMain}>
            <h1 className={scr.h1}>Brand profiles</h1>
            <p className={scr.sub}>
              The look, sound and sourcing rules every video on a channel inherits. A video can override any of
              it on its quote statement; changing it here changes what future videos start from.
            </p>
          </div>
          <div className={s.picker}>
            <button type="button" className={s.pickerBtn} onClick={() => setPickerOpen((o) => !o)}>
              <span className={s.pickerSwatch} style={{ background: plateFor(selected || "x") }} />
              <span className={s.pickerName}>{channel?.name ?? "No channel"}</span>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--text-faint)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 6l4 4 4-4" />
              </svg>
            </button>
            {pickerOpen && (
              <div className={s.pickerMenu}>
                {channels.map((c) => (
                  <button key={c.id} type="button"
                          className={`${s.pickerItem}${c.id === selected ? " " + s.on : ""}`}
                          onClick={() => { setSelected(c.id); setPickerOpen(false); }}>
                    {c.name}
                  </button>
                ))}
                {channels.length === 0 && <div className={scr.toggleDesc} style={{ padding: 8 }}>No channels.</div>}
              </div>
            )}
            {canEdit && (
              <button type="button" className={s.saveBtn} disabled={saving || !cfg} onClick={save}>
                {saving ? "Saving…" : "Save"}
              </button>
            )}
          </div>
        </div>
        <div className={scr.tabs}>
          {TABS.map((name, i) => (
            <button key={name} type="button" className={`${scr.tab}${tab === i ? " " + scr.active : ""}`} onClick={() => setTab(i)}>
              {name}
            </button>
          ))}
        </div>
      </div>

      <div className={scr.wrap}>
        {!cfg && <div className={scr.card}><div className={scr.toggleDesc}>Select a brand profile.</div></div>}

        {cfg && tab === 0 && (
          <div className={scr.stack}>
            <div>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
                <div className={scr.eyebrow} style={{ marginBottom: 0 }}>All brands</div>
                <span className={scr.toggleDesc}>Select a brand to edit its identity, look and source policy.</span>
              </div>
              <div className={s.cards}>
                {channels.map((c) => (
                  <button key={c.id} type="button"
                          className={`${s.brandCard}${c.id === selected ? " " + s.on : ""}`}
                          onClick={() => setSelected(c.id)}>
                    <span className={s.brandSwatch} style={{ background: plateFor(c.id) }} />
                    <span style={{ minWidth: 0 }}>
                      <span className={s.brandName}>{c.name}</span>
                      <div className={s.brandMeta}>{c.theme} · {c.style_pack}</div>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className={scr.splitEven}>
              <div className={scr.card}>
                <h2 className={scr.h2}>Identity</h2>
                <p className={scr.cardSub}>What the narration sounds like and which channel this profile serves.</p>
                <div className={scr.stack}>
                  <TextInput label="Brand name" value={cfg.name} disabled={!canEdit}
                             onChange={(e) => { const v = e.currentTarget.value; patch((d) => { d.name = v; }); }} />
                  <div className={scr.grid2}>
                    <TextInput label="Voice provider" value={cfg.voice?.provider ?? ""} disabled={!canEdit}
                               onChange={(e) => { const v = e.currentTarget.value; patch((d) => { d.voice = { ...d.voice, provider: v }; }); }} />
                    <TextInput label="Voiceover id" value={cfg.voice?.voice_id ?? ""} disabled={!canEdit}
                               onChange={(e) => { const v = e.currentTarget.value; patch((d) => { d.voice = { ...d.voice, voice_id: v || undefined }; }); }} />
                  </div>
                  <div>
                    <div className={scr.fieldLabel}>Channel applied</div>
                    <div className={s.chipList}>
                      <span className={s.chip}>{cfg.channel_id}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className={scr.stack}>
                <div className={`${scr.card} ${scr.cardTight}`}>
                  <div className={scr.eyebrow}>Visual</div>
                  <div style={{ display: "flex", gap: 14 }}>
                    <span className={s.themePlate} style={{ background: plateFor(cfg.theme) }} />
                    <div>
                      <div className={s.themeName}>{cfg.theme}</div>
                      <div className={s.themeDesc}>{cfg.style_pack} · {cfg.video_type}</div>
                      <div className={s.themeDesc}>
                        {cfg.component_pack ? `component pack ${cfg.component_pack}` : "core components only"}
                      </div>
                    </div>
                  </div>
                </div>

                <div className={`${scr.card} ${scr.cardTight}`}>
                  <div className={scr.eyebrow}>Captions</div>
                  <div className={scr.toggleRow} style={{ borderTop: "none", paddingTop: 0 }}>
                    <div className={scr.toggleMain}>
                      <div className={scr.toggleName}>Burn captions by default</div>
                      <div className={scr.toggleDesc}>
                        Applies to every video on this brand. Can be overridden per video.
                      </div>
                    </div>
                    <Toggle checked={cfg.captions?.enabled !== false} disabled={!canEdit}
                            onChange={(on) => patch((d) => { d.captions = { ...d.captions, enabled: on }; })} />
                  </div>
                </div>

                <div className={`${scr.card} ${scr.cardTight}`}>
                  <div className={scr.eyebrow}>Sound</div>
                  <div className={scr.stackTight}>
                    <div className={scr.kv}>
                      <span>Sound pack</span><span>{cfg.source_policy?.sound_pack ?? "from the theme"}</span>
                    </div>
                    <div className={scr.kv}>
                      <span>Music</span>
                      <StatusBadge label={cfg.source_policy?.music?.enabled === false ? "Off" : "On"}
                                   tone={cfg.source_policy?.music?.enabled === false ? "neutral" : "success"} />
                    </div>
                    <div className={scr.kv}>
                      <span>Sound effects</span>
                      <StatusBadge label={cfg.source_policy?.sfx?.enabled === false ? "Off" : "On"}
                                   tone={cfg.source_policy?.sfx?.enabled === false ? "neutral" : "success"} />
                    </div>
                  </div>
                </div>

                <div className={`${scr.card} ${scr.cardTight}`}>
                  <div className={scr.eyebrow}>Source policy</div>
                  <div className={scr.stackTight}>
                    {chain.map((e) => (
                      <div key={e.source} className={scr.kv}>
                        <span>{e.source}</span><span>{mediaMode(e)}</span>
                      </div>
                    ))}
                    {chain.length === 0 && <div className={scr.toggleDesc}>Nothing enabled.</div>}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {cfg && tab === 1 && (
          <div className={scr.stack}>
            <LookEditor
              channelId={selected}
              cfg={cfg}
              themes={options.themes}
              disabled={!canEdit}
              onChange={setCfg}
            />

            <div className={scr.card}>
              <h2 className={scr.h2}>Packs &amp; levels</h2>
              <p className={scr.cardSub}>
                Which packs this brand draws from, and the trims applied on top of the theme&apos;s own mix.
              </p>
              <div className={scr.grid2}>
                <Dropdown label="Sound pack" disabled={!canEdit}
                          options={["", ...options.soundPacks].map((p) => ({ value: p, label: p || "from the theme" }))}
                          value={cfg.source_policy?.sound_pack ?? ""}
                          onChange={(v) => patch((d) => {
                            if (v) d.source_policy.sound_pack = v;
                            else delete d.source_policy.sound_pack;
                          })} />
                <Dropdown label="Component pack" disabled={!canEdit}
                          options={["", ...options.componentPacks].map((p) => ({ value: p, label: p || "core only" }))}
                          value={cfg.component_pack ?? ""}
                          onChange={(v) => patch((d) => { d.component_pack = v || null; })} />
                <TextInput label="Music trim (0–1)" type="number" step="0.05" disabled={!canEdit}
                           value={String(cfg.source_policy?.music?.default_volume ?? 1)}
                           onChange={(e) => { const n = Number(e.currentTarget.value); patch((d) => { d.source_policy.music = { ...d.source_policy.music, default_volume: n }; }); }} />
                <TextInput label="SFX gain (0–1)" type="number" step="0.05" disabled={!canEdit}
                           value={String(cfg.source_policy?.sfx?.default_gain ?? 0.35)}
                           onChange={(e) => { const n = Number(e.currentTarget.value); patch((d) => { d.source_policy.sfx = { ...d.source_policy.sfx, default_gain: n }; }); }} />
              </div>
            </div>

            <div className={scr.card}>
              <h2 className={scr.h2}>Allowed components</h2>
              <p className={scr.cardSub}>
                The planner&apos;s menu as the style pack <strong>{cfg.style_pack}</strong> defines it, before this
                brand&apos;s exclusions. It is a shared document — edit it on <Link href="/style-packs">Style packs</Link>.
              </p>
              {allowed.length > 0 ? (
                <div className={s.chipList}>
                  {allowed.map((c) => <span key={c} className={s.chip}>{c}</span>)}
                </div>
              ) : (
                <div className={scr.toggleDesc}>
                  {pack ? "This style pack allows every component in the catalog." : "Style pack not readable."}
                </div>
              )}
            </div>
          </div>
        )}

        {cfg && tab === 2 && cfg.source_policy?.visual && (
          <SourcePolicyEditor
            visual={cfg.source_policy.visual}
            disabled={!canEdit}
            onChange={(next) => patch((d) => { d.source_policy.visual = next; })}
          />
        )}

        {note && (
          <div className={`${s.saveNote}${note.bad ? " " + s.bad : ""}`} style={{ marginTop: 16 }}>
            {note.text}
          </div>
        )}
      </div>
    </div>
  );
}

export default function BrandsPage() {
  return (
    <Suspense fallback={<div className={scr.loading}>Loading…</div>}>
      <BrandsScreen />
    </Suspense>
  );
}
