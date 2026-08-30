"use client";
/**
 * Review — the gate every clip passes before the worker can see it (D75).
 *
 * A culling screen. Someone works through dozens of clips deciding keep or
 * drop, so it is keyboard-first: J/K move, Space plays, E edits, A approves,
 * X rejects, T trims. Reaching for the mouse once per clip is the cost.
 *
 * Two things about the ORDER of operations are the library's design, not this
 * screen's, and the UI is built to make them obvious:
 *  - dedup runs at APPROVAL, comparing the caption the reviewer settled on
 *    rather than the model's first guess, so a clip still carrying the model's
 *    words is flagged BEFORE it is approved (`caption_edited`)
 *  - a pending clip still owns its bytes, which is what makes it playable and
 *    trimmable here instead of arriving as a dead card
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ClipCard } from "@/components/library/ClipCard";
import { ClipEditor } from "@/components/library/ClipEditor";
import { ConfirmDelete, SkeletonGrid } from "@/components/library/States";
import { TrimWorkbench } from "@/components/library/TrimWorkbench";
import {
  fmtAge, libGet, libList, libSend,
  type Segment, type SourceVideo,
} from "@/components/library/types";
import s from "../library.module.css";

const KEYS: [string, string][] = [
  ["J / K", "move"], ["Space", "play"], ["E", "edit caption"],
  ["A", "approve"], ["X", "reject"], ["T", "trim"],
];

export default function ReviewPage() {
  const [rows, setRows] = useState<Segment[] | null>(null);
  const [videos, setVideos] = useState<SourceVideo[]>([]);
  const [licences, setLicences] = useState<string[]>([]);
  const [video, setVideo] = useState("");
  const [sort, setSort] = useState("confidence");

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [trimming, setTrimming] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string[] | null>(null);
  const [justApproved, setJustApproved] = useState<Segment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const got = await libList("segments", {
        status: "pending", limit: 200, sort, video_id: video || undefined,
      });
      setRows(got.rows);
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : "could not reach the library");
    }
  }, [sort, video]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    libGet<SourceVideo[]>("videos").then((v) => setVideos(v.filter((x) => x.pending > 0))).catch(() => {});
    libGet<{ known: string[] }>("licenses").then((l) => setLicences(l.known)).catch(() => {});
  }, [rows]);

  const oldest = useMemo(
    () => (rows?.length ? Math.min(...rows.map((r) => r.created_at)) : null),
    [rows],
  );
  const unedited = useMemo(
    () => [...picked].filter((id) => rows?.find((r) => r.id === id && !r.caption_edited)).length,
    [picked, rows],
  );

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const act = useCallback(async (what: "approve" | "reject", ids: string[]) => {
    if (!ids.length) return;
    setBusy(true);
    try {
      if (what === "approve") {
        const keep = rows?.filter((r) => ids.includes(r.id)) ?? [];
        const res = await libSend<{ approved: number; duplicates: number }>(
          "POST", "segments/approve", { ids });
        setNotice(
          `approved ${res.approved}` +
          (res.duplicates
            ? ` · ${res.duplicates} linked as duplicate${res.duplicates === 1 ? "" : "s"} of clips already in the library`
            : ""));
        // Approval is a status flip and destroys nothing, so it is the one
        // action here that can honestly offer an undo.
        setJustApproved(keep);
      } else {
        await libSend("DELETE", `segments?${ids.map((i) => `ids=${encodeURIComponent(i)}`).join("&")}`);
        setNotice(`rejected ${ids.length}`);
        setJustApproved([]);
      }
      setPicked(new Set());
      setEditing(null); setTrimming(null); setConfirming(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : `${what} failed`);
    } finally { setBusy(false); }
  }, [rows, load]);

  async function undoApprove() {
    const ids = justApproved.map((r) => r.id);
    setBusy(true);
    try {
      const res = await libSend<{ pending: number; skipped_duplicates: string[] }>(
        "POST", "segments/unapprove", { ids });
      setNotice(
        `${res.pending} back in review` +
        (res.skipped_duplicates.length
          ? ` · ${res.skipped_duplicates.length} stayed: a clip that deduped on approval has no bytes to review`
          : ""));
      setJustApproved([]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "undo failed");
    } finally { setBusy(false); }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(true);
    try {
      await libSend("PATCH", `segments/${id}`, body);
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally { setBusy(false); }
  }

  // Keyboard culling. Suspended while a text field has focus or a modal is
  // open — typing a caption must not approve the clip behind it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (editing || trimming || confirming || !rows?.length) return;
      const cur = rows[Math.min(cursor, rows.length - 1)];
      if (!cur) return;
      const move = (d: number) => {
        const next = Math.max(0, Math.min(rows.length - 1, cursor + d));
        setCursor(next);
        cardRefs.current[rows[next].id]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      };
      switch (e.key.toLowerCase()) {
        case "j": e.preventDefault(); move(1); break;
        case "k": e.preventDefault(); move(-1); break;
        case " ": {
          e.preventDefault();
          const v = cardRefs.current[cur.id]?.querySelector("video");
          if (v) v.paused ? void v.play() : v.pause();
          break;
        }
        case "e": e.preventDefault(); setEditing(cur.id); break;
        case "a": e.preventDefault(); void act("approve", [cur.id]); break;
        case "x": e.preventDefault(); setConfirming([cur.id]); break;
        case "t": e.preventDefault(); setTrimming(cur.id); break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, cursor, editing, trimming, confirming, act]);

  const target = rows?.find((r) => r.id === trimming) ?? null;

  return (
    <div className="page">
      <div className="pageHead">
        <div>
          <h1 className="pageTitle">Review</h1>
          <div className="pageSub">
            {rows === null ? "loading…" : rows.length === 0
              ? "nothing waiting — every ingested clip has been reviewed"
              : `${rows.length} pending across ${videos.length} source${videos.length === 1 ? "" : "s"}` +
                (oldest ? ` · oldest waiting ${fmtAge(oldest)}` : "") +
                " · nothing here is searchable yet"}
          </div>
        </div>
        <div className={s.headActions}>
          <select className={s.sortSelect} value={video} onChange={(e) => setVideo(e.target.value)}>
            <option value="">All sources</option>
            {videos.map((v) => (
              <option key={v.video_id} value={v.video_id}>
                {v.source_name ?? v.video_id} ({v.pending})
              </option>
            ))}
          </select>
          <select className={s.sortSelect} value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="confidence">Confidence: low first</option>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="duration">Longest first</option>
          </select>
          <Link className={s.outlineBtn} href="/library">Library</Link>
        </div>
      </div>

      {error && <div className={s.error}>{error}</div>}
      {notice && (
        <div className={s.notice}>
          {notice}
          {justApproved.length > 0 && (
            <button className={s.undoLink} disabled={busy} onClick={undoApprove}>Undo</button>
          )}
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <>
          <div className={s.bulkBarTop}>
            <label className={s.bulkAll}>
              <input type="checkbox"
                     checked={picked.size === rows.length}
                     onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} />
              {picked.size ? `${picked.size} of ${rows.length} selected` : `Select all ${rows.length}`}
            </label>
            <button className={s.link}
                    onClick={() => setPicked(new Set(rows.filter((r) => !r.caption_edited).map((r) => r.id)))}>
              Select untouched captions
            </button>
            <div className={s.bulkActions}>
              {unedited > 0 && (
                <span className={s.uneditedWarn}>
                  {unedited} still {unedited === 1 ? "has" : "have"} the model’s original caption
                </span>
              )}
              <button className={s.outlineBtn} disabled={busy || !picked.size}
                      onClick={() => setConfirming([...picked])}>Reject {picked.size || ""}</button>
              <button className={s.primaryBtn} disabled={busy || !picked.size}
                      onClick={() => act("approve", [...picked])}>Approve {picked.size || ""}</button>
            </div>
          </div>

          <div className={s.keyHints}>
            {KEYS.map(([k, what]) => (
              <span key={k} className={s.keyHint}><kbd className={s.kbd}>{k}</kbd> {what}</span>
            ))}
            <span className={s.keyNote}>Approving runs duplicate detection on the caption as it stands.</span>
          </div>
        </>
      )}

      {target && (
        <TrimWorkbench
          seg={target} busy={busy} setBusy={setBusy}
          onClose={() => setTrimming(null)}
          onDone={async (msg) => { setNotice(msg); setTrimming(null); await load(); }}
          onError={setError}
        />
      )}

      {rows === null ? (
        <SkeletonGrid count={6} />
      ) : rows.length === 0 ? null : (
        <div className={s.grid}>
          {rows.map((seg, i) => (
            <div key={seg.id} ref={(el) => { cardRefs.current[seg.id] = el; }}
                 className={i === cursor ? s.cursorCard : undefined}
                 onClick={() => setCursor(i)}>
              <ClipCard
                seg={seg} playable
                selected={picked.has(seg.id)}
                onSelect={() => toggle(seg.id)}
                badge={
                  <span className={seg.caption_edited ? s.editedBadge : s.originalBadge}>
                    {seg.caption_edited ? "edited" : "model’s original"}
                  </span>
                }
                note={
                  !seg.caption_edited && seg.confidence < 0.55 ? (
                    <div className={s.lowConf}>
                      Low confidence ({seg.confidence.toFixed(2)}) and nobody has
                      touched the caption. Rewrite it before approving — search
                      and duplicate detection both use these words.
                    </div>
                  ) : null
                }
              >
                <button className={s.primarySm} disabled={busy}
                        onClick={() => act("approve", [seg.id])}>Approve</button>
                <button className={s.cardBtn} onClick={() => setEditing(seg.id)}>Edit</button>
                <button className={s.cardBtn} onClick={() => setTrimming(seg.id)}>Trim</button>
                <button className={s.cardDanger} onClick={() => setConfirming([seg.id])}>Reject</button>
              </ClipCard>
              {editing === seg.id && (
                <ClipEditor
                  caption={seg.caption} tags={seg.tags} license={seg.license}
                  sourceName={seg.source_name} licenses={licences}
                  busy={busy} autoFocus compact
                  onCancel={() => setEditing(null)}
                  onSave={(body) => patch(seg.id, body)}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {confirming && (
        <ConfirmDelete count={confirming.length} busy={busy}
                       onConfirm={() => act("reject", confirming)}
                       onCancel={() => setConfirming(null)} />
      )}
    </div>
  );
}
