"use client";
/**
 * The filter rail. Every control here is a parameter the library API has
 * always accepted and nothing exposed — duration range, licence any-of, tags
 * any-of, a date window, and channel scope. It is the single biggest thing
 * the screens gained.
 *
 * Counts come from the library itself (`/licenses`, `/tags`), so an option
 * that would return nothing is never offered.
 */
import type { Filters, Lookup, TagCount } from "./types";
import s from "./rail.module.css";

const DUR_MAX = 30;

export function FilterRail({
  filters, onChange, licences, tags, sources, channels,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
  licences: { name: string; segments: number }[];
  tags: TagCount[];
  sources: { name: string; segments: number }[];
  channels: Lookup[];
}) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const toggle = (key: "licenses" | "tags", value: string) => {
    const cur = filters[key] ?? [];
    set({ [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] });
  };

  return (
    <aside className={s.rail}>
      <div className={s.head}>
        <span className={s.label}>Filters</span>
        <button className={s.link} onClick={() => onChange({ include_global: true })}>
          Reset
        </button>
      </div>

      <section className={s.group}>
        <div className={s.groupLabel}>Duration</div>
        <div className={s.range}>
          <input type="number" min={0} max={DUR_MAX} step={1} className={s.num}
                 value={filters.min_duration ?? ""} placeholder="min"
                 onChange={(e) => set({ min_duration: e.target.value ? Number(e.target.value) : undefined })} />
          <span className={s.dash}>–</span>
          <input type="number" min={0} max={DUR_MAX} step={1} className={s.num}
                 value={filters.max_duration ?? ""} placeholder="max"
                 onChange={(e) => set({ max_duration: e.target.value ? Number(e.target.value) : undefined })} />
          <span className={s.unit}>sec</span>
        </div>
      </section>

      <div className={s.sep} />

      <section className={s.group}>
        <div className={s.groupLabel}>Licence</div>
        {licences.length === 0 && <span className={s.faint}>nothing ingested yet</span>}
        {licences.map((l) => (
          <label key={l.name} className={s.check}>
            <span className={`${s.box} ${filters.licenses?.includes(l.name) ? s.boxOn : ""}`}>
              {filters.licenses?.includes(l.name) && (
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="#fff"
                     strokeWidth="2.2" strokeLinecap="round"><path d="M3 8.5 6.5 12 13 4.5" /></svg>
              )}
            </span>
            <input type="checkbox" className={s.sr} checked={!!filters.licenses?.includes(l.name)}
                   onChange={() => toggle("licenses", l.name)} />
            {l.name}
            <span className={s.count}>{l.segments}</span>
          </label>
        ))}
      </section>

      <div className={s.sep} />

      <section className={s.group}>
        <div className={s.groupLabel}>Tags</div>
        <div className={s.chips}>
          {tags.length === 0 && <span className={s.faint}>no tags yet</span>}
          {tags.slice(0, 14).map((t) => (
            <button key={t.name} type="button"
                    className={`${s.chip} ${filters.tags?.includes(t.name) ? s.chipOn : ""}`}
                    onClick={() => toggle("tags", t.name)}>
              {t.name}{filters.tags?.includes(t.name) ? " ✕" : ""}
            </button>
          ))}
        </div>
      </section>

      <div className={s.sep} />

      <section className={s.group}>
        <div className={s.groupLabel}>Origin</div>
        <select className={s.select} value={filters.source_name ?? ""}
                onChange={(e) => set({ source_name: e.target.value || undefined })}>
          <option value="">any origin</option>
          {sources.map((o) => (
            <option key={o.name} value={o.name}>{o.name} ({o.segments})</option>
          ))}
        </select>
      </section>

      <div className={s.sep} />

      <section className={s.group}>
        <div className={s.groupLabel}>Added</div>
        <div className={s.range}>
          <input type="date" className={s.date}
                 value={filters.created_after ? toDate(filters.created_after) : ""}
                 onChange={(e) => set({ created_after: e.target.value ? Date.parse(e.target.value) / 1000 : undefined })} />
          <input type="date" className={s.date}
                 value={filters.created_before ? toDate(filters.created_before) : ""}
                 onChange={(e) => set({ created_before: e.target.value ? Date.parse(e.target.value) / 1000 : undefined })} />
        </div>
      </section>

      {channels.length > 0 && (
        <>
          <div className={s.sep} />
          <section className={s.group}>
            <div className={s.groupLabel}>Scope</div>
            <select className={s.select} value={filters.channel_id ?? ""}
                    onChange={(e) => set({ channel_id: e.target.value || undefined })}>
              <option value="">every channel</option>
              {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {/* Only meaningful once a channel is picked: with no channel the
                library applies no scoping at all, so "include global" has
                nothing to include it alongside. */}
            {filters.channel_id && (
              <label className={s.check}>
                <span className={`${s.box} ${filters.include_global !== false ? s.boxOn : ""}`}>
                  {filters.include_global !== false && (
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="#fff"
                         strokeWidth="2.2" strokeLinecap="round"><path d="M3 8.5 6.5 12 13 4.5" /></svg>
                  )}
                </span>
                <input type="checkbox" className={s.sr}
                       checked={filters.include_global !== false}
                       onChange={(e) => set({ include_global: e.target.checked })} />
                Include global clips
              </label>
            )}
          </section>
        </>
      )}
    </aside>
  );
}

function toDate(epoch: number): string {
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}
