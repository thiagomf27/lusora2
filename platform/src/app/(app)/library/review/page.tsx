"use client";
/**
 * Review — the gate every clip passes before the worker can see it (D75).
 *
 * Nothing enters the library unreviewed: an ingest writes `status='pending'`,
 * which is stored but invisible to search, so a mis-tagged or multi-shot clip
 * caught here costs a click and caught in a rendered video costs a re-run.
 *
 * Two things about the ORDER of operations here are load-bearing, and both are
 * the library's design rather than this screen's:
 *  - dedup runs at APPROVAL, not at ingest, so it compares the caption the
 *    reviewer settled on rather than the model's first guess. Fix the words
 *    BEFORE approving and the duplicate check gets the better text.
 *  - a pending clip still owns its bytes, which is what makes it playable and
 *    trimmable here instead of arriving as a dead card.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ClipCard, ClipEditor } from "@/components/library/ClipCard";
import { libGet, libSend, fmtDuration, type Segment } from "@/components/library/types";
import s from "../library.module.css";

export default function ReviewPage() {
  const [rows, setRows] = useState<Segment[] | null>(null);
  const [licenses, setLicenses] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [trimming, setTrimming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await libGet<Segment[]>("segments", { status: "pending", limit: 200 }));
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : "could not reach the library");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    libGet<{ known: string[] }>("licenses").then((l) => setLicenses(l.known)).catch(() => {});
  }, []);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function act(what: "approve" | "reject") {
    const ids = [...picked];
    if (!ids.length) return;
    if (what === "reject" && !confirm(
      `Reject ${ids.length} clip${ids.length === 1 ? "" : "s"}?\n\n` +
      "This deletes them and their bytes. The source video was deleted after " +
      "tagging, so recovery means re-ingesting it."
    )) return;
    setBusy(true);
    try {
      if (what === "approve") {
        const res = await libSend<{ approved: number; duplicates: number }>(
          "POST", "segments/approve", { ids });
        setNotice(
          `approved ${res.approved}` +
          (res.duplicates ? ` · ${res.duplicates} linked as duplicates of clips already in the library` : "")
        );
      } else {
        await libSend("DELETE", `segments?${ids.map((i) => `ids=${encodeURIComponent(i)}`).join("&")}`);
        setNotice(`rejected ${ids.length}`);
      }
      setPicked(new Set());
      setEditing(null);
      setTrimming(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : `${what} failed`);
    } finally {
      setBusy(false);
    }
  }

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

  const target = rows?.find((r) => r.id === trimming) ?? null;

  return (
    <div className="page">
      <div className="pageHead">
        <div>
          <h1 className="pageTitle">Review</h1>
          <div className="pageSub">
            Clips the tagger just cut. Nothing reaches search — or the worker — until it is approved.
          </div>
        </div>
        <Link className={s.reviewCta} href="/library">← Library</Link>
      </div>

      {error && <div className={s.error}>{error}</div>}
      {notice && <div className={s.notice}>{notice}</div>}

      {rows !== null && rows.length > 0 && (
        <div className={s.bulkBar}>
          <label className={s.bulkAll}>
            <input
              type="checkbox"
              checked={picked.size === rows.length && rows.length > 0}
              onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
            />
            {picked.size ? `${picked.size} selected` : `select all ${rows.length}`}
          </label>
          <div className={s.bulkActions}>
            <button className={s.primaryBtn} disabled={busy || !picked.size} onClick={() => act("approve")}>
              Approve
            </button>
            <button className={s.dangerBtn} disabled={busy || !picked.size} onClick={() => act("reject")}>
              Reject
            </button>
          </div>
        </div>
      )}

      {target && (
        <TrimWorkbench
          seg={target}
          busy={busy}
          onClose={() => setTrimming(null)}
          onDone={async (msg) => { setNotice(msg); setTrimming(null); await load(); }}
          onError={setError}
          setBusy={setBusy}
        />
      )}

      {rows === null ? (
        <div className={s.empty}>loading…</div>
      ) : rows.length === 0 ? (
        <div className={s.empty}>nothing waiting — every ingested clip has been reviewed</div>
      ) : (
        <div className={s.grid}>
          {rows.map((seg) => (
            <div key={seg.id} className={picked.has(seg.id) ? s.pickedCard : undefined}>
              <ClipCard seg={seg} playable>
                <label className={s.pick}>
                  <input type="checkbox" checked={picked.has(seg.id)} onChange={() => toggle(seg.id)} />
                  keep
                </label>
                <button className={s.cardBtn} onClick={() => setEditing(editing === seg.id ? null : seg.id)}>
                  {editing === seg.id ? "Close" : "Edit"}
                </button>
                <button className={s.cardBtn} onClick={() => setTrimming(seg.id)}>Trim</button>
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

/**
 * The fast cut, as a workbench rather than a control on the card.
 *
 * Finding the frame a bad edge ends on means scrubbing, and a player one third
 * of a column wide cannot be scrubbed accurately — so the clip gets a wide
 * player and the bounds sit beside it. The cut is irreversible: it re-encodes
 * the clip file in place (always, ignoring BROLL_CUT_MODE, because a stream
 * copy seeks to the keyframe at or before the start and a short clip often has
 * exactly one, at t=0 — so a copy-mode head trim writes a file that still
 * opens on the frames being removed).
 */
