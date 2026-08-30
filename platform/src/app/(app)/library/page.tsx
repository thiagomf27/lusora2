"use client";
/**
 * Library — search and browse what the b-roll library holds.
 *
 * Everything is broll-engine over HTTP through the platform's proxy (D11);
 * nothing imports across the boundary.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ClipCard } from "@/components/library/ClipCard";
import { ClipEditor } from "@/components/library/ClipEditor";
import { FilterRail } from "@/components/library/FilterRail";
import { ConfirmDelete, EmptyLibrary, NoResults, SkeletonGrid } from "@/components/library/States";
import {
  activeFilterCount, filterParams, fmtFootage, libGet, libList, libSend,
  type Filters, type LibraryStats, type Lookup, type Segment, type SourceCount, type TagCount,
} from "@/components/library/types";
import s from "./library.module.css";

const PAGE = 48;

export default function LibraryPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [filters, setFilters] = useState<Filters>({ include_global: true });
  // Duplicates are hidden everywhere by default — they hold no bytes and are
  // not footage anyone would pick. This is the one view that asks for them, so
  // the count on the overview has somewhere to lead.
  const [dupes, setDupes] = useState(false);
  const [sort, setSort] = useState("newest");
  const [rows, setRows] = useState<Segment[] | null>(null);
  const [total, setTotal] = useState(0);

  const [licences, setLicences] = useState<{ name: string; segments: number }[]>([]);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [sources, setSources] = useState<SourceCount[]>([]);
  const [channels, setChannels] = useState<Lookup[]>([]);
  const [stats, setStats] = useState<LibraryStats | null>(null);

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setError(null);
    setRows(null);
    try {
      // No query means BROWSE, which is a different endpoint, not an empty
      // search: /search embeds its q and ranks by distance to it, so "" would
      // rank the whole library against nothing.
      const params = filterParams(filters);
      const got = submitted.trim()
        ? await libList("search", { q: submitted.trim(), top_k: PAGE, ...params })
        : await libList("segments", {
            limit: PAGE, sort, ...params,
            include_duplicates: dupes ? "true" : undefined,
          });
      if (mine === seq.current) { setRows(got.rows); setTotal(got.total); }
    } catch (e) {
      if (mine === seq.current) {
        setRows([]);
        setError(e instanceof Error ? e.message : "the library is unreachable");
      }
    }
  }, [submitted, filters, sort, dupes]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setDupes(params.get("duplicates") === "1"); }, [params]);

  const loadFacets = useCallback(async () => {
    try {
      const [lic, tg, src, ch, st] = await Promise.all([
        libGet<{ known: string[]; present: { name: string; segments: number }[] }>("licenses"),
        libGet<TagCount[]>("tags", { limit: 40 }),
        libGet<SourceCount[]>("sources"),
        libGet<Lookup[]>("channels"),
        libGet<LibraryStats>("stats"),
      ]);
      setLicences(lic.present);
      setTags(tg); setSources(src); setChannels(ch); setStats(st);
    } catch { /* the banner from load() already says the library is unreachable */ }
  }, []);
  useEffect(() => { void loadFacets(); }, [loadFacets]);

  function toggle(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(true);
    try {
      await libSend("PATCH", `segments/${id}`, body);
      setEditing(null);
      await Promise.all([load(), loadFacets()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally { setBusy(false); }
  }

  async function destroy() {
    const ids = [...picked];
    setBusy(true);
    try {
      await libSend("DELETE", `segments?${ids.map((i) => `ids=${encodeURIComponent(i)}`).join("&")}`);
      setNotice(`deleted ${ids.length} clip${ids.length === 1 ? "" : "s"}`);
      setPicked(new Set());
      setConfirming(false);
      await Promise.all([load(), loadFacets()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete failed");
    } finally { setBusy(false); }
  }

  const nActive = activeFilterCount(filters);
  const searching = !!submitted.trim();

  return (
    <div className="page">
      <div className="pageHead">
        <div>
          <h1 className="pageTitle">B-roll library</h1>
          <div className="pageSub">
            {stats
              ? `${stats.approved.toLocaleString()} approved clips · ${fmtFootage(stats.duration_s)} of footage · ${stats.videos} sources`
              : "Tagged b-roll, searched by meaning."}
          </div>
        </div>
        <div className={s.headActions}>
          <Link className={s.outlineBtn} href="/library/overview">Overview</Link>
          <Link className={s.primaryBtn} href="/library/ingest">Ingest footage</Link>
        </div>
      </div>

      {error && <div className={s.error}>{error}</div>}
      {notice && <div className={s.notice}>{notice}</div>}

      {/* Pending clips are stored but invisible to search and to the worker,
          so the queue depth is the most consequential number on this page. */}
      {stats && stats.pending > 0 && (
        <Link className={s.pendingBanner} href="/library/review">
          <span className={s.pendingCount}>{stats.pending}</span>
          <span className={s.pendingBody}>
            <strong>{stats.pending} clip{stats.pending === 1 ? "" : "s"} waiting for review</strong>
            <span>Pending clips are stored but invisible to search and to the pipeline.</span>
          </span>
          <span className={s.primaryBtn}>Open review queue</span>
        </Link>
      )}

      <form className={s.searchRow} onSubmit={(e) => { e.preventDefault(); setSubmitted(query); }}>
        <div className={s.searchField}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
               strokeWidth="1.6" strokeLinecap="round">
            <circle cx="6.5" cy="6.5" r="4.5" /><line x1="9.8" y1="9.8" x2="14" y2="14" />
          </svg>
          <input value={query} onChange={(e) => setQuery(e.target.value)}
                 placeholder="aerial view of a 1940s harbour, cranes in fog" />
          {searching && (
            <button type="button" className={s.clearBtn}
                    onClick={() => { setQuery(""); setSubmitted(""); }}>clear</button>
          )}
        </div>
        <button className={s.primaryBtn} type="submit">Search</button>
      </form>
      <div className={s.searchHint}>
        <span className={s.hintLead}>Semantic search.</span> Describe the shot in a
        sentence — subject, setting, camera, mood. Keywords like “harbour fog”
        return worse results.
      </div>

      <div className={s.layout}>
        <FilterRail filters={filters} onChange={setFilters}
                    licences={licences} tags={tags} sources={sources} channels={channels} />

        <div className={s.results}>
          <div className={s.resultsBar}>
            <div className={s.resultsCount}>
              {searching ? (
                <>{total} result{total === 1 ? "" : "s"} for <strong>“{submitted}”</strong></>
              ) : (
                <>Showing <strong>{rows?.length ?? 0}</strong> of {total.toLocaleString()}
                  {nActive > 0 && ` · ${nActive} filter${nActive === 1 ? "" : "s"} active`}</>
              )}
            </div>
            {dupes && (
              <button className={s.link} onClick={() => {
                setDupes(false); router.replace("/library");
              }}>
                showing duplicates — back to the library
              </button>
            )}
            {!searching && (
              <select className={s.sortSelect} value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="duration">Longest first</option>
                <option value="usage">Most reused first</option>
                <option value="confidence">Lowest confidence first</option>
              </select>
            )}
          </div>

          {rows === null ? (
            <SkeletonGrid />
          ) : rows.length === 0 && searching ? (
            <NoResults query={submitted} activeFilters={nActive} pending={stats?.pending ?? 0}
                       onClear={() => setFilters({ include_global: true })} />
          ) : rows.length === 0 && nActive === 0 ? (
            <EmptyLibrary onIngest={() => router.push("/library/ingest")} />
          ) : rows.length === 0 ? (
            <NoResults query="these filters" activeFilters={nActive} pending={stats?.pending ?? 0}
                       onClear={() => setFilters({ include_global: true })} />
          ) : (
            <div className={s.grid}>
              {rows.map((seg, i) => (
                <div key={seg.id}>
                  <ClipCard
                    seg={seg}
                    rank={searching ? i + 1 : undefined}
                    selected={picked.has(seg.id)}
                    onSelect={(e) => toggle(seg.id, e)}
                  >
                    <button className={s.cardBtn}
                            onClick={() => setEditing(editing === seg.id ? null : seg.id)}>
                      {editing === seg.id ? "Close" : "Edit"}
                    </button>
                    {seg.duplicate_of && (
                      <span className={s.cardHint} title={seg.duplicate_of}>points at canonical</span>
                    )}
                  </ClipCard>
                  {editing === seg.id && (
                    <ClipEditor
                      caption={seg.caption} tags={seg.tags} license={seg.license}
                      sourceName={seg.source_name} licenses={licences.map((l) => l.name)}
                      busy={busy} autoFocus
                      onCancel={() => setEditing(null)}
                      onSave={(body) => patch(seg.id, body)}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {picked.size > 0 && (
        <div className={s.bulkBar}>
          <span className={s.bulkCount}>{picked.size} clip{picked.size === 1 ? "" : "s"} selected</span>
          <button className={s.link} onClick={() => setPicked(new Set())}>Clear</button>
          <div className={s.bulkActions}>
            <button className={s.dangerBtn} disabled={busy} onClick={() => setConfirming(true)}>
              Delete permanently
            </button>
          </div>
        </div>
      )}

      {confirming && (
        <ConfirmDelete count={picked.size} busy={busy}
                       onConfirm={destroy} onCancel={() => setConfirming(false)} />
      )}
    </div>
  );
}
