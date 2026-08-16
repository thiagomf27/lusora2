"use client";
/**
 * Quote statement — ported from VidRush.dc.html (isQuote).
 *
 * Four tabs over ONE working copy of the channel config. Approving is what
 * creates the draft: the diff against the channel's saved config is posted as
 * the video's `overrides`, and enqueue deep-merges it into the immutable
 * cfg.json snapshot. That is what makes the statement a quote — the numbers
 * and settings shown here are the ones the render is locked to.
 *
 * The mockup's brand-gallery backgrounds, "reasoning effort" and
 * per-line cost estimate have no field behind them, so they are not drawn
 * (the estimate is replaced by the real budget cap and this channel's
 * recorded spend).
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ChannelConfig } from "@lusora/contracts";
import { Dropdown, TextInput, Toggle } from "@/components/ds";
import SourcePolicyEditor from "@/components/SourcePolicyEditor";
import LookEditor from "@/components/LookEditor";
import scr from "../screen.module.css";
import s from "./quote.module.css";

const TABS = ["Settings & details", "Look", "Safety & sourcing", "Cost & approval"];

const VIDEO_TYPES = ["doc", "explainer", "breakdown", "listicle"];
const RENDERERS = ["auto", "ffmpeg", "remotion"];

/** Upload fields the video API materializes into the video folder. */
const ATTACHMENTS: { field: string; name: string; note: string }[] = [
  { field: "script", name: "Script", note: "Replaces the generated script." },
  { field: "audio", name: "Voiceover audio", note: "Overrides the synthesised narration." },
  { field: "subtitles", name: "Subtitles (.srt)", note: "Uses your timings instead of generated captions." },
  { field: "beats", name: "Beat sheet", note: "Validated against the beat-sheet schema on upload." },
  { field: "plan", name: "Edit plan", note: "Validated against the edit-plan schema on upload." },
];

/** Minimal deep diff: the branches of `next` that differ from `base`. Arrays
 *  are compared whole because chain lists replace wholesale at merge. */
