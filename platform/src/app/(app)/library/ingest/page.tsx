"use client";
/**
 * Ingest — links and uploads, and the queue that works through them.
 *
 * The queue is serial by design: one download at a time through the proxy,
 * because parallel yt-dlp traffic is the classic bot signature. So a job list
 * with a stage and a percentage is not decoration — a link queued behind a
 * 40-minute documentary looks broken without it.
 *
 * Provenance is captured per ingest and cannot be recovered later: the source
 * video is deleted after tagging, so a wrong licence here means every clip
 * from that source carries it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { libGet, libSend, type Job, type Lookup } from "@/components/library/types";
import s from "../library.module.css";
import g from "./ingest.module.css";

type Mode = "url" | "video_file" | "image";

const STAGES = ["queued", "downloading", "tagging", "cutting", "storing"] as const;
const ACTIVE = new Set<string>([...STAGES, "preparing"]);

export default function IngestPage() {
  const [mode, setMode] = useState<Mode>("url");
  const [urls, setUrls] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [channel, setChannel] = useState("");
  const [niches, setNiches] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [license, setLicense] = useState("unknown");

  const [licences, setLicences] = useState<string[]>([]);
  const [channels, setChannels] = useState<Lookup[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const drop = useRef<HTMLDivElement | null>(null);

  const poll = useCallback(async () => {
    try { setJobs(await libGet<Job[]>("jobs", { limit: 20 })); }
    catch { /* the page's banner already says the library is unreachable */ }
  }, []);

  useEffect(() => {
    void poll();
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, [poll]);

  useEffect(() => {
    libGet<{ known: string[] }>("licenses").then((l) => setLicences(l.known)).catch(() => {});
    libGet<Lookup[]>("channels").then(setChannels).catch(() => {});
  }, []);

  async function queue() {
    setBusy(true); setError(null);
    try {
      if (mode === "url") {
        const list = urls.split(/[\s,]+/).map((u) => u.trim()).filter(Boolean);
        if (!list.length) return;
        await libSend("POST", "jobs", {
          urls: list,
          channel: channel.trim() || null,
          niches: niches.split(",").map((n) => n.trim()).filter(Boolean),
          source_name: sourceName.trim() || null,
          license,
        });
        setUrls("");
        setNotice(`queued ${list.length} ingest job${list.length === 1 ? "" : "s"}`);
      } else {
        if (!files.length) return;
        // multipart, not JSON: the payload is a video, and base64 in a JSON
        // body would inflate it by a third and buffer the whole thing twice
        const fd = new FormData();
        for (const f of files) fd.append("files", f);
        fd.append("kind", mode);
        if (channel.trim()) fd.append("channel", channel.trim());
        if (niches.trim()) fd.append("niches", niches.trim());
        if (sourceName.trim()) fd.append("source_name", sourceName.trim());
        if (sourceUrl.trim()) fd.append("source_url", sourceUrl.trim());
        fd.append("license", license);
        const res = await fetch("/api/library/uploads", { method: "POST", body: fd });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error ?? d.detail ?? "upload failed");
        }
        setNotice(mode === "image"
          ? `queued ${files.length} image${files.length === 1 ? "" : "s"} as one job`
          : `queued ${files[0].name}`);
        setFiles([]);
      }
      await poll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ingest failed");
    } finally { setBusy(false); }
  }

  async function jobAction(id: string, what: "cancel" | "retry") {
    setBusy(true);
    try {
      if (what === "cancel") await libSend("DELETE", `jobs/${id}`);
      else await libSend("POST", `jobs/${id}/retry`);
      await poll();
    } catch (e) {
      setError(e instanceof Error ? e.message : `${what} failed`);
    } finally { setBusy(false); }
  }

  const running = jobs.filter((j) => ACTIVE.has(j.status));
  const canQueue = mode === "url" ? !!urls.trim() : files.length > 0;

  return (
    <div className="page">
      <div className="pageHead">
        <div>
          <h1 className="pageTitle">Ingest</h1>
          <div className="pageSub">
            One download runs at a time. Queued jobs start when the one above finishes.
          </div>
        </div>
        <div className={s.headActions}>
          <Link className={s.outlineBtn} href="/library">Library</Link>
          <Link className={s.outlineBtn} href="/library/review">Review</Link>
        </div>
      </div>

      {error && <div className={s.error}>{error}</div>}
      {notice && <div className={s.notice}>{notice}</div>}

      <div className={g.layout}>
        <div className={g.form}>
          <div className={g.tabs}>
            {([["url", "Paste link"], ["video_file", "Video file"], ["image", "Image batch"]] as [Mode, string][])
              .map(([m, label]) => (
                <button key={m} type="button"
                        className={`${g.tab} ${mode === m ? g.tabOn : ""}`}
                        onClick={() => { setMode(m); setFiles([]); }}>{label}</button>
              ))}
          </div>

          {mode === "url" ? (
            <label className={g.field}>
              <span className={g.fieldLabel}>Source URL</span>
              <textarea className={g.textarea} rows={3} value={urls}
                        onChange={(e) => setUrls(e.target.value)}
                        placeholder="YouTube / archive.org links, one per line" />
              <span className={g.hint}>
                A 40-minute source can take ~25 minutes to ingest.
              </span>
            </label>
          ) : (
            <div
              ref={drop}
              className={g.drop}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const dropped = [...e.dataTransfer.files];
                setFiles(mode === "video_file" ? dropped.slice(0, 1) : dropped);
              }}
            >
              <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                   strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 11V3m0 0L5 6m3-3 3 3M3 12.5h10" />
              </svg>
              <span className={g.dropText}>
                {files.length === 0
                  ? mode === "video_file" ? "Drop a video file, or browse" : "Drop images, or browse"
                  : mode === "video_file"
                    ? files[0].name
                    : `${files.length} image${files.length === 1 ? "" : "s"} — one job, one clip each`}
              </span>
              <input type="file" className={g.fileInput}
                     multiple={mode === "image"}
                     accept={mode === "image" ? "image/*" : "video/*"}
                     onChange={(e) => setFiles([...(e.target.files ?? [])])} />
              <span className={g.hint}>
                {mode === "image"
                  ? "A batch is ONE job: purging it undoes exactly this upload. Each image becomes a short still clip."
                  : "The staged file is tagged where it lies — nothing is copied first."}
              </span>
            </div>
          )}

          <div className={g.sep} />

          <div className={g.provenance}>
            <div className={g.groupLabel}>Provenance</div>
            <label className={g.field}>
              <span className={g.fieldLabel}>Origin name</span>
              <input className={g.input} value={sourceName}
                     onChange={(e) => setSourceName(e.target.value)}
                     placeholder="uploader, stock site, client, “my camera”" />
            </label>
            {mode !== "url" && (
              <label className={g.field}>
                <span className={g.fieldLabel}>Source link (optional)</span>
                <input className={g.input} value={sourceUrl}
                       onChange={(e) => setSourceUrl(e.target.value)}
                       placeholder="where this file came from" />
                <span className={g.hint}>
                  A YouTube link here also decides the video’s identity, so the
                  same video cannot enter twice — once by hand and once by link.
                </span>
              </label>
            )}
            <div className={g.row}>
              <label className={g.field}>
                <span className={g.fieldLabel}>Licence</span>
                <select className={g.input} value={license}
                        onChange={(e) => setLicense(e.target.value)}>
                  {licences.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </label>
              <label className={g.field}>
                <span className={g.fieldLabel}>Channel</span>
                <input className={g.input} value={channel} list="lib-channels"
                       onChange={(e) => setChannel(e.target.value)}
                       placeholder="creates it if new" />
                <datalist id="lib-channels">
                  {channels.map((c) => <option key={c.id} value={c.name} />)}
                </datalist>
              </label>
            </div>
            <label className={g.field}>
              <span className={g.fieldLabel}>Niches</span>
              <input className={g.input} value={niches}
                     onChange={(e) => setNiches(e.target.value)}
                     placeholder="comma separated" />
            </label>
            <div className={g.warnBox}>
              Licence is recorded per ingest and cannot be inferred later — the
              source video is deleted after tagging. Getting it wrong means every
              clip from this source carries the wrong one.
            </div>
          </div>

          <button className={g.queueBtn} disabled={busy || !canQueue} onClick={queue}>
            Queue ingest
          </button>
        </div>

        <div className={g.queue}>
          <div className={g.queueHead}>
            <span className={g.queueTitle}>Queue</span>
            <span className={g.dim}>
              {running.length} running · {jobs.filter((j) => j.status === "queued").length} queued
              {jobs.some((j) => j.status === "failed") && ` · ${jobs.filter((j) => j.status === "failed").length} failed`}
            </span>
          </div>

          {jobs.length === 0 && <div className={g.queueEmpty}>nothing in the queue</div>}

          {jobs.map((job) => <JobRow key={job.id} job={job} busy={busy} onAction={jobAction} />)}
        </div>
      </div>
    </div>
  );
}

