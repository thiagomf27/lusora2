"use client";
/**
 * The fast cut, as a workbench rather than a control on a card.
 *
 * Finding the frame a bad edge ends on means scrubbing, and a player one third
 * of a column wide cannot be scrubbed accurately — so the clip gets a wide
 * player and the bounds sit beside it. Frame stepping and 0.25x come off the
 * <video> element, which is also why there is no filmstrip: frame thumbnails
 * along the scrubber would need rendering the API does not do, and the player
 * alone is what makes this accurate.
 *
 * The cut is irreversible. It re-encodes the clip file in place — always,
 * ignoring BROLL_CUT_MODE, because a stream copy seeks to the keyframe at or
 * before the start and a short clip often has exactly one, at t=0, so a
 * copy-mode head trim writes a file that still opens on the frames being
 * removed.
 */
import { useEffect, useRef, useState } from "react";
import { fmtPrecise, libSend, type Segment } from "./types";
import s from "./trim.module.css";

/** One frame at 30fps. The library refuses a result under BROLL_MIN_CLIP_S
 *  (4s by default, env-configurable), so the server is still what decides —
 *  this only says so first. */
const STEP = 1 / 30;
const MIN_HINT = 4;

export function TrimWorkbench({
  seg, busy, setBusy, onClose, onDone, onError,
}: {
  seg: Segment;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onClose: () => void;
  onDone: (msg: string) => Promise<void>;
  onError: (e: string) => void;
}) {
  const video = useRef<HTMLVideoElement | null>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(seg.duration);
  const [at, setAt] = useState(0);
  const [slow, setSlow] = useState(false);
  const [ack, setAck] = useState(false);

  useEffect(() => {
    setStart(0); setEnd(seg.duration); setAck(false);
  }, [seg.id, seg.duration]);

  const result = Math.max(end - start, 0);
  const tooShort = result < MIN_HINT;
  const removed = seg.duration - result;

  function seek(t: number) {
    const v = video.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(seg.duration, t));
  }

  async function apply() {
    setBusy(true);
    try {
      await libSend("POST", `segments/${seg.id}/trim`, { start, end });
      await onDone(`trimmed to ${result.toFixed(2)}s`);
    } catch (e) {
      onError(e instanceof Error ? e.message : "trim failed");
    } finally { setBusy(false); }
  }

  return (
    <div className={s.wrap}>
      <div className={s.head}>
        <button className={s.back} onClick={onClose}>← Back to review</button>
        <span className={s.dim}>·</span>
        <span className={s.headMeta}>
          {seg.id.slice(0, 8)} · from {seg.source_name ?? seg.video_id}
        </span>
        <span className={s.headNote}>Trim rewrites the clip file in place</span>
      </div>

      <div className={s.cols}>
        <div className={s.main}>
          <video
            ref={video}
            className={s.player}
            src={`/api/library/clips/${seg.id}`}
            controls autoPlay muted
            onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
          />

          <div className={s.panel}>
            <div className={s.transport}>
              <span className={s.clock}>{fmtPrecise(at)}</span>
              <span className={s.dim}>of {fmtPrecise(seg.duration)}</span>
              <div className={s.transportBtns}>
                <button className={s.chip} onClick={() => seek(at - STEP)}>◀ frame</button>
                <button className={s.chip} onClick={() => seek(at + STEP)}>frame ▶</button>
                <button className={`${s.chip} ${slow ? s.chipOn : ""}`}
                        onClick={() => {
                          const next = !slow;
                          setSlow(next);
                          if (video.current) video.current.playbackRate = next ? 0.25 : 1;
                        }}>0.25×</button>
              </div>
            </div>

            {/* The scrub bar: what is kept, what is cut, and where you are. */}
            <div className={s.track} onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              seek(((e.clientX - r.left) / r.width) * seg.duration);
            }}>
              <div className={s.cut} style={{ left: 0, width: `${(start / seg.duration) * 100}%` }} />
              <div className={s.cut} style={{ right: 0, width: `${((seg.duration - end) / seg.duration) * 100}%` }} />
              <div className={s.keep} style={{
                left: `${(start / seg.duration) * 100}%`,
                right: `${((seg.duration - end) / seg.duration) * 100}%`,
              }} />
              <div className={s.playhead} style={{ left: `${(at / seg.duration) * 100}%` }} />
            </div>

            <div className={s.points}>
              <label className={s.point}>
                <span className={s.pointLabel}>In</span>
                <input type="number" step="0.05" min={0} max={seg.duration} value={start}
                       onChange={(e) => setStart(Number(e.target.value))} />
              </label>
              <button className={s.chip} onClick={() => setStart(Number(at.toFixed(2)))}>set in ⟨I⟩</button>
              <label className={s.point}>
                <span className={s.pointLabel}>Out</span>
                <input type="number" step="0.05" min={0} max={seg.duration} value={end}
                       onChange={(e) => setEnd(Number(e.target.value))} />
              </label>
              <button className={s.chip} onClick={() => setEnd(Number(at.toFixed(2)))}>set out ⟨O⟩</button>
              <label className={s.point}>
                <span className={s.pointLabel}>Result</span>
                <span className={tooShort ? s.resultBad : s.resultGood}>{result.toFixed(2)} s</span>
              </label>
            </div>
            <div className={tooShort ? s.warn : s.dim}>
              {tooShort
                ? `Under the library's minimum clip length (${MIN_HINT}s) — a trim this short is refused.`
                : `Trimming ${removed.toFixed(2)} s off this clip.`}
            </div>
          </div>

          <div className={s.danger}>
            <div className={s.dangerTitle}>Applying overwrites the clip file</div>
            <p className={s.dangerBody}>
              The trimmed frames are gone for good. The source video was deleted
              after tagging, so the only way back is re-ingesting the source from
              scratch.
            </p>
            <label className={s.ack}>
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              I understand this cannot be undone
            </label>
            <div className={s.dangerActions}>
              <button className={s.applyBtn} disabled={busy || tooShort || !ack} onClick={apply}>
                Apply trim — {result.toFixed(2)} s
              </button>
              <button className={s.outline} onClick={() => { setStart(0); setEnd(seg.duration); }}>
                Reset points
              </button>
              <button className={s.ghost} onClick={onClose}>Cancel</button>
            </div>
          </div>
        </div>

        <aside className={s.side}>
          <div className={s.sideLabel}>Clip</div>
          <div className={s.sideCaption}>{seg.caption || "no caption"}</div>
          <div className={s.sideTags}>
            {seg.tags.map((t) => <span key={t} className={s.tag}>{t}</span>)}
          </div>
          <div className={s.sep} />
          <dl className={s.facts}>
            <div><dt>Status</dt><dd><span className={s.statusPill}>{seg.status}</span></dd></div>
            <div><dt>Licence</dt><dd>{seg.license}</dd></div>
            <div><dt>Origin</dt><dd>{seg.source_name ?? "—"}</dd></div>
            <div><dt>Position</dt><dd className={s.mono}>{seg.start.toFixed(1)}s → {seg.end.toFixed(1)}s</dd></div>
            <div><dt>Confidence</dt><dd className={s.mono}>{seg.confidence.toFixed(2)}</dd></div>
            <div><dt>Used in</dt><dd className={s.mono}>{seg.usage_count} videos</dd></div>
          </dl>
          <div className={s.sep} />
          <p className={s.sideNote}>
            Trimming does not approve. After applying you land back on this clip
            in review, caption intact.
          </p>
          {seg.usage_count > 0 && (
            <p className={s.sideWarn}>
              This clip is already used in {seg.usage_count} video
              {seg.usage_count === 1 ? "" : "s"}. Cutting it changes the footage
              those videos drew from.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
