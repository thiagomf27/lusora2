"use client";
import { useEffect, useMemo, useState } from "react";
import type { ChannelConfig, VideoType, VisualSource, LicenseKind } from "@lusora/contracts";
import s from "./ChannelConfigForm.module.css";

const VIDEO_TYPES = ["doc", "explainer", "breakdown", "listicle"] as const;
const RENDERERS = ["auto", "ffmpeg", "remotion"] as const;
const CLIP_RETENTION = ["on_render", "on_posted", "keep"] as const;
const ORIENTATIONS = ["landscape", "portrait", "square"] as const;
const VISUAL_SOURCE_KINDS = ["library", "stock", "ai_image"] as const;
const MEDIA_TYPES = ["video_clip", "image", "video"] as const;
const LICENSES: LicenseKind[] = ["cc0", "cc-by", "cc-by-sa", "owned", "stock-licensed", "unknown"];

// Small hardcoded registries mirrored from the worker (no schema enum / no API):
//   voice providers → worker/.../providers/tts.py
//   LLM providers   → worker/.../providers/llm.py (PROVIDERS + "mock")
const VOICE_PROVIDERS = ["local", "mock", "ai33"] as const;
const LOCAL_VOICES = ["kal", "kal16", "awb", "rms", "slt"] as const; // flite voices
const LLMS = ["deepseek", "openai", "anthropic", "mock"] as const;
const SCRIPT_GENERATORS = ["simple"] as const;
const LANGUAGES = [
  "en-US", "en-GB", "pt-BR", "pt-PT", "es-ES", "es-MX", "de-DE", "fr-FR", "it-IT", "ja-JP",
] as const;

/** Style packs arrive with the video type they implement (Style Packs screen),
 *  so the picker can put the packs built for this channel's type first. */
interface StylePackOption {
  name: string;
  video_type?: VideoType;
}

interface ConfigOptions {
  themes: string[];
  stylePacks: StylePackOption[];
  componentPacks: string[];
  /** Prompt pack names per role (D42) — layer 2 of the resolution ladder. */
  prompts: { script: string[]; planner: string[]; chat: string[] };
}

/** A schema-valid starting point for a brand-new channel. */
export function defaultChannelConfig(): ChannelConfig {
  return {
    channel_id: "",
    name: "",
    language: "en-US",
    video_type: "doc",
    theme: "history-dark",
    style_pack: "doc-slow",
    component_pack: null,
    voice: { provider: "mock", voice_id: "default" },
    script: { generator: "simple", llm: "mock" },
    planner: { llm: "mock" },
    captions: { enabled: true },
    renderer: "auto",
    output: { fps: 30, width: 1920, height: 1080 },
    budget: { max_usd_per_video: 0.8 },
    retention: { clips: "on_render", final_mp4_days_after_posted: 30 },
    content_rules: "",
    source_policy: {
      visual: {
        chain: [
          {
            source: "library",
            media_types: ["video_clip", "image"],
            include_global: true,
            niches: [],
            tags: [],
            licenses: ["cc0", "cc-by", "owned"],
            min_score: 0.55,
          },
        ],
        max_clip_seconds: 12,
        orientation: "landscape",
      },
      music: { enabled: false },
      sfx: { enabled: false },
    },
  };
}

const csv = (a?: string[]) => (a ?? []).join(", ");
const parseCsv = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);

function numOr(v: string, fallback: number | undefined): number | undefined {
  if (v.trim() === "") return fallback;
  const n = Number(v);
  return Number.isNaN(n) ? fallback : n;
}

/** A <select> that never silently drops an unknown stored value: if `value`
 *  isn't in the known list it's kept as the first option. */
