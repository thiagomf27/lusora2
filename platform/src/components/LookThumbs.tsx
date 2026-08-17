"use client";
/**
 * The small examples on the transition, SFX and music rows.
 *
 * A transition is drawn rather than described: `cut`, `crossfade`, `fade` and
 * `fade_to_black` are four words that mean very little until you see which one
 * dips through black. The animation mirrors what the renderer actually does
 * (`engine/src/renderers/remotion/transitions.tsx`) — including the fact that
 * `crossfade` and `fade` are the SAME dissolve today, which the labels say out
 * loud rather than leaving someone to discover it in a render.
 *
 * A sound is played rather than drawn, from the pack the channel resolved, so
 * "somber-01" stops being a name and becomes a thing you either want or don't.
 */
import { useEffect, useRef, useState } from "react";
import s from "./LookThumbs.module.css";

export type TransitionKind = "cut" | "crossfade" | "fade" | "fade_to_black";

const KIND_CLASS: Record<TransitionKind, string> = {
  cut: s.cut,
  crossfade: s.dissolve,
  fade: s.dissolve,
  fade_to_black: s.dip,
};

/** Two shots and the join between them, looping. */
export function TransitionThumb({ kind }: { kind: string }) {
  const cls = KIND_CLASS[kind as TransitionKind] ?? s.cut;
  return (
    <span className={`${s.tBox} ${cls}`} aria-hidden="true">
      <span className={s.tA}>A</span>
      <span className={s.tB}>B</span>
      {kind === "fade_to_black" && <span className={s.tVeil} />}
    </span>
  );
}

/**
 * Play one cue or bed. One <audio> per card, created on first play — forty of
 * them preloaded would fetch every file in the pack to draw a screen nobody has
 * clicked yet.
 */
export function SoundThumb({
  url,
  name,
  label,
}: {
  url: string | null;
  name: string | null;
  label: string;
}) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => () => { audio.current?.pause(); }, []);

  function toggle() {
    if (!url) return;
    if (!audio.current) {
      audio.current = new Audio(url);
      // Previewed under narration in real life; at 1.0 every cue sounds louder
      // here than it will in the mix.
      audio.current.volume = 0.7;
      audio.current.addEventListener("ended", () => setPlaying(false));
    }
    if (playing) {
      audio.current.pause();
      audio.current.currentTime = 0;
      setPlaying(false);
      return;
    }
    audio.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }

  if (!name) {
    return (
      <span className={`${s.sBox} ${s.sEmpty}`}>
        <span className={s.sNote}>no {label}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`${s.sBox}${playing ? " " + s.on : ""}`}
      disabled={!url}
      title={url ? `Play ${name}` : `${name} is not in the sound pack`}
      onClick={toggle}
    >
      <span className={s.sIcon}>
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <rect x="4" y="3" width="3" height="10" rx="1" />
            <rect x="9" y="3" width="3" height="10" rx="1" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M5 3.2l7 4.8-7 4.8z" />
          </svg>
        )}
      </span>
      <span className={s.sName}>{name}</span>
      {!url && <span className={s.sNote}>missing file</span>}
    </button>
  );
}
