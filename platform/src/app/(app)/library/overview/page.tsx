"use client";
/**
 * Library overview — what is actually in here.
 *
 * Every number is live from the index. The counts deliberately separate
 * approved from pending and exclude duplicates from footage totals: a pending
 * clip is not in the library yet, and a duplicate holds no bytes of its own,
 * so counting either would overstate what exists.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  fmtAge, fmtFootage, libGet, libList, libSend,
  type Job, type LibraryStats, type Segment, type SourceCount, type SourceVideo,
} from "@/components/library/types";
import s from "../library.module.css";
import o from "./overview.module.css";

interface PurgePreview {
  segments: number;
  files_deleted?: number;
  ids?: string[];
}

export default function OverviewPage() {
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [sources, setSources] = useState<SourceCount[]>([]);
  const [licences, setLicences] = useState<{ name: string; segments: number }[]>([]);
  const [videos, setVideos] = useState<SourceVideo[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [reused, setReused] = useState<Segment[]>([]);

  const [purgeId, setPurgeId] = useState("");
  const [preview, setPreview] = useState<PurgePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [st, src, lic, vids, jb, top] = await Promise.all([
        libGet<LibraryStats>("stats"),
        libGet<SourceCount[]>("sources"),
        libGet<{ present: { name: string; segments: number }[] }>("licenses"),
        libGet<SourceVideo[]>("videos", { limit: 40 }),
        libGet<Job[]>("jobs", { limit: 6 }),
        libList("segments", { limit: 5, sort: "usage" }),
      ]);
      setStats(st); setSources(src); setLicences(lic.present);
      setVideos(vids); setJobs(jb); setReused(top.rows.filter((r) => r.usage_count > 0));
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not reach the library");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function dryRun() {
    if (!purgeId) return;
    setBusy(true); setError(null);
    try {
      setPreview(await libSend<PurgePreview>(
        "DELETE", `segments?video_id=${encodeURIComponent(purgeId)}&dry_run=true`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "preview failed");
      setPreview(null);
    } finally { setBusy(false); }
  }

  async function purge() {
    setBusy(true);
    try {
      const res = await libSend<PurgePreview>(
        "DELETE", `segments?video_id=${encodeURIComponent(purgeId)}`);
      setNotice(`purged ${res.segments} clips — the source can be ingested again`);
      setPreview(null); setPurgeId("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "purge failed");
    } finally { setBusy(false); }
  }

  const maxSource = Math.max(1, ...sources.map((x) => x.segments));
  const maxLic = Math.max(1, ...licences.map((x) => x.segments));
  const unknown = licences.find((l) => l.name === "unknown");
  const chosen = videos.find((v) => v.video_id === purgeId);

  return (
    <div className="page">
      <div className="pageHead">
        <div>
          <h1 className="pageTitle">Library overview</h1>
          <div className="pageSub">
            Counts are live from the index. Pending clips are stored but excluded from search.
          </div>
        </div>
        <div className={s.headActions}>
          <Link className={s.outlineBtn} href="/library">Browse library</Link>
          <Link className={s.primaryBtn} href="/library/ingest">Ingest footage</Link>
        </div>
      </div>

      {error && <div className={s.error}>{error}</div>}
      {notice && <div className={s.notice}>{notice}</div>}

      <div className={o.tiles}>
        <Tile label="Approved clips" value={stats?.approved.toLocaleString() ?? "—"}
              sub={stats ? `${fmtFootage(stats.duration_s)} of footage` : ""} />
        <Tile label="Pending review" value={stats?.pending.toLocaleString() ?? "—"}
              sub="not searchable yet" href="/library/review"
              tone={stats && stats.pending > 0 ? "danger" : undefined} />
        <Tile label="Sources" value={String(stats?.videos ?? "—")}
              sub={stats ? `across ${stats.sources} origins` : ""} />
        <Tile label="Duplicates" value={stats?.duplicates.toLocaleString() ?? "—"}
              sub={stats?.duplicates ? "look at them" : "pointer rows, no bytes"}
              href={stats?.duplicates ? "/library?duplicates=1" : undefined} />
      </div>

      <div className={o.cols}>
        <section className={o.card}>
          <div className={o.cardHead}>
            <span className={o.cardLabel}>By origin</span>
            <span className={o.dim}>{sources.length} origins</span>
          </div>
          {sources.length === 0 && <span className={o.faint}>nothing ingested yet</span>}
          {sources.slice(0, 8).map((x) => (
            <div key={x.name} className={o.barRow}>
              <div className={o.barHead}>
                <span>{x.name}</span><span className={o.mono}>{x.segments}</span>
              </div>
              <div className={o.barTrack}>
                <div className={o.barFill} style={{ width: `${(x.segments / maxSource) * 100}%` }} />
              </div>
            </div>
          ))}
        </section>

        <section className={o.card}>
          <div className={o.cardHead}>
            <span className={o.cardLabel}>By licence</span>
            <span className={o.dim}>what channels can accept</span>
          </div>
          {licences.map((x) => (
            <div key={x.name} className={o.licRow}>
              <span className={`${o.licPill} ${x.name === "unknown" ? o.licBad : ""}`}>{x.name}</span>
              <span className={o.barTrack}>
                <span className={x.name === "unknown" ? o.barFillBad : o.barFill}
                      style={{ width: `${(x.segments / maxLic) * 100}%`, display: "block", height: "100%" }} />
              </span>
              <span className={o.mono}>{x.segments}</span>
            </div>
          ))}
          {unknown && unknown.segments > 0 && (
            <div className={o.warnBox}>
              {unknown.segments} clip{unknown.segments === 1 ? "" : "s"} carry an
              unknown licence and cannot be used on any channel with a copyright
              policy. Fixing it means editing them, or the ingest they came from.
            </div>
          )}
        </section>

        <section className={o.card}>
          <div className={o.cardHead}><span className={o.cardLabel}>Recent ingests</span></div>
          {jobs.length === 0 && <span className={o.faint}>no jobs yet</span>}
          {jobs.map((j) => (
            <div key={j.id} className={o.listRow}>
              <span className={o.listTitle} title={j.url ?? j.video_id ?? j.id}>
                {j.url ?? j.video_id ?? j.id}
              </span>
              <span className={o.tag}>{j.status}</span>
              <span className={o.mono}>{j.segments_created ?? "—"}</span>
            </div>
          ))}
        </section>

        <section className={o.card}>
          <div className={o.cardHead}>
            <span className={o.cardLabel}>Most reused</span>
            <span className={o.dim}>stale suggestions</span>
          </div>
          {reused.length === 0 && <span className={o.faint}>nothing has been used in a video yet</span>}
          {reused.map((r) => (
            <div key={r.id} className={o.listRow}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className={o.thumb} src={`/api/library/thumbs/${r.id}`} alt="" loading="lazy" />
              <span className={o.listTitle} title={r.caption}>{r.caption}</span>
              <span className={r.usage_count >= 5 ? o.monoWarn : o.mono}>used ×{r.usage_count}</span>
            </div>
          ))}
          {reused.length > 0 && (
            <p className={o.note}>
              Search penalises reuse, so these keep dropping down the ranking.
              Worth ingesting fresh footage for whatever they cover.
            </p>
          )}
        </section>
      </div>

      <section className={o.purge}>
        <div className={o.purgeHead}>
          <div>
            <div className={o.purgeTitle}>Purge a source</div>
            <div className={o.dim}>
              Removes every clip cut from one source video — the way to redo a bad
              ingest, since `ingest_url` skips a video already in the library.
            </div>
          </div>
          <div className={o.purgeControls}>
            <select className={o.select} value={purgeId}
                    onChange={(e) => { setPurgeId(e.target.value); setPreview(null); }}>
              <option value="">pick a source video…</option>
              {videos.map((v) => (
                <option key={v.video_id} value={v.video_id}>
                  {v.source_name ?? v.video_id} — {v.segments} clips
                  {v.pending ? ` (${v.pending} pending)` : ""} · {fmtAge(v.created_at)}
                </option>
              ))}
            </select>
            <button className={s.outlineBtn} disabled={!purgeId || busy} onClick={dryRun}>
              Preview purge
            </button>
          </div>
        </div>

        {preview && (
          <div className={o.dryRun}>
            <div className={o.cardLabel}>Dry run</div>
            <div className={o.dryStats}>
              <span>{preview.segments} clips</span>
              {chosen && <span>{chosen.pending} pending</span>}
              {chosen && <span>{chosen.segments - chosen.pending} approved</span>}
            </div>
            <p className={o.note}>
              Deleting a canonical takes its duplicates with it, including
              duplicates from other source videos — no row is left dangling. The
              source video no longer exists, so re-ingesting means finding the
              original link again.
            </p>
            <div className={o.dryActions}>
              <button className={o.dangerBtn} disabled={busy} onClick={purge}>
                Purge {preview.segments} clips permanently
              </button>
              <button className={s.outlineBtn} onClick={() => setPreview(null)}>Cancel</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Tile({
  label, value, sub, href, tone,
}: {
  label: string; value: string; sub?: string; href?: string; tone?: "danger";
}) {
  const body = (
    <>
      <span className={o.tileLabel}>{label}</span>
      <span className={tone === "danger" ? o.tileValueBad : o.tileValue}>{value}</span>
      {sub && <span className={href ? o.tileLink : o.dim}>{sub}</span>}
    </>
  );
  const cls = `${o.tile} ${tone === "danger" ? o.tileBad : ""}`;
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}
