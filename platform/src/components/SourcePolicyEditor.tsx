"use client";
/**
 * Source-policy editor — the "Safety & sourcing" block from VidRush.dc.html,
 * shared by the quote statement and the brand profile.
 *
 * The mockup draws four source cards; the schema has three (`library`,
 * `stock`, `ai_image`). "General web crawling" is not a source this system
 * has, so it is not drawn — the licence chips carry the same risk decision.
 */
import { useState } from "react";
import type { ChannelConfig } from "@lusora/contracts";
import { Dropdown, TextInput } from "@/components/ds";
import scr from "@/app/(app)/screen.module.css";
import s from "./SourcePolicy.module.css";

type Visual = ChannelConfig["source_policy"]["visual"];
type VisualSource = Visual["chain"][number];
type MediaType = NonNullable<VisualSource["media_types"]>[number];

const ORIENTATIONS = ["landscape", "portrait", "square"];
const LICENSES = ["cc0", "cc-by", "cc-by-sa", "owned", "stock-licensed", "unknown"] as const;
type License = (typeof LICENSES)[number];

const SOURCE_META: Record<string, { name: string; desc: string; risk: string; riskClass: string }> = {
  library: {
    name: "Brand library",
    desc: "Your own uploaded media, searched by niche and tag before anything external.",
    risk: "Low risk",
    riskClass: s.riskLow,
  },
  stock: {
    name: "Commercial stock",
    desc: "Licensed footage and stills from the configured stock providers.",
    risk: "Medium risk",
    riskClass: s.riskMed,
  },
  ai_image: {
    name: "AI images",
    desc: "Generated stills for beats with no usable footage.",
    risk: "Low risk",
    riskClass: s.riskLow,
  },
};
const ALL_SOURCES = ["library", "stock", "ai_image"] as const;

/** `media_types` omitted means the source is not narrowed at all, which is
 *  not the same as narrowed to nothing — the fixture's ai_image entry relies
 *  on it. Only an explicit empty list is a source that can return nothing. */
export function mediaMode(src: VisualSource): string {
  if (src.media_types === undefined) return "Any media";
  const types = src.media_types;
  const video = types.includes("video") || types.includes("video_clip");
  const image = types.includes("image");
  if (video && image) return "Footage + images";
  if (video) return "Footage only";
  if (image) return "Images only";
  return "Nothing enabled";
}

/** Chip list with an inline "add" input — the mockup's tag box. */
export function TagBox({
  values,
  onChange,
  disabled = false,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className={scr.tagBox}>
      {values.map((t) => (
        <span key={t} className={scr.tag}>
          {t}
          {!disabled && (
            <button type="button" className={scr.tagX} onClick={() => onChange(values.filter((x) => x !== t))}>
              ×
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <input
          className={scr.tagInput}
          value={draft}
          placeholder="Add…"
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              e.preventDefault();
              if (!values.includes(draft.trim())) onChange([...values, draft.trim()]);
              setDraft("");
            }
          }}
        />
      )}
    </div>
  );
}