function Select({
  value,
  options,
  onChange,
  empty,
}: {
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  empty?: string; // label for an explicit empty choice
}) {
  const known = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {empty !== undefined && <option value="">{empty}</option>}
      {known.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

export default function ChannelConfigForm({
  value,
  onChange,
  mode,
}: {
  value: ChannelConfig;
  onChange: (next: ChannelConfig) => void;
  mode: "create" | "edit";
}) {
  const [opts, setOpts] = useState<ConfigOptions>({
    themes: [],
    stylePacks: [],
    componentPacks: [],
    prompts: { script: [], planner: [], chat: [] },
  });

  useEffect(() => {
    fetch("/api/config-options")
      .then((r) => (r.ok ? r.json() : null))
      .then((o) => o && setOpts(o))
      .catch(() => {});
  }, []);

  // Packs built for this video type first, then the ones that declare no type
  // (they suit any), then the rest — never hidden, a channel may legitimately
  // point at a pack from another type.
  const stylePackNames = useMemo(() => {
    const rank = (p: StylePackOption) =>
      p.video_type === value.video_type ? 0 : p.video_type === undefined ? 1 : 2;
    return [...opts.stylePacks].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
      .map((p) => p.name);
  }, [opts.stylePacks, value.video_type]);

  const chosenPack = opts.stylePacks.find((p) => p.name === value.style_pack);
  const packMismatch =
    chosenPack?.video_type !== undefined && chosenPack.video_type !== value.video_type;

  const up = (partial: Partial<ChannelConfig>) => onChange({ ...value, ...partial });
  const sp = value.source_policy;
  const visual = sp.visual;

  const setChain = (chain: VisualSource[]) =>
    up({ source_policy: { ...sp, visual: { ...visual, chain } } });
  const updateSource = (i: number, patch: Partial<VisualSource>) =>
    setChain(visual.chain.map((src, idx) => (idx === i ? { ...src, ...patch } : src)));
  const addSource = () => setChain([...visual.chain, { source: "library", include_global: true }]);
  const removeSource = (i: number) => setChain(visual.chain.filter((_, idx) => idx !== i));

  const toggleInList = <T,>(list: T[] | undefined, item: T): T[] => {
    const cur = list ?? [];
    return cur.includes(item) ? cur.filter((x) => x !== item) : [...cur, item];
  };

  const provider = value.voice.provider;

  return (
    <div className={s.form}>
      {/* Identity */}
      <section className={s.section}>
        <div className={s.sectionTitle}>Identity</div>
        <div className={s.grid}>
          <label className={s.field}>
            <span className={s.label}>Channel ID</span>
            <input
              value={value.channel_id}
              disabled={mode === "edit"}
              placeholder="MY_CHANNEL_01"
              onChange={(e) => up({ channel_id: e.target.value })}
            />
            {mode === "edit" && <span className={s.hint}>Fixed after creation.</span>}
          </label>
          <label className={s.field}>
            <span className={s.label}>Name</span>
            <input value={value.name} onChange={(e) => up({ name: e.target.value })} />
          </label>
          <label className={s.field}>
            <span className={s.label}>Language</span>
            <Select value={value.language} options={LANGUAGES} onChange={(v) => up({ language: v })} />
          </label>
          <label className={s.field}>
            <span className={s.label}>Video type</span>
            <Select
              value={value.video_type}
              options={VIDEO_TYPES}
              onChange={(v) => up({ video_type: v as ChannelConfig["video_type"] })}
            />
          </label>
          <label className={s.field}>
            <span className={s.label}>Theme</span>
            <Select value={value.theme} options={opts.themes} onChange={(v) => up({ theme: v })} />
          </label>
          <label className={s.field}>
            <span className={s.label}>Style pack</span>
            <Select value={value.style_pack} options={stylePackNames} onChange={(v) => up({ style_pack: v })} />
            <span className={s.hint}>
              {packMismatch
                ? `${value.style_pack} is a ${chosenPack?.video_type} pack`
                : "pacing, density and persona — edit on Style Packs"}
            </span>
          </label>
        </div>
      </section>

      {/* Voice & AI */}
      <section className={s.section}>
        <div className={s.sectionTitle}>Voice &amp; AI</div>
        <div className={s.grid}>
          <label className={s.field}>
            <span className={s.label}>Voice provider</span>
            <Select
              value={provider}
              options={VOICE_PROVIDERS}
              onChange={(v) => up({ voice: { ...value.voice, provider: v } })}
            />
          </label>
          <label className={s.field}>
            <span className={s.label}>Voice</span>
            {provider === "local" ? (
              <Select
                value={value.voice.voice_id ?? ""}
                options={LOCAL_VOICES}
                onChange={(v) => up({ voice: { ...value.voice, voice_id: v } })}
              />
            ) : (
              <>
                <input
                  value={value.voice.voice_id ?? ""}
                  placeholder={provider === "ai33" ? "e.g. edge_en-US-GuyNeural" : "voice id"}
                  onChange={(e) => up({ voice: { ...value.voice, voice_id: e.target.value } })}
                />
                {provider === "ai33" && <span className={s.hint}>Voice IDs come from the ai33 API.</span>}
              </>
            )}
          </label>
          <label className={s.field}>
            <span className={s.label}>Script generator</span>
            <Select
              value={value.script?.generator ?? "simple"}
              options={SCRIPT_GENERATORS}
              onChange={(v) => up({ script: { ...(value.script ?? {}), generator: v } })}
            />
          </label>
          <label className={s.field}>
            <span className={s.label}>Script LLM</span>
            <Select
              value={value.script?.llm ?? "mock"}
              options={LLMS}
              onChange={(v) => up({ script: { ...(value.script ?? {}), llm: v } })}
            />
          </label>
          <label className={s.field}>
            <span className={s.label}>Planner LLM</span>
            <Select
              value={value.planner?.llm ?? "mock"}
              options={LLMS}
              onChange={(v) => up({ planner: { ...(value.planner ?? {}), llm: v } })}
            />
          </label>
          {/* D44 layer 2. Empty = fall through to the style pack, then to the
              built-in default; the resolved text is snapshotted at enqueue. */}
          <label className={s.field}>
            <span className={s.label}>Script prompt</span>
            <Select
              value={value.script?.prompt ?? ""}
              options={["", ...opts.prompts.script]}
              onChange={(v) =>
                up({ script: { ...(value.script ?? {}), prompt: v || undefined } })
              }
            />
            <span className={s.hint}>Blank = style pack&apos;s prompt, else the default.</span>
          </label>
          <label className={s.field}>
            <span className={s.label}>Planner prompt</span>
            <Select
              value={value.planner?.prompt ?? ""}
              options={["", ...opts.prompts.planner]}
              onChange={(v) =>
                up({ planner: { ...(value.planner ?? {}), prompt: v || undefined } })
              }
            />
          </label>
          <label className={s.field}>
            <span className={s.label}>Narration target (s)</span>
            <input
              type="number"
              min={10}
              value={value.script?.target_seconds ?? ""}
              placeholder="style pack"
              onChange={(e) =>
                up({
                  script: {
                    ...(value.script ?? {}),
                    target_seconds: e.target.value ? Number(e.target.value) : undefined,
                  },
                })
              }
            />
            <span className={s.hint}>Blank = the style pack&apos;s length (D45).</span>
          </label>
          <div className={s.field}>
            <span className={s.label}>Captions</span>
            <label className={s.checkRow}>
              <input
                type="checkbox"
                checked={value.captions?.enabled ?? true}
                onChange={(e) => up({ captions: { ...(value.captions ?? {}), enabled: e.target.checked } })}
              />
              Burn in captions
            </label>
          </div>
        </div>
      </section>

      {/* Budget */}
      <section className={s.section}>
        <div className={s.sectionTitle}>Budget</div>
        <div className={`${s.grid} ${s.grid3}`}>
          <label className={s.field}>
            <span className={s.label}>Max $ / video</span>
            <input
              type="number"
              min={0}
              step={0.05}
              value={value.budget?.max_usd_per_video ?? 0}
              onChange={(e) => up({ budget: { max_usd_per_video: numOr(e.target.value, 0) ?? 0 } })}
            />
          </label>
        </div>
      </section>

      {/* Content rules */}
      <section className={s.section}>
        <div className={s.sectionTitle}>Content rules</div>
        <label className={`${s.field} ${s.wide}`}>
          <span className={s.hint}>Free text given to the planner (tone, do/don&apos;t, style).</span>
          <textarea
            rows={4}
            value={value.content_rules ?? ""}
            onChange={(e) => up({ content_rules: e.target.value })}
          />
        </label>
      </section>

      {/* Visual sources */}
      <section className={s.section}>
        <div className={s.sectionTitle}>Visual sources</div>
        <div className={s.grid}>
          <label className={s.field}>
            <span className={s.label}>Orientation</span>
            <Select
              value={visual.orientation ?? "landscape"}
              options={ORIENTATIONS}
              onChange={(v) =>
                up({ source_policy: { ...sp, visual: { ...visual, orientation: v as "landscape" | "portrait" | "square" } } })
              }
            />
          </label>
          <label className={s.field}>
            <span className={s.label}>Max clip seconds</span>
            <input
              type="number"
              min={0.5}
              step={0.5}
              value={visual.max_clip_seconds ?? 12}
              onChange={(e) =>
                up({ source_policy: { ...sp, visual: { ...visual, max_clip_seconds: numOr(e.target.value, 12) } } })
              }
            />
          </label>
        </div>

        <div className={s.hint}>Order = preference. Omitting a source forbids it.</div>
        <div className={s.chain}>
          {visual.chain.map((src, i) => (
            <div key={i} className={s.source}>
              <div className={s.sourceHead}>
                <span className={s.sourceTag}>Source {i + 1}</span>
                <button
                  type="button"
                  className={s.rm}
                  disabled={visual.chain.length <= 1}
                  onClick={() => removeSource(i)}
                >
                  Remove
                </button>
              </div>
              <div className={s.grid}>
                <label className={s.field}>
                  <span className={s.label}>Kind</span>
                  <Select
                    value={src.source}
                    options={VISUAL_SOURCE_KINDS}
                    onChange={(v) => updateSource(i, { source: v as VisualSource["source"] })}
                  />
                </label>
                <label className={s.field}>
                  <span className={s.label}>Min score (0–1)</span>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={src.min_score ?? ""}
                    onChange={(e) => updateSource(i, { min_score: numOr(e.target.value, undefined) })}
                  />
                </label>
                <div className={`${s.field} ${s.wide}`}>
                  <span className={s.label}>Media types</span>
                  <div className={s.checkGroup}>
                    {MEDIA_TYPES.map((mt) => {
                      const on = (src.media_types ?? []).includes(mt);
                      return (
                        <label key={mt} className={`${s.chk}${on ? " " + s.chkOn : ""}`}>
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => updateSource(i, { media_types: toggleInList(src.media_types, mt) })}
                          />
                          {mt}
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div className={`${s.field} ${s.wide}`}>
                  <span className={s.label}>Licenses</span>
                  <div className={s.checkGroup}>
                    {LICENSES.map((lic) => {
                      const on = (src.licenses ?? []).includes(lic);
                      return (
                        <label key={lic} className={`${s.chk}${on ? " " + s.chkOn : ""}`}>
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => updateSource(i, { licenses: toggleInList(src.licenses, lic) })}
                          />
                          {lic}
                        </label>
                      );
                    })}
                  </div>
                </div>
                <label className={s.field}>
                  <span className={s.label}>Niches (comma-separated)</span>
                  <input
                    value={csv(src.niches)}
                    onChange={(e) => updateSource(i, { niches: parseCsv(e.target.value) })}
                  />
                </label>
                <label className={s.field}>
                  <span className={s.label}>Tags (comma-separated)</span>
                  <input
                    value={csv(src.tags)}
                    onChange={(e) => updateSource(i, { tags: parseCsv(e.target.value) })}
                  />
                </label>
                {src.source !== "library" && (
                  <label className={s.field}>
                    <span className={s.label}>Providers (comma-separated)</span>
                    <input
                      value={csv(src.providers)}
                      onChange={(e) => updateSource(i, { providers: parseCsv(e.target.value) })}
                    />
                  </label>
                )}
                {src.source === "ai_image" && (
                  <label className={s.field}>
                    <span className={s.label}>Style suffix</span>
                    <input value={src.style ?? ""} onChange={(e) => updateSource(i, { style: e.target.value })} />
                  </label>
                )}
                <div className={s.field}>
                  <span className={s.label}>Global library</span>
                  <label className={s.checkRow}>
                    <input
                      type="checkbox"
                      checked={src.include_global ?? true}
                      onChange={(e) => updateSource(i, { include_global: e.target.checked })}
                    />
                    Include global assets
                  </label>
                </div>
              </div>
            </div>
          ))}
          <button type="button" className={s.addBtn} onClick={addSource}>
            + Add source
          </button>
        </div>
      </section>

      {/* Music & SFX */}
      <section className={s.section}>
        <div className={s.sectionTitle}>Music &amp; SFX</div>
        <div className={`${s.grid} ${s.grid3}`}>
          <div className={s.field}>
            <span className={s.label}>Music</span>
            <label className={s.checkRow}>
              <input
                type="checkbox"
                checked={sp.music?.enabled ?? false}
                onChange={(e) => up({ source_policy: { ...sp, music: { ...(sp.music ?? {}), enabled: e.target.checked } } })}
              />
              Enable background music
            </label>
          </div>
          <label className={s.field}>
            <span className={s.label}>Music volume (0–1)</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={sp.music?.default_volume ?? ""}
              placeholder="0.12"
              onChange={(e) =>
                up({ source_policy: { ...sp, music: { ...(sp.music ?? {}), default_volume: numOr(e.target.value, undefined) } } })
              }
            />
          </label>
          <div className={s.field}>
            <span className={s.label}>SFX</span>
            <label className={s.checkRow}>
              <input
                type="checkbox"
                checked={sp.sfx?.enabled ?? false}
                onChange={(e) => up({ source_policy: { ...sp, sfx: { ...(sp.sfx ?? {}), enabled: e.target.checked } } })}
              />
              Enable sound effects
            </label>
          </div>
        </div>
      </section>

      {/* Advanced — less-relevant / operational settings, kept last */}
      <section className={s.section}>
        <div className={s.sectionTitle}>Advanced</div>
        <div className={`${s.grid} ${s.grid3}`}>
          <label className={s.field}>
            <span className={s.label}>Component pack</span>
            <Select
              value={value.component_pack ?? ""}
              options={opts.componentPacks}
              empty="(none)"
              onChange={(v) => up({ component_pack: v || null })}
            />
          </label>
          <label className={s.field}>
            <span className={s.label}>Renderer</span>
            <Select
              value={value.renderer ?? "auto"}
              options={RENDERERS}
              onChange={(v) => up({ renderer: v as ChannelConfig["renderer"] })}
            />
          </label>
          <div />
          <label className={s.field}>
            <span className={s.label}>FPS</span>
            <input
              type="number"
              min={1}
              max={120}
              value={value.output?.fps ?? 30}
              onChange={(e) => up({ output: { ...(value.output ?? {}), fps: numOr(e.target.value, 30) } })}
            />
          </label>
          <label className={s.field}>
            <span className={s.label}>Width</span>
            <input
              type="number"
              min={16}
              value={value.output?.width ?? 1920}
              onChange={(e) => up({ output: { ...(value.output ?? {}), width: numOr(e.target.value, 1920) } })}
            />
          </label>
          <label className={s.field}>
            <span className={s.label}>Height</span>
            <input
              type="number"
              min={16}
              value={value.output?.height ?? 1080}
              onChange={(e) => up({ output: { ...(value.output ?? {}), height: numOr(e.target.value, 1080) } })}
            />
          </label>
          <label className={s.field}>
            <span className={s.label}>Keep clips</span>
            <Select
              value={value.retention?.clips ?? "on_render"}
              options={CLIP_RETENTION}
              onChange={(v) =>
                up({ retention: { ...(value.retention ?? {}), clips: v as "on_render" | "on_posted" | "keep" } })
              }
            />
          </label>
          <label className={s.field}>
            <span className={s.label}>Keep final MP4 (days)</span>
            <input
              type="number"
              min={0}
              value={value.retention?.final_mp4_days_after_posted ?? 30}
              onChange={(e) =>
                up({ retention: { ...(value.retention ?? {}), final_mp4_days_after_posted: numOr(e.target.value, 30) } })
              }
            />
          </label>
        </div>
      </section>
    </div>
  );
}