function diff(base: unknown, next: unknown): unknown {
  if (Array.isArray(base) || Array.isArray(next)) {
    return JSON.stringify(base) === JSON.stringify(next) ? undefined : next;
  }
  if (base && next && typeof base === "object" && typeof next === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(next as Record<string, unknown>)) {
      const d = diff((base as Record<string, unknown>)[key], (next as Record<string, unknown>)[key]);
      if (d !== undefined) out[key] = d;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return base === next ? undefined : next;
}


function QuoteScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const channelId = params.get("channel") ?? "";
  const pinnedPipeline = params.get("pipeline") ?? "";

  const [tab, setTab] = useState(0);
  const [title, setTitle] = useState(params.get("title") ?? "");
  const [base, setBase] = useState<ChannelConfig | null>(null);
  const [draft, setDraft] = useState<ChannelConfig | null>(null);
  const [options, setOptions] = useState<{
    themes: string[];
    stylePacks: { name: string }[];
    componentPacks: string[];
    soundPacks: string[];
    pipelines: string[];
  }>({ themes: [], stylePacks: [], componentPacks: [], soundPacks: [], pipelines: [] });
  const [spend, setSpend] = useState<{ month: string; usd: number; events: number }[]>([]);
  const [files, setFiles] = useState<Record<string, File>>({});
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (!channelId) return;
    fetch(`/api/channels/${channelId}/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg: ChannelConfig | null) => {
        if (!cfg) return;
        setBase(cfg);
        setDraft(pinnedPipeline ? { ...cfg, pipeline: pinnedPipeline } : structuredClone(cfg));
      })
      .catch(() => undefined);
    fetch(`/api/channels/${channelId}/costs`)
      .then((r) => (r.ok ? r.json() : { byMonth: [] }))
      .then((c) => setSpend(c.byMonth ?? []))
      .catch(() => setSpend([]));
  }, [channelId, pinnedPipeline]);

  useEffect(() => {
    fetch("/api/config-options")
      .then((r) => (r.ok ? r.json() : null))
      .then((o) => o && setOptions({
        themes: o.themes ?? [],
        stylePacks: o.stylePacks ?? [],
        componentPacks: o.componentPacks ?? [],
        soundPacks: o.soundPacks ?? [],
        pipelines: o.pipelines ?? [],
      }))
      .catch(() => undefined);
  }, []);

  const patch = useCallback((fn: (d: ChannelConfig) => void) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
  }, []);

  const chain = draft?.source_policy?.visual?.chain ?? [];
  const chainOf = (name: string) => chain.find((c) => c.source === name);

  const overrides = useMemo(
    () => (base && draft ? (diff(base, draft) as Record<string, unknown> | undefined) : undefined),
    [base, draft]
  );

  const budget = draft?.budget?.max_usd_per_video ?? 0;
  const lastMonth = spend[0]?.usd ?? 0;
  const perVideo = spend[0]?.events ? lastMonth / spend[0].events : 0;

  async function approve() {
    if (!draft || !title.trim()) {
      setProblems(["A title is required before the draft can be created."]);
      return;
    }
    setBusy(true);
    setProblems([]);
    try {
      const form = new FormData();
      form.set("title", title.trim());
      form.set("channel_id", channelId);
      if (overrides && Object.keys(overrides).length) {
        form.set("overrides", JSON.stringify(overrides));
      }
      for (const [field, file] of Object.entries(files)) form.set(field, file);

      const created = await fetch("/api/videos", { method: "POST", body: form });
      const createdBody = await created.json().catch(() => ({}));
      if (!created.ok) {
        setProblems([createdBody.error ?? `could not create the draft (${created.status})`]);
        return;
      }
      const id: string = createdBody.id;

      const queued = await fetch(`/api/videos/${id}/enqueue`, { method: "POST" });
      const queuedBody = await queued.json().catch(() => ({}));
      if (!queued.ok) {
        setProblems([
          `Draft ${id} was created but pre-flight refused it:`,
          ...(queuedBody.problems ?? [queuedBody.error ?? `enqueue failed (${queued.status})`]),
        ]);
        return;
      }
      router.push(`/videos/${id}`);
    } finally {
      setBusy(false);
    }
  }

  if (!channelId) {
    return <div className={scr.loading}>No channel in the URL — start from Home.</div>;
  }
  if (!draft || !base) {
    return <div className={scr.loading}>Loading the channel&apos;s configuration…</div>;
  }

  const summary = [draft.name, draft.video_type, draft.language, draft.theme].filter(Boolean).join(" · ");

  return (
    <div className={scr.screen}>
      <div className={scr.sticky}>
        <div className={scr.head}>
          <button type="button" className={scr.back} title="Back to home" onClick={() => router.push("/")}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 3L5 8l5 5" />
            </svg>
          </button>
          <div className={scr.headMain}>
            <h1 className={scr.h1}>Quote statement</h1>
            <p className={scr.subLine}>{summary}</p>
          </div>
          <div className={scr.headActions}>
            <div className={s.estimate}>
              <div className={s.estimateLabel}>Budget cap</div>
              <div className={s.estimateValue}>${budget.toFixed(2)}</div>
            </div>
            <button
              type="button"
              className={s.primary}
              disabled={busy}
              onClick={() => (tab === TABS.length - 1 ? approve() : setTab(tab + 1))}
            >
              {tab === TABS.length - 1 ? (busy ? "Queueing…" : "Approve and generate") : "Continue"}
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 3.5L10.5 8 6 12.5" />
              </svg>
            </button>
          </div>
        </div>
        <div className={scr.tabs}>
          {TABS.map((name, i) => (
            <button key={name} type="button" className={`${scr.tab}${tab === i ? " " + scr.active : ""}`} onClick={() => setTab(i)}>
              <span className={scr.tabNum}>{i + 1}</span>
              {name}
            </button>
          ))}
        </div>
      </div>

      <div className={scr.wrap}>
        {tab === 0 && (
          <div className={scr.split}>
            <div className={scr.card}>
              <h2 className={scr.h2}>Settings &amp; details</h2>
              <p className={scr.cardSub}>
                Everything here starts at the channel&apos;s value. What you change becomes this video&apos;s override.
              </p>
              <div className={scr.stack}>
                <TextInput label="Video title" value={title} placeholder="What is this video about?"
                           onChange={(e) => setTitle(e.currentTarget.value)} />

                <div className={scr.grid2}>
                  <TextInput label="Language" value={draft.language}
                             onChange={(e) => { const v = e.currentTarget.value; patch((d) => { d.language = v; }); }} />
                  <Dropdown label="Video type" options={VIDEO_TYPES} value={draft.video_type}
                            onChange={(v) => patch((d) => { d.video_type = v as ChannelConfig["video_type"]; })} />
                </div>

                <div className={scr.grid2}>
                  <Dropdown label="Style pack" options={options.stylePacks.map((p) => p.name)} value={draft.style_pack}
                            onChange={(v) => patch((d) => { d.style_pack = v; })} />
                  <Dropdown label="Pipeline (production style)"
                            options={["", ...options.pipelines].map((p) => ({ value: p, label: p || "resolve at enqueue" }))}
                            value={draft.pipeline ?? ""}
                            onChange={(v) => patch((d) => { if (v) d.pipeline = v; else delete d.pipeline; })} />
                </div>

                <div className={scr.grid2}>
                  <TextInput label="Script model (llm)" value={draft.script?.llm ?? ""}
                             onChange={(e) => { const v = e.currentTarget.value; patch((d) => { d.script = { ...d.script, llm: v || undefined }; }); }} />
                  <TextInput label="Planner model (llm)" value={draft.planner?.llm ?? ""}
                             onChange={(e) => { const v = e.currentTarget.value; patch((d) => { d.planner = { ...d.planner, llm: v || undefined }; }); }} />
                </div>

                <TextInput
                  label="Target length (seconds)"
                  type="number"
                  value={String(draft.script?.target_seconds ?? "")}
                  placeholder="from the style pack"
                  onChange={(e) => {
                    const n = Number(e.currentTarget.value);
                    patch((d) => {
                      d.script = { ...d.script };
                      if (Number.isFinite(n) && n > 0) d.script.target_seconds = n;
                      else delete d.script.target_seconds;
                    });
                  }}
                />

                <div className={scr.section}>
                  <div className={scr.toggleRow}>
                    <div className={scr.toggleMain}>
                      <div className={scr.toggleName}>Captions</div>
                      <div className={scr.toggleDesc}>
                        Burned in by the renderer. The preset comes from the theme.
                      </div>
                    </div>
                    <Toggle checked={draft.captions?.enabled !== false}
                            onChange={(on) => patch((d) => { d.captions = { ...d.captions, enabled: on }; })} />
                  </div>
                </div>

                <div className={scr.section}>
                  <div className={scr.fieldLabel}>Voice</div>
                  <div className={scr.grid2}>
                    <TextInput label="Provider" value={draft.voice?.provider ?? ""}
                               onChange={(e) => { const v = e.currentTarget.value; patch((d) => { d.voice = { ...d.voice, provider: v }; }); }} />
                    <TextInput label="Voice id" value={draft.voice?.voice_id ?? ""}
                               onChange={(e) => { const v = e.currentTarget.value; patch((d) => { d.voice = { ...d.voice, voice_id: v || undefined }; }); }} />
                  </div>
                </div>

                <div className={scr.section}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
                    <div className={scr.toggleName}>Attached files</div>
                    <span className={s.attachNote}>
                      {Object.keys(files).length ? `${Object.keys(files).length} attached` : "Optional — manual-first"}
                    </span>
                  </div>
                  <div className={scr.stackTight}>
                    {ATTACHMENTS.map((a) => {
                      const file = files[a.field];
                      return (
                        <div key={a.field} className={`${s.attachment}${file ? " " + s.filled : ""}`}>
                          <span className={s.attachDot}>
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3.5 2.5h6L12.5 5.5v8h-9z" />
                            </svg>
                          </span>
                          <div className={s.attachMain}>
                            <div className={s.attachName}>{a.name}</div>
                            <div className={s.attachNote}>{file ? file.name : a.note}</div>
                          </div>
                          <input
                            ref={(el) => { inputs.current[a.field] = el; }}
                            className={s.hiddenInput}
                            type="file"
                            onChange={(e) => {
                              const f = e.currentTarget.files?.[0];
                              setFiles((prev) => {
                                const next = { ...prev };
                                if (f) next[a.field] = f;
                                else delete next[a.field];
                                return next;
                              });
                            }}
                          />
                          <button
                            type="button"
                            className={s.attachBtn}
                            onClick={() => {
                              if (file) {
                                setFiles((prev) => {
                                  const next = { ...prev };
                                  delete next[a.field];
                                  return next;
                                });
                                const el = inputs.current[a.field];
                                if (el) el.value = "";
                              } else {
                                inputs.current[a.field]?.click();
                              }
                            }}
                          >
                            {file ? "Remove" : "Attach"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className={scr.stack}>
              <div className={`${scr.card} ${scr.cardTight}`}>
                <div className={scr.eyebrow}>Creation inputs</div>
                <div className={scr.tileGrid}>
                  {[
                    ["Channel", draft.name],
                    ["Theme", draft.theme],
                    ["Style pack", draft.style_pack],
                    ["Pipeline", draft.pipeline ?? "resolved at enqueue"],
                    ["Renderer", draft.renderer ?? "auto"],
                    ["Voice", draft.voice?.voice_id ?? draft.voice?.provider ?? "—"],
                  ].map(([label, value]) => (
                    <div key={label} className={scr.tile}>
                      <div className={scr.tileLabel}>{label}</div>
                      <div className={scr.tileValue}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className={`${scr.card} ${scr.cardTight}`}>
                <div className={scr.eyebrow}>Overrides on this video</div>
                {overrides && Object.keys(overrides).length ? (
                  <div className={scr.stackTight}>
                    {Object.keys(overrides).map((key) => (
                      <div key={key} className={scr.kv}>
                        <span>{key}</span>
                        <span className={scr.mono}>changed</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={scr.toggleDesc}>Nothing overridden — this video runs the channel as configured.</div>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === 1 && (
          <div className={scr.stack}>
            <LookEditor
              channelId={channelId}
              cfg={draft}
              themes={options.themes}
              onChange={setDraft}
            />

            <div className={scr.card}>
              <h2 className={scr.h2}>Render output</h2>
              <p className={scr.cardSub}>Applies to the finished file and everything downloadable from it.</p>
              <div className={scr.grid2}>
                <Dropdown label="Renderer" options={RENDERERS} value={draft.renderer ?? "auto"}
                          onChange={(v) => patch((d) => { d.renderer = v as ChannelConfig["renderer"]; })} />
                <Dropdown label="Component pack"
                          options={["", ...options.componentPacks].map((p) => ({ value: p, label: p || "core only" }))}
                          value={draft.component_pack ?? ""}
                          onChange={(v) => patch((d) => { d.component_pack = v || null; })} />
                <Dropdown label="Sound pack"
                          options={["", ...options.soundPacks].map((p) => ({ value: p, label: p || "from the theme" }))}
                          value={draft.source_policy?.sound_pack ?? ""}
                          onChange={(v) => patch((d) => {
                            if (v) d.source_policy.sound_pack = v;
                            else delete d.source_policy.sound_pack;
                          })} />
                <TextInput label="Frame rate" type="number" value={String(draft.output?.fps ?? 30)}
                           onChange={(e) => { const n = Number(e.currentTarget.value); patch((d) => { d.output = { ...d.output, fps: n }; }); }} />
              </div>
            </div>
          </div>
        )}

        {tab === 2 && draft.source_policy?.visual && (
          <SourcePolicyEditor
            visual={draft.source_policy.visual}
            onChange={(next) => patch((d) => { d.source_policy.visual = next; })}
          />
        )}

        {tab === 3 && (
          <div className={scr.split}>
            <div className={scr.card}>
              <h2 className={scr.h2}>Cost</h2>
              <p className={scr.cardSub}>
                Spend is metered per operation as the render runs. The gate below stops a video before it
                generates if the projected spend passes the cap.
              </p>
              <div>
                <div className={s.costRow}>
                  <div className={s.costMain}>
                    <div className={s.costName}>Budget cap for this video</div>
                    <div className={s.costDetail}>budget.max_usd_per_video — enforced pre-spend</div>
                  </div>
                  <div className={s.costValue}>${budget.toFixed(2)}</div>
                </div>
                <div className={s.costRow}>
                  <div className={s.costMain}>
                    <div className={s.costName}>This channel, latest month</div>
                    <div className={s.costDetail}>
                      {spend[0] ? `${spend[0].events} completed operations` : "nothing recorded yet"}
                    </div>
                  </div>
                  <div className={s.costValue}>${lastMonth.toFixed(3)}</div>
                </div>
                <div className={s.costRow}>
                  <div className={s.costMain}>
                    <div className={s.costName}>Average per recorded operation</div>
                    <div className={s.costDetail}>from cost_events, completed only</div>
                  </div>
                  <div className={s.costValue}>${perVideo.toFixed(4)}</div>
                </div>
                <div className={s.costTotal}>
                  <span className={s.costTotalLabel}>Ceiling for this render</span>
                  <span className={s.costTotalValue}>${budget.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div className={scr.stack}>
              <div className={`${scr.card} ${scr.cardTight}`}>
                <div className={scr.eyebrow}>Final check</div>
                <div className={scr.stackTight} style={{ marginBottom: 18 }}>
                  {[
                    [!!title.trim(), "The draft has a title"],
                    [chain.length > 0, "At least one visual source is enabled"],
                    [!!draft.theme && !!draft.style_pack, "Theme and style pack are named"],
                    [budget > 0, "A per-video budget cap is set"],
                  ].map(([ok, label]) => (
                    <div key={String(label)} className={s.check2}>
                      <span className={`${s.checkIcon}${ok ? "" : " " + s.warn}`}>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          {ok ? <path d="M3.5 8.5l3 3 6-6" /> : <circle cx="8" cy="8" r="4.5" strokeWidth="1.8" />}
                        </svg>
                      </span>
                      {label}
                    </div>
                  ))}
                </div>
                <button type="button" className={s.approve} disabled={busy} onClick={approve}>
                  {busy ? "Queueing…" : "Approve and generate"}
                </button>
                <p className={s.approveNote}>
                  Approving creates the draft with these overrides and runs pre-flight. Anything it refuses is
                  reported here instead of failing mid-render.
                </p>
                {problems.length > 0 && (
                  <div className={s.problems}>
                    {problems.map((p, i) => (
                      <div key={i} className={s.problem}>{p}</div>
                    ))}
                  </div>
                )}
              </div>

              <div className={`${scr.card} ${scr.cardTight}`}>
                <div className={scr.eyebrow}>Retention</div>
                <div className={scr.stackTight}>
                  <div className={scr.kv}>
                    <span>Clips</span><span>{draft.retention?.clips ?? "on_render"}</span>
                  </div>
                  <div className={scr.kv}>
                    <span>Final mp4 kept</span>
                    <span className={scr.mono}>{draft.retention?.final_mp4_days_after_posted ?? 30} days after posted</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


export default function QuotePage() {
  return (
    <Suspense fallback={<div className={scr.loading}>Loading…</div>}>
      <QuoteScreen />
    </Suspense>
  );
}