function JobRow({
  job, busy, onAction,
}: {
  job: Job;
  busy: boolean;
  onAction: (id: string, what: "cancel" | "retry") => void;
}) {
  const active = ACTIVE.has(job.status) && job.status !== "queued";
  const failed = job.status === "failed";
  const done = job.status === "done";
  const stageIdx = STAGES.indexOf(job.status as (typeof STAGES)[number]);

  return (
    <div className={`${g.job} ${active ? g.jobActive : failed ? g.jobFailed : ""}`}>
      <div className={g.jobHead}>
        <span className={g.kind}>{job.kind}</span>
        <span className={g.jobTitle} title={job.url ?? job.video_id ?? job.id}>
          {job.url ?? job.video_id ?? job.id}
        </span>
        <span className={`${g.status} ${done ? g.statusDone : failed ? g.statusFailed : active ? g.statusActive : ""}`}>
          {job.status}
        </span>
      </div>

      {active && (
        <>
          <div className={g.stepper}>
            {STAGES.map((st, i) => (
              <span key={st} className={g.step}>
                <span className={`${g.dot} ${i < stageIdx ? g.dotDone : i === stageIdx ? g.dotNow : ""}`} />
                <span className={i === stageIdx ? g.stepNow : g.stepLabel}>{st}</span>
              </span>
            ))}
          </div>
          <div className={g.progressTrack}>
            <div className={g.progressFill} style={{ width: `${Math.round((job.progress ?? 0) * 100)}%` }} />
          </div>
          <div className={g.progressMeta}>{Math.round((job.progress ?? 0) * 100)}% · {job.stage ?? job.status}</div>
        </>
      )}

      {done && job.segments_created !== null && (
        <div className={g.jobDone}>
          {job.segments_created} clips created, all pending review ·{" "}
          <Link href="/library/review" className={g.link}>Review them</Link>
        </div>
      )}

      {job.error && (
        <div className={g.jobError}>
          <strong>{failed ? "Failed" : "Retrying"}</strong>
          <span>{job.error.split("\n")[0].slice(0, 220)}</span>
          {!failed && (
            <span className={g.dim}>
              attempt {job.attempts} · the job went back to the queue on its own —
              an error here does not mean it stopped.
            </span>
          )}
        </div>
      )}

      {(job.status === "queued" || failed) && (
        <div className={g.jobActions}>
          {failed && (
            <button className={g.smallBtn} disabled={busy}
                    onClick={() => onAction(job.id, "retry")}>Retry now</button>
          )}
          <button className={g.smallGhost} disabled={busy}
                  onClick={() => onAction(job.id, "cancel")}>
            {failed ? "Drop job" : "Cancel"}
          </button>
        </div>
      )}
    </div>
  );
}
