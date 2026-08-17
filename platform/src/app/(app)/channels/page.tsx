"use client";
/**
 * Channels — the one screen a channel is configured on.
 *
 * This absorbed the Brands screen. "Brand" came from the mockup this UI was
 * ported from (VidRush), where a brand is a row of its own that several
 * channels point at. In this codebase there is no brands table: a brand
 * profile IS the channel's config document, so a second screen over the same
 * row was a second place to edit the same fields. The tabs it drew — Profile,
 * Visual, Sourcing — are kept; the separate route is gone.
 *
 * What is NOT here is deliberate. This screen carries the decisions a human
 * makes about a channel; everything else — style pack, packs, gains, budgets,
 * prompts, retention, QA — stays on the full config form at
 * /channels/[id], which is unchanged. The rule for what belongs where: if
 * picking it wrong changes what the videos LOOK or SOUND like, it is here; if
 * it is a number you tune once, it is on the advanced form.
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ChannelConfig } from "@lusora/contracts";
import { Button, Dropdown, StatusBadge, TextInput } from "@/components/ds";
import { defaultChannelConfig } from "@/components/ChannelConfigForm";
import LookEditor from "@/components/LookEditor";
import SourcePolicyEditor, { mediaMode } from "@/components/SourcePolicyEditor";
import {
  alternativesFor,
  stylePackForVideoType,
  type StylePackChoice,
  type VideoTypeDefaults,
} from "@/lib/videoType";
// type-only: erased at compile time, so the client bundle never pulls the loader in
import type { PipelineSummary } from "@/lib/pipelines";
import scr from "../screen.module.css";
import s from "./channels.module.css";

interface ChannelRow {
  id: string;
  name: string;
  language: string;
  video_type: string;
  theme: string;
  style_pack: string;
  active: boolean;
}

const TABS = ["Profile", "Visual", "Sourcing"];
const VIDEO_TYPES = ["doc", "explainer", "breakdown", "listicle"];

/** Mirrored from worker/.../providers/tts.py, like the advanced form's copy.
 *  Three of them, so this is a segmented control and not a switch. */
const VOICE_PROVIDERS = [
  { value: "local", label: "Local (flite)" },
  { value: "ai33", label: "ai33" },
  { value: "mock", label: "Mock (silent)" },
];
const LOCAL_VOICES = ["kal", "kal16", "awb", "rms", "slt"];

/**
 * D61 — HOW a channel's videos are made, as opposed to WHAT they are
 * (`video_type`). The list mirrors `pipeline_manifest.category`, because a
 * production style is resolved at enqueue by matching it against exactly that
 * field. `custom` is the "I name the file myself" answer and requires a
 * pinned pipeline, so it is offered last.
 */
const PRODUCTION_STYLES = [
  { value: "faceless", label: "Faceless" },
  { value: "talking_head", label: "Talking head" },
  { value: "animation", label: "Animation" },
  { value: "shorts", label: "Shorts" },
  { value: "ultra_longform", label: "Ultra longform" },
  { value: "custom", label: "Custom (pin a pipeline)" },
];

function ChannelsScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [selected, setSelected] = useState<string>(params.get("channel") ?? "");
  const [cfg, setCfg] = useState<ChannelConfig | null>(null);
  const [tab, setTab] = useState(0);
  const [options, setOptions] = useState<{
    themes: string[];
    stylePacks: StylePackChoice[];
    pipelines: PipelineSummary[];
    videoTypeDefaults: VideoTypeDefaults;
  }>({ themes: [], stylePacks: [], pipelines: [], videoTypeDefaults: {} });
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [role, setRole] = useState("");

  const canEdit = role === "admin" || role === "manager";

  const loadChannels = useCallback(async () => {
    const res = await fetch("/api/channels");
    if (!res.ok) return;
    const rows: ChannelRow[] = await res.json();
    setChannels(rows);
  }, []);

  useEffect(() => {
    loadChannels();
    fetch("/api/auth/me").then(async (r) => r.ok && setRole((await r.json()).role ?? ""));
    fetch("/api/config-options")
      .then((r) => (r.ok ? r.json() : null))
      .then((o) => o && setOptions({
        themes: o.themes ?? [],
        stylePacks: o.stylePacks ?? [],
        pipelines: o.pipelines ?? [],
        videoTypeDefaults: o.videoTypeDefaults ?? {},
      }))
      .catch(() => undefined);
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
      if (!res.ok) {
        setNote({ text: body.error ?? `save failed (${res.status})`, bad: true });
        return;
      }
      setNote({ text: "Saved." });
      loadChannels();
    } finally {
      setSaving(false);
    }
  }

  async function createChannel() {
    const id = window.prompt("Channel id (used in URLs and folder names):", "");
    if (!id?.trim()) return;
    const name = window.prompt("Channel name:", id.trim());
    if (!name?.trim()) return;
    const config = { ...defaultChannelConfig(), channel_id: id.trim(), name: name.trim() };
    const res = await fetch("/api/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNote({ text: body.error ?? `could not create the channel (${res.status})`, bad: true });
      return;
    }
    await loadChannels();
    setSelected(body.id);
  }

  // What the chosen production style resolves to. Deliberately NOT a second
  // copy of the resolver's tie-break (D60: two places that pick a pipeline is
  // two places to disagree) — this reports what the family CONTAINS, and only
  // names a pipeline when the family has exactly one.
  const style = cfg?.production_style ?? "faceless";
  const family = options.pipelines.filter(
    (p) => !p.problem && p.category === style && p.stability === "production"
  );
  const styleNote = cfg?.pipeline
    ? `Pinned to the ${cfg.pipeline} pipeline, so the production style is not consulted.`
    : style === "custom"
      ? "Custom needs a pipeline named explicitly — set one on the video, or enqueue is refused."
      : family.length === 1
        ? `Runs the ${family[0].name} pipeline — ${family[0].stage_count} stages.`
        : family.length === 0
          ? `Nothing in contracts/pipelines carries category: ${style} yet, so enqueue would be refused.`
          : `${family.length} pipelines carry this category; pin one on the video to be explicit.`;

  // The style pack follows the video type here; the advanced form is where a
  // channel is pointed at a specific one. `stylePackForVideoType` keeps a pack
  // that already implements the type, so choosing the type a channel is
  // already set to never discards that choice.
  const packAlternatives = useMemo(
    () => (cfg ? alternativesFor(cfg.video_type, options.stylePacks) : []),
    [cfg, options.stylePacks]
  );
  const packMismatch =
    !!cfg &&
    options.stylePacks.some((p) => p.name === cfg.style_pack) &&
    packAlternatives.length > 0 &&
    !packAlternatives.includes(cfg.style_pack);

  function chooseVideoType(next: string) {
    patch((d) => {
      d.video_type = next as ChannelConfig["video_type"];
      d.style_pack = stylePackForVideoType(next, d.style_pack, options.stylePacks, options.videoTypeDefaults);
    });
  }

  const chain = cfg?.source_policy?.visual?.chain ?? [];
  const provider = cfg?.voice?.provider ?? "";

  return (
    <div className={scr.screen}>
      <div className={scr.wrap}>
        <div className={scr.head} style={{ padding: 0, marginBottom: 24 }}>
          <div className={scr.headMain}>
            <h1 className={scr.h1}>Channels</h1>
            <p className={scr.sub}>
              A channel carries everything its videos start from: who it sounds like, what it looks like, and
              where its footage comes from. A video can override any of it on its quote statement.
            </p>
          </div>
          {canEdit && (
            <button type="button" className={s.newBtn} onClick={createChannel}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <line x1="8" y1="3" x2="8" y2="13" />
                <line x1="3" y1="8" x2="13" y2="8" />
              </svg>
              New channel
            </button>
          )}
        </div>

        {!selected && (
          <div className={scr.card} style={{ padding: 0, overflow: "hidden" }}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>Type</th>
                  <th>Language</th>
                  <th>Theme</th>
                  <th>Style pack</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {channels.map((c) => (
                  <tr key={c.id} tabIndex={0} className={s.row}
                      onClick={() => setSelected(c.id)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(c.id); } }}>
                    <td>
                      <span className={s.rowName}>
                        <span className={`${s.dot}${c.active ? "" : " " + s.off}`} />
                        {c.name}
                      </span>
                    </td>
                    <td>{c.video_type}</td>
                    <td>{c.language}</td>
                    <td>{c.theme}</td>
                    <td>{c.style_pack}</td>
                    <td className={s.rowGo}>Configure →</td>
                  </tr>
                ))}
                {channels.length === 0 && (
                  <tr><td colSpan={6} className={scr.toggleDesc} style={{ padding: 18 }}>No channels yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {selected && (
          <div className={s.detail}>
            {!cfg && <div className={scr.card}><div className={scr.toggleDesc}>Loading the channel&apos;s configuration…</div></div>}

            {cfg && (
              <>
                <button type="button" className={s.backBtn}
                        onClick={() => { setSelected(""); setCfg(null); setTab(0); setNote(null); }}>
                  ← All channels
                </button>
                <div className={s.tabRow}>
                  <div className={scr.tabs} style={{ padding: 0, border: "none" }}>
                    {TABS.map((name, i) => (
                      <button key={name} type="button"
                              className={`${scr.tab}${tab === i ? " " + scr.active : ""}`}
                              onClick={() => setTab(i)}>
                        {name}
                      </button>
                    ))}
                  </div>
                  <Button variant="ghost" size="sm"
                          onClick={() => router.push(`/channels/${selected}?tab=settings`)}>
                    Advanced config
                  </Button>
                </div>

                {tab === 0 && (
                  <div className={scr.stack}>
                    <div className={scr.card}>
                      <h2 className={scr.h2}>Profile</h2>
                      <p className={scr.cardSub}>
                        What this channel is and what it sounds like. Everything here is a default a single
                        video can override on its quote statement.
                      </p>
                      <div className={scr.stack}>
                        <div className={scr.grid2}>
                          <TextInput label="Brand name" value={cfg.name} disabled={!canEdit}
                                     onChange={(e) => { const v = e.currentTarget.value; patch((d) => { d.name = v; }); }} />
                          <TextInput label="Language" value={cfg.language} disabled={!canEdit}
                                     onChange={(e) => { const v = e.currentTarget.value; patch((d) => { d.language = v; }); }} />
                        </div>

                        <div className={scr.grid2}>
                          <div>
                            <div className={scr.fieldLabel}>Voiceover provider</div>
                            <div className={scr.segments}>
                              {VOICE_PROVIDERS.map((p) => (
                                <button key={p.value} type="button" disabled={!canEdit}
                                        className={`${scr.segment}${provider === p.value ? " " + scr.on : ""}`}
                                        onClick={() => patch((d) => { d.voice = { ...d.voice, provider: p.value }; })}>
                                  {p.label}
                                </button>
                              ))}
                            </div>
                          </div>
                          {provider === "local" ? (
                            <Dropdown label="Voice id" options={LOCAL_VOICES} disabled={!canEdit}
                                      value={cfg.voice?.voice_id ?? ""}
                                      onChange={(v) => patch((d) => { d.voice = { ...d.voice, voice_id: v }; })} />
                          ) : (
                            <TextInput label="Voice id"
                                       placeholder={provider === "ai33" ? "e.g. edge_en-US-GuyNeural" : "voice id"}
                                       value={cfg.voice?.voice_id ?? ""} disabled={!canEdit}
                                       onChange={(e) => { const v = e.currentTarget.value; patch((d) => { d.voice = { ...d.voice, voice_id: v || undefined }; }); }} />
                          )}
                        </div>

                        <div className={scr.grid2}>
                          <Dropdown label="Production style" options={PRODUCTION_STYLES} value={style} disabled={!canEdit}
                                    onChange={(v) => patch((d) => { d.production_style = v as ChannelConfig["production_style"]; })} />
                          <Dropdown label="Video type" options={VIDEO_TYPES} value={cfg.video_type} disabled={!canEdit}
                                    onChange={chooseVideoType} />
                        </div>
                        <p className={scr.toggleDesc}>
                          <strong>Video type</strong> is what the video is and picks the style pack;{" "}
                          <strong>production style</strong> is how it gets made and picks the pipeline. {styleNote}
                        </p>

                        <div className={scr.section}>
                          <div className={scr.fieldLabel}>Style pack</div>
                          <div className={s.packRow}>
                            <span className={s.packName}>{cfg.style_pack}</span>
                            {packMismatch && <StatusBadge label="type mismatch" tone="warning" />}
                            <Link href={`/channels/${selected}?tab=settings`} className={scr.backLink}>Change</Link>
                          </div>
                          <div className={scr.toggleDesc}>
                            {packMismatch
                              ? `Set from the video type, but this pack does not implement ${cfg.video_type}. ${packAlternatives.join(", ")} do.`
                              : `Follows the video type — ${cfg.video_type} defaults to ${options.videoTypeDefaults[cfg.video_type] ?? "the first pack that implements it"}. `}
                            {!packMismatch && (
                              <>
                                Change the default on <Link href="/style-packs">Style packs</Link>, or point this
                                one channel at another pack on the advanced form.
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className={scr.card}>
                      <div className={scr.eyebrow}>At a glance</div>
                      <div className={scr.tileGrid}>
                        <div className={scr.tile}>
                          <div className={scr.tileLabel}>Theme</div>
                          <div className={scr.tileValue}>{cfg.theme}</div>
                        </div>
                        <div className={scr.tile}>
                          <div className={scr.tileLabel}>Sources</div>
                          <div className={scr.tileValue}>{chain.length} in the chain</div>
                        </div>
                        <div className={scr.tile}>
                          <div className={scr.tileLabel}>Budget</div>
                          <div className={scr.tileValue}>${(cfg.budget?.max_usd_per_video ?? 0).toFixed(2)} per video</div>
                        </div>
                        <div className={scr.tile}>
                          <div className={scr.tileLabel}>Component pack</div>
                          <div className={scr.tileValue}>{cfg.component_pack ?? "core only"}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {tab === 1 && (
                  <LookEditor
                    channelId={selected}
                    cfg={cfg}
                    themes={options.themes}
                    disabled={!canEdit}
                    onChange={setCfg}
                  />
                )}

                {tab === 2 && cfg.source_policy?.visual && (
                  <SourcePolicyEditor
                    visual={cfg.source_policy.visual}
                    disabled={!canEdit}
                    onChange={(next) => patch((d) => { d.source_policy.visual = next; })}
                  />
                )}
                {tab === 2 && !cfg.source_policy?.visual && (
                  <div className={scr.card}>
                    <div className={scr.toggleDesc}>
                      This channel has no visual source policy — set one on the advanced form.
                    </div>
                  </div>
                )}

                {canEdit && (
                  <div className={s.saveRow}>
                    <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save channel"}</Button>
                    {tab === 2 && chain.length > 0 && (
                      <span className={scr.toggleDesc}>
                        {chain.map((e) => `${e.source} · ${mediaMode(e)}`).join("  ·  ")}
                      </span>
                    )}
                    {note && <span className={`${s.saveNote}${note.bad ? " " + s.bad : ""}`}>{note.text}</span>}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChannelsPage() {
  return (
    <Suspense fallback={<div className={scr.loading}>Loading…</div>}>
      <ChannelsScreen />
    </Suspense>
  );
}
