"use client";
/**
 * Library — search and browse what the b-roll library holds, and queue ingests
 * into it. Everything here is broll-engine over HTTP through the platform's
 * proxy (D11); nothing imports across the boundary.
 *
 * The ingest form is not a convenience. Library channels are created
 * get-or-create at POST /jobs and nowhere else, and the worker's adapter now
 * fails closed on an unresolved channel — so until a channel has ingested
 * something under its own name, it sees only the global pool. This form is how
 * that name comes to exist.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ClipCard, ClipEditor } from "@/components/library/ClipCard";
import { libGet, libSend, type Job, type Lookup, type Segment } from "@/components/library/types";
import s from "./library.module.css";

const ACTIVE_JOBS = new Set(["queued", "preparing", "downloading", "tagging", "cutting", "storing"]);

export default function LibraryPage() {
  const [query, setQuery] = useState("");
  const [license, setLicense] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [rows, setRows] = useState<Segment[] | null>(null);
  const [licenses, setLicenses] = useState<string[]>([]);
  const [sources, setSources] = useState<{ name: string; segments: number }[]>([]);
  const [pending, setPending] = useState<number | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setError(null);
    try {
      // No query means BROWSE, which is a different endpoint, not an empty
      // search: /search embeds its q and ranks by distance to it, so "" would
      // rank the whole library against the empty string.
      const params = { license, source_name: sourceName };
      const hits = query.trim()
        ? await libGet<Segment[]>("search", { q: query.trim(), top_k: 48, ...params })
        : await libGet<Segment[]>("segments", { limit: 48, ...params });
      if (mine === seq.current) setRows(hits);
    } catch (e) {
      if (mine === seq.current) {
        setRows([]);
        setError(e instanceof Error ? e.message : "search failed");
      }
    }
  }, [query, license, sourceName]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    (async () => {
      try {
        const [lic, src, pend] = await Promise.all([
          libGet<{ known: string[] }>("licenses"),
          libGet<{ name: string; segments: number }[]>("sources"),
          libGet<Segment[]>("segments", { status: "pending", limit: 200 }),
        ]);
        setLicenses(lic.known);
        setSources(src);
        setPending(pend.length);
      } catch {
        /* the banner from load() already says the library is unreachable */
      }
    })();
  }, []);

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(true);
    try {
      await libSend("PATCH", `segments/${id}`, body);
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(seg: Segment) {
    if (!confirm(`Delete this clip permanently?\n\n${seg.caption}\n\nThe source video was deleted after tagging, so recovery means re-ingesting it.`)) return;
    setBusy(true);
    try {
      await libSend("DELETE", `segments/${seg.id}`);
      setNotice("clip deleted");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="pageHead">
        <div>
          <h1 className="pageTitle">Library</h1>
          <div className="pageSub">
            Tagged b-roll, searched by meaning. Preferred over stock, preferred over generation.
          </div>
        </div>
        {/* always a way through, even at zero: the queue being empty is
            something you go and check, not something you wait to be told */}
        <Link className={pending ? s.reviewCta : s.reviewCtaQuiet} href="/library/review">
          {pending ? `${pending} awaiting review →` : "Review →"}
        </Link>
      </div>

      {error && <div className={s.error}>{error}</div>}
      {notice && <div className={s.notice}>{notice}</div>}

      <IngestPanel
        licenses={licenses}
        onQueued={(n) => setNotice(`queued ${n} ingest job${n === 1 ? "" : "s"}`)}
        onError={setError}
      />

      <div className={s.filters}>
        <input
          className={s.search}
          placeholder="scout-style search: 'aerial view of a 1940s harbour, cranes in fog…'"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className={s.filter} value={license} onChange={(e) => setLicense(e.target.value)}>
          <option value="">any licence</option>
          {licenses.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select className={s.filter} value={sourceName} onChange={(e) => setSourceName(e.target.value)}>
          <option value="">any origin</option>
          {sources.map((o) => (
            <option key={o.name} value={o.name}>{o.name} ({o.segments})</option>
          ))}
        </select>
      </div>

      {rows === null ? (
        <div className={s.empty}>loading…</div>
      ) : rows.length === 0 ? (
        <div className={s.empty}>
          {query.trim() ? "nothing close enough" : "the library is empty — queue an ingest above"}
        </div>
      ) : (
        <div className={s.grid}>
          {rows.map((seg) => (
            <div key={seg.id}>
              <ClipCard seg={seg}>
                <button className={s.cardBtn} onClick={() => setEditing(editing === seg.id ? null : seg.id)}>
                  {editing === seg.id ? "Close" : "Edit"}
                </button>
                <button className={s.cardDanger} onClick={() => remove(seg)} disabled={busy}>
                  Delete
                </button>
              </ClipCard>
              {editing === seg.id && (
                <ClipEditor
                  seg={seg}
                  licenses={licenses}
                  busy={busy}
                  onCancel={() => setEditing(null)}
                  onSave={(body) => patch(seg.id, body)}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Queue a link, and watch the serial queue chew through it. */
function IngestPanel({
  licenses,
  onQueued,
  onError,
}: {
  licenses: string[];
  onQueued: (n: number) => void;
  onError: (e: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [urls, setUrls] = useState("");
  const [channel, setChannel] = useState("");
  const [niches, setNiches] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [license, setLicense] = useState("unknown");
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);

  // The queue is serial by design — one download at a time through the proxy,
  // because parallel yt-dlp traffic is the classic bot signature. So a job list
  // is not a nicety: a link queued behind a 40-minute documentary looks broken
  // without it.
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const rows = await libGet<Job[]>("jobs", { limit: 8 });
        if (!stop) setJobs(rows);
      } catch { /* unreachable library is reported by the page */ }
    };
    void tick();
    const t = setInterval(tick, 4000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  async function queue() {
    const list = urls.split(/[\s,]+/).map((u) => u.trim()).filter(Boolean);
    if (!list.length) return;
    setBusy(true);
    try {
      await libSend("POST", "jobs", {
        urls: list,
        channel: channel.trim() || null,
        niches: niches.split(",").map((n) => n.trim()).filter(Boolean),
        source_name: sourceName.trim() || null,
        license,
      });
      setUrls("");
      onQueued(list.length);
    } catch (e) {
      onError(e instanceof Error ? e.message : "ingest failed");
    } finally {
      setBusy(false);
    }
  }

  const active = jobs.filter((j) => ACTIVE_JOBS.has(j.status));

  return (
    <div className={s.ingest}>
      <button className={s.ingestHead} onClick={() => setOpen(!open)}>
        <span>{open ? "▾" : "▸"} Ingest</span>
        {active.length > 0 && <span className={s.jobCount}>{active.length} running</span>}
      </button>

      {open && (
        <div className={s.ingestBody}>
          <textarea
            className={s.urlBox}
            rows={2}
            placeholder="YouTube / archive.org links, one per line"
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
          />
          <div className={s.ingestRow}>
            <input
              className={s.filter}
              placeholder="channel (creates it if new)"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
            />
            <input
              className={s.filter}
              placeholder="niches, comma separated"
              value={niches}
              onChange={(e) => setNiches(e.target.value)}
            />
            <input
              className={s.filter}
              placeholder="origin (uploader, client…)"
              value={sourceName}
              onChange={(e) => setSourceName(e.target.value)}
            />
            <select className={s.filter} value={license} onChange={(e) => setLicense(e.target.value)}>
              {licenses.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <button className={s.primaryBtn} onClick={queue} disabled={busy || !urls.trim()}>
              Queue
            </button>
          </div>
          <div className={s.hint}>
            The channel name is what scopes a clip to a channel. A lusora channel with
            no library channel of its own searches the global pool only.
          </div>
        </div>
      )}

      {jobs.length > 0 && (
        <div className={s.jobs}>
          {jobs.slice(0, 5).map((j) => (
            <div key={j.id} className={s.job}>
              <span className={`${s.jobDot} ${s[j.status] ?? ""}`} />
              <span className={s.jobStatus}>
                {j.status}
                {ACTIVE_JOBS.has(j.status) && j.progress > 0 && ` ${Math.round(j.progress * 100)}%`}
              </span>
              <span className={s.jobUrl} title={j.url ?? j.kind}>{j.url ?? j.kind}</span>
              {j.status === "done" && j.segments_created !== null && (
                <span className={s.jobDone}>{j.segments_created} clips</span>
              )}
              {j.error && <span className={s.jobErr} title={j.error}>{j.error}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