export default function SourcePolicyEditor({
  visual,
  onChange,
  disabled = false,
}: {
  visual: Visual;
  onChange: (next: Visual) => void;
  disabled?: boolean;
}) {
  const chain = visual.chain ?? [];
  const entryOf = (name: string) => chain.find((c) => c.source === name);

  function patch(fn: (v: Visual) => void) {
    const next = structuredClone(visual);
    fn(next);
    onChange(next);
  }

  return (
    <div className={scr.stack}>
      <div className={scr.card}>
        <h2 className={scr.h2}>Safety &amp; sourcing</h2>
        <p className={scr.cardSub}>
          Order is preference and omission is forbidden: a source that is off is never consulted.
        </p>
        <div className={s.sourceGrid}>
          {ALL_SOURCES.map((name) => {
            const meta = SOURCE_META[name];
            const entry = entryOf(name);
            const on = !!entry;
            const unrestricted = !!entry && entry.media_types === undefined;
            const types = entry?.media_types ?? [];
            const footage = unrestricted || types.includes("video") || types.includes("video_clip");
            const images = unrestricted || types.includes("image");
            const videoKey: MediaType = name === "library" ? "video_clip" : "video";
            return (
              <div key={name} className={`${s.source}${on ? " " + s.on : ""}`}>
                <div className={`${s.riskBar} ${meta.riskClass}`}>{meta.risk}</div>
                <div className={s.sourceBody}>
                  <button
                    type="button"
                    className={s.sourceHead}
                    disabled={disabled}
                    onClick={() =>
                      patch((v) => {
                        const at = v.chain.findIndex((x) => x.source === name);
                        if (at >= 0) v.chain.splice(at, 1);
                        else v.chain.push({ source: name, media_types: [videoKey, "image"] } as VisualSource);
                      })
                    }
                  >
                    <span className={`${s.check}${on ? " " + s.on : ""}`}>
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3.5 8.5l3 3 6-6" />
                      </svg>
                    </span>
                    <span className={s.sourceName}>{meta.name}</span>
                  </button>
                  <p className={s.sourceDesc}>{meta.desc}</p>
                  <div className={`${s.modes}${on ? "" : " " + s.off}`}>
                    <button
                      type="button"
                      disabled={!on || disabled}
                      className={`${s.mode}${footage ? " " + s.on : ""}`}
                      onClick={() =>
                        patch((v) => {
                          const e = v.chain.find((x) => x.source === name);
                          if (!e) return;
                          const set = new Set<MediaType>(e.media_types ?? []);
                          if (footage) {
                            set.delete("video");
                            set.delete("video_clip");
                          } else set.add(videoKey);
                          e.media_types = [...set];
                        })
                      }
                    >
                      Footage
                    </button>
                    <button
                      type="button"
                      disabled={!on || disabled}
                      className={`${s.mode}${images ? " " + s.on : ""}`}
                      onClick={() =>
                        patch((v) => {
                          const e = v.chain.find((x) => x.source === name);
                          if (!e) return;
                          const set = new Set<MediaType>(e.media_types ?? []);
                          if (images) set.delete("image");
                          else set.add("image");
                          e.media_types = [...set];
                        })
                      }
                    >
                      Images
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {chain.length === 0 && (
          <div className={`${scr.notice} ${scr.noticeDanger}`} style={{ marginTop: 16 }}>
            Every source is off — the chain needs at least one entry or pre-flight refuses the video.
          </div>
        )}
      </div>

      <div className={scr.splitEven}>
        <div className={scr.card}>
          <h2 className={scr.h2}>Priority order</h2>
          <p className={scr.cardSub}>Resolution walks the chain top to bottom and stops at the first acceptable asset.</p>
          <div className={scr.stackTight}>
            {chain.map((entry, i) => (
              <div key={entry.source} className={s.priorityRow}>
                <span className={s.rank}>{i + 1}</span>
                <span className={s.priorityName}>{SOURCE_META[entry.source]?.name ?? entry.source}</span>
                <span className={s.priorityMode}>{mediaMode(entry)}</span>
                <button type="button" className={s.move} disabled={i === 0 || disabled}
                        onClick={() => patch((v) => { [v.chain[i - 1], v.chain[i]] = [v.chain[i], v.chain[i - 1]]; })}>
                  <svg className={s.flip} width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 6l4 4 4-4" />
                  </svg>
                </button>
                <button type="button" className={s.move} disabled={i === chain.length - 1 || disabled}
                        onClick={() => patch((v) => { [v.chain[i + 1], v.chain[i]] = [v.chain[i], v.chain[i + 1]]; })}>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 6l4 4 4-4" />
                  </svg>
                </button>
              </div>
            ))}
            {chain.length === 0 && <div className={scr.toggleDesc}>Nothing in the chain.</div>}
          </div>
        </div>

        <div className={scr.card}>
          <h2 className={scr.h2}>Library filters</h2>
          <p className={scr.cardSub}>
            Every filter maps 1:1 to a library_search parameter — stored arguments, not a query language.
          </p>
          {entryOf("library") ? (
            <div className={scr.stack}>
              <div>
                <div className={scr.fieldLabel}>Niches</div>
                <TagBox
                  disabled={disabled}
                  values={entryOf("library")?.niches ?? []}
                  onChange={(next) => patch((v) => {
                    const e = v.chain.find((x) => x.source === "library");
                    if (e) e.niches = next;
                  })}
                />
              </div>
              <div>
                <div className={scr.fieldLabel}>Tags</div>
                <TagBox
                  disabled={disabled}
                  values={entryOf("library")?.tags ?? []}
                  onChange={(next) => patch((v) => {
                    const e = v.chain.find((x) => x.source === "library");
                    if (e) e.tags = next;
                  })}
                />
              </div>
              <div>
                <div className={scr.fieldLabel}>Accepted licences</div>
                <div className={scr.segments} style={{ flexWrap: "wrap" }}>
                  {LICENSES.map((lic) => {
                    const active = (entryOf("library")?.licenses ?? []).includes(lic);
                    return (
                      <button key={lic} type="button" disabled={disabled}
                              className={`${scr.segment}${active ? " " + scr.on : ""}`}
                              onClick={() => patch((v) => {
                                const e = v.chain.find((x) => x.source === "library");
                                if (!e) return;
                                const set = new Set<License>((e.licenses ?? []) as License[]);
                                if (active) set.delete(lic);
                                else set.add(lic);
                                e.licenses = [...set];
                              })}>
                        {lic}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className={scr.toggleDesc}>The brand library is off.</div>
          )}
        </div>
      </div>

      <div className={scr.card}>
        <h2 className={scr.h2}>Fallbacks &amp; de-duplication</h2>
        <p className={scr.cardSub}>
          What happens when the chain returns something weak, short, or already used (D54/D55).
        </p>
        <div className={scr.grid2}>
          <Dropdown label="Orientation" options={ORIENTATIONS} value={visual.orientation ?? "landscape"} disabled={disabled}
                    onChange={(v) => patch((n) => { n.orientation = v as Visual["orientation"]; })} />
          <TextInput label="Max clip seconds" type="number" disabled={disabled}
                     value={String(visual.max_clip_seconds ?? 12)}
                     onChange={(e) => { const n = Number(e.currentTarget.value); patch((v) => { v.max_clip_seconds = n; }); }} />
          <TextInput label="Min score floor (0 = off)" type="number" step="0.05" disabled={disabled}
                     value={String(visual.min_score_floor ?? 0)}
                     onChange={(e) => { const n = Number(e.currentTarget.value); patch((v) => { v.min_score_floor = n; }); }} />
          <TextInput label="Reuse window (items, 0 = whole video)" type="number" disabled={disabled}
                     value={String(visual.dedup?.reuse_window_items ?? 0)}
                     onChange={(e) => { const n = Number(e.currentTarget.value); patch((v) => { v.dedup = { ...v.dedup, reuse_window_items: n }; }); }} />
        </div>
      </div>
    </div>
  );
}