function TrimWorkbench({
  seg, busy, onClose, onDone, onError, setBusy,
}: {
  seg: Segment;
  busy: boolean;
  onClose: () => void;
  onDone: (msg: string) => Promise<void>;
  onError: (e: string) => void;
  setBusy: (b: boolean) => void;
}) {
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(seg.duration);
  useEffect(() => { setStart(0); setEnd(seg.duration); }, [seg.id, seg.duration]);

  const result = Math.max(end - start, 0);
  // The library refuses a cut that would leave less than BROLL_MIN_CLIP_S. It
  // is env-configurable there, so this only mirrors the default: the server is
  // still the one that decides, and says so in its 422.
  const tooShort = result < 4;

  async function apply() {
    setBusy(true);
    try {
      await libSend("POST", `segments/${seg.id}/trim`, { start, end });
      await onDone(`trimmed to ${result.toFixed(2)}s`);
    } catch (e) {
      onError(e instanceof Error ? e.message : "trim failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.workbench}>
      <video className={s.wbPlayer} src={`/api/library/clips/${seg.id}`} controls autoPlay muted />
      <div className={s.wbSide}>
        <div className={s.wbTitle}>{seg.caption || "no caption"}</div>
        <div className={s.wbMeta}>
          {fmtDuration(seg.duration)} · {seg.start.toFixed(1)}s–{seg.end.toFixed(1)}s of its source
        </div>
        <label className={s.wbField}>
          <span>keep from</span>
          <input
            type="number" step="0.05" min={0} max={seg.duration}
            value={start} onChange={(e) => setStart(Number(e.target.value))}
          />
        </label>
        <label className={s.wbField}>
          <span>keep until</span>
          <input
            type="number" step="0.05" min={0} max={seg.duration}
            value={end} onChange={(e) => setEnd(Number(e.target.value))}
          />
        </label>
        <div className={tooShort ? s.wbWarn : s.wbMeta}>
          result {result.toFixed(2)}s{tooShort ? " — under the library's minimum clip length" : ""}
        </div>
        <div className={s.wbActions}>
          <button className={s.primaryBtn} disabled={busy || tooShort} onClick={apply}>Apply cut</button>
          <button className={s.ghostBtn} disabled={busy} onClick={onClose}>Cancel</button>
        </div>
        <div className={s.hint}>Irreversible: it rewrites the clip file in place.</div>
      </div>
    </div>
  );
}
