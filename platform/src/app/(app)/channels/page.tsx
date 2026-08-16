"use client";
/**
 * Channels — ported from VidRush.dc.html (isChannels).
 *
 * A channel carries the defaults every video starts from. The mockup's
 * "default brand" dropdown is not drawn: in this codebase a channel's brand
 * profile IS its config document, edited on Brands, so the card links there
 * instead of pretending brands are a separate row.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ChannelConfig } from "@lusora/contracts";
import { Button, Dropdown, TextInput, Toggle } from "@/components/ds";
import { defaultChannelConfig } from "@/components/ChannelConfigForm";
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

const VIDEO_TYPES = ["doc", "explainer", "breakdown", "listicle"];

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

export default function ChannelsPage() {
  const router = useRouter();
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [cfg, setCfg] = useState<ChannelConfig | null>(null);
  const [options, setOptions] = useState<{
    themes: string[];
    stylePacks: { name: string }[];
    pipelines: PipelineSummary[];
  }>({ themes: [], stylePacks: [], pipelines: [] });
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
        stylePacks: o.stylePacks ?? [],
        pipelines: o.pipelines ?? [],
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

  return (
    <div className={scr.screen}>
      <div className={scr.wrap}>
        <div className={scr.head} style={{ padding: 0, marginBottom: 24 }}>
          <div className={scr.headMain}>
            <h1 className={scr.h1}>Channels</h1>
            <p className={scr.sub}>
              A channel carries the defaults every video starts from: language, video type, production style,
              theme, style pack and the voice its narration is synthesised with.
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

        <div className={s.layout}>
          <div className={s.list}>
            {channels.map((c) => (
              <button key={c.id} type="button"
                      className={`${s.item}${c.id === selected ? " " + s.on : ""}`}
                      onClick={() => setSelected(c.id)}>
                <span className={`${s.dot}${c.active ? "" : " " + s.off}`} />
                <span className={s.itemMain}>
                  <span className={s.itemName}>{c.name}</span>
                  <span className={s.itemMeta}>{c.video_type} · {c.language} · {c.theme}</span>
                </span>
              </button>
            ))}
            {channels.length === 0 && <div className={scr.toggleDesc}>No channels yet.</div>}
          </div>

          <div className={s.detail}>
            {!cfg && <div className={scr.card}><div className={scr.toggleDesc}>Select a channel.</div></div>}

            {cfg && (
              <>
                <div className={scr.card}>
                  <p className={scr.cardSub}>
                    These are the values a new video inherits. Anything here can be overridden for a single
                    video on its quote statement.
                  </p>
                  <div className={scr.grid2}>
                    <TextInput label="Channel name" value={cfg.name} disabled={!canEdit}
                               onChange={(e) => { const v = e.currentTarget.value; patch((d) => { d.name = v; }); }} />
                    <TextInput label="Language" value={cfg.language} disabled={!canEdit}
                               onChange={(e) => { const v = e.currentTarget.value; patch((d) => { d.language = v; }); }} />
                    <Dropdown label="Video type" options={VIDEO_TYPES} value={cfg.video_type} disabled={!canEdit}
                              onChange={(v) => patch((d) => { d.video_type = v as ChannelConfig["video_type"]; })} />
                    <Dropdown label="Style pack" options={options.stylePacks.map((p) => p.name)} value={cfg.style_pack} disabled={!canEdit}
                              onChange={(v) => patch((d) => { d.style_pack = v; })} />
                    <Dropdown label="Production style" options={PRODUCTION_STYLES} value={style} disabled={!canEdit}
                              onChange={(v) => patch((d) => { d.production_style = v as ChannelConfig["production_style"]; })} />
                  </div>
                  <p className={scr.toggleDesc} style={{ marginTop: 10 }}>
                    <strong>Video type</strong> is what the video is and picks the style pack;{" "}
                    <strong>production style</strong> is how it gets made and picks the pipeline. {styleNote}
                  </p>
                  <div className={scr.section} style={{ marginTop: 16 }}>
                    <div className={scr.fieldLabel}>Content rules</div>
                    <textarea
                      className={s.rules}
                      value={cfg.content_rules ?? ""}
                      disabled={!canEdit}
                      placeholder="Editorial constraints handed to the script agent."
                      onChange={(e) => { const v = e.currentTarget.value; patch((d) => { d.content_rules = v; }); }}
                    />
                  </div>
                </div>

                <div className={scr.card}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 18 }}>
                    <div style={{ flex: 1 }}>
                      <h2 className={scr.h2}>Voiceover identity</h2>
                      <p className={scr.cardSub} style={{ marginBottom: 0 }}>
                        Pinned to the channel so every video sounds the same. The provider is what the narrate
                        stage calls; the voice id is passed straight through to it.
                      </p>
                    </div>
                  </div>
                  <div className={scr.grid2}>
                    <TextInput label="Provider" value={cfg.voice?.provider ?? ""} disabled={!canEdit}
                               onChange={(e) => { const v = e.currentTarget.value; patch((d) => { d.voice = { ...d.voice, provider: v }; }); }} />
                    <TextInput label="Voice id" value={cfg.voice?.voice_id ?? ""} disabled={!canEdit}
                               onChange={(e) => { const v = e.currentTarget.value; patch((d) => { d.voice = { ...d.voice, voice_id: v || undefined }; }); }} />
                  </div>
                  <div className={scr.section} style={{ marginTop: 16 }}>
                    <div className={scr.toggleRow} style={{ borderTop: "none", paddingTop: 0 }}>
                      <div className={scr.toggleMain}>
                        <div className={scr.toggleName}>Burn captions by default</div>
                        <div className={scr.toggleDesc}>The preset comes from the theme; a video can override this.</div>
                      </div>
                      <Toggle checked={cfg.captions?.enabled !== false} disabled={!canEdit}
                              onChange={(on) => patch((d) => { d.captions = { ...d.captions, enabled: on }; })} />
                    </div>
                  </div>
                </div>

                <div className={scr.card}>
                  <h2 className={scr.h2}>Brand profile</h2>
                  <p className={scr.cardSub}>
                    Theme, sound and the source policy this channel&apos;s videos inherit live on its brand profile.
                  </p>
                  <div className={scr.tileGrid} style={{ marginBottom: 16 }}>
                    <div className={scr.tile}>
                      <div className={scr.tileLabel}>Theme</div>
                      <div className={scr.tileValue}>{cfg.theme}</div>
                    </div>
                    <div className={scr.tile}>
                      <div className={scr.tileLabel}>Sources</div>
                      <div className={scr.tileValue}>{cfg.source_policy?.visual?.chain?.length ?? 0} in the chain</div>
                    </div>
                    <div className={scr.tile}>
                      <div className={scr.tileLabel}>Budget</div>
                      <div className={scr.tileValue}>${(cfg.budget?.max_usd_per_video ?? 0).toFixed(2)} per video</div>
                    </div>
                  </div>
                  <div className={s.saveRow}>
                    <Link href={`/brands?channel=${selected}`}>
                      <Button variant="secondary" size="sm">Open brand profile</Button>
                    </Link>
                    <Button variant="ghost" size="sm" onClick={() => router.push(`/channels/${selected}`)}>
                      Full config form
                    </Button>
                  </div>
                </div>

                {canEdit && (
                  <div className={s.saveRow}>
                    <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save channel"}</Button>
                    {note && <span className={`${s.saveNote}${note.bad ? " " + s.bad : ""}`}>{note.text}</span>}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
