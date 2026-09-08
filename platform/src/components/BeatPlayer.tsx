"use client";
/**
 * One beat, as the renderer will draw it.
 *
 * Not a mock-up and not a component in isolation: this mounts the SAME
 * `VideoComposition` the render runs, over the real edit plan, and windows
 * playback to the beat's own span (@remotion/player's inFrame/outFrame). So
 * what plays is the shot with its motion, the transition into it, the burnt-in
 * captions at their compiled height, the overlay, the voiceover, the music bed
 * under its ducking envelope and any cue that fires — because all of that IS
 * the plan, and the plan is what the renderer reads.
 *
 * The whole plan is mounted rather than a slice of it, deliberately: a
 * transition is drawn by the items on BOTH sides of a cut, and a music bed's
 * gain envelope is absolute-time. Cutting the timeline down to one beat would
 * quietly change all three. Remotion only renders the sequences alive at the
 * current frame, so mounting everything costs nothing.
 *
 * The one thing added on top: the overlay the FORM holds. A component picked a
 * moment ago has no compiled item yet, so `lib/beatPreview.ts` places it the
 * way the compiler would and the note below says the timing is provisional
 * until the beat is compiled.
 */
import { Component, useEffect, useMemo, useRef, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { PlayerRef } from "@remotion/player";
import type { Beat, CatalogEntry, EditPlan, Theme } from "@lusora/contracts";
import { beatPreview } from "@/lib/beatPreview";
import { sampleProps } from "@/lib/overlaySamples";
import s from "./BeatPlayer.module.css";

const PlanPreview = dynamic(() => import("./PlanPreview"), { ssr: false });

const fmt = (sec: number) => {
  const m = Math.floor(sec / 60);
  const r = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
};

/** A preview that throws must not take the beat form down with it. */
class PreviewBoundary extends Component<{ children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { err: e instanceof Error ? e.message : String(e) };
  }
  render() {
    if (this.state.err === null) return this.props.children;
    return (
      <div className={s.blank}>
        <strong>Preview unavailable</strong>
        <span>{this.state.err}</span>
        <span className={s.dim}>The beat form still works.</span>
      </div>
    );
  }
}

export default function BeatPlayer({
  videoId,
  beat,
  plan,
  entry,
  theme,
  transitions,
}: {
  videoId: string;
  beat: Beat;
  /** The compiled plan. Null before the compile stage has run. */
  plan: EditPlan | null;
  /** Catalog entry for the overlay on the beat, when it has one. */
  entry: CatalogEntry | null;
  /** The video's frozen theme — what the composition draws with. */
  theme: Theme | null;
  /** The pack's own hand-off settings (D89): the beat picks only the kind. */
  transitions?: { default?: string; duration_s?: number };
}) {
  const control = useRef<PlayerRef | null>(null);
  const preview = useMemo(
    () =>
      plan
        ? beatPreview(plan, beat, entry, {
            fallback: entry ? sampleProps(entry) : {},
            transitionSeconds: transitions?.duration_s,
            defaultTransition: transitions?.default as "cut" | undefined,
          })
        : null,
    [plan, beat, entry, transitions?.duration_s, transitions?.default]
  );

  // Where the beat says the most: on its overlay, once the entrance has
  // settled. `initialFrame` covers arriving at a beat; this covers picking a
  // different component while standing on one, which leaves the player parked
  // on a frame the new overlay is not on yet.
  const overlayItem = preview?.plan.tracks.overlays.find((o) => o.beat_id === beat.id);
  const window0 = preview?.window ?? null;
  const openAt =
    overlayItem &&
    window0 &&
    overlayItem.start_s >= window0.start_s &&
    overlayItem.start_s < window0.end_s
      ? Math.min(
          overlayItem.start_s + Math.min(1, (overlayItem.end_s - overlayItem.start_s) * 0.5),
          window0.end_s - 0.05
        )
      : window0
      // No overlay to open on, so open just INSIDE the beat. Frame 0 of the
      // window is the junction itself, where the outgoing shot is still on
      // screen for the length of its transition — even a cut appends a tenth
      // of a second — so parking there shows the PREVIOUS beat's last frame.
      ? window0.start_s + Math.min(0.4, (window0.end_s - window0.start_s) * 0.25)
      : null;
  const fps = plan?.fps ?? 30;
  useEffect(() => {
    if (openAt === null || !window0) return;
    // the player's timeline starts at the beat, so the seek is relative to it
    control.current?.seekTo(Math.max(Math.round((openAt - window0.start_s) * fps), 0));
    // the component is part of the identity on purpose: picking another one is
    // exactly when the playhead has to move
  }, [beat.id, beat.overlay?.component, openAt, fps, window0]);

  if (!plan || !preview) {
    return (
      <div className={s.blank}>
        <strong>Nothing to play yet</strong>
        <span>The compile stage has not written an edit plan for this video.</span>
      </div>
    );
  }
  if (!preview.window) {
    return (
      <div className={s.blank}>
        <strong>This beat is not in the plan</strong>
        <span>No visual item carries its id, so the render has nothing to draw for it.</span>
      </div>
    );
  }

  const { window, playWindow, transition, transitionDraft, overlayDraft, timingDraft, props } =
    preview;
  const span = window.end_s - window.start_s;
  const item = plan.tracks.visual.find((v) => v.beat_id === beat.id);
  const captions = (plan.tracks.captions?.items ?? []).filter(
    (c) => c.end_s > window.start_s && c.start_s < window.end_s
  );
  const cuesInSpan = (plan.tracks.audio.sfx ?? []).filter(
    (c) => c.start_s < window.end_s && c.end_s > window.start_s
  );
  const musicUnder = (plan.tracks.audio.music ?? []).some(
    (m) => m.start_s < window.end_s && (m.end_s ?? Infinity) > window.start_s
  );

  return (
    <div className={s.player}>
      <div className={s.frame}>
        <PreviewBoundary key={beat.id}>
          <PlanPreview
            videoId={videoId}
            plan={preview.plan}
            theme={theme}
            window={playWindow ?? window}
            openAt={openAt}
            controlRef={control}
            loop
          />
        </PreviewBoundary>
      </div>

      <div className={s.meta}>
        <span className={s.mono}>
          {fmt(window.start_s)} – {fmt(window.end_s)} · {span.toFixed(1)}s
        </span>
        <span>
          {plan.tracks.captions?.enabled
            ? `${captions.length} caption${captions.length === 1 ? "" : "s"}`
            : "captions off"}
        </span>
        <span>{beat.overlay ? `overlay · ${beat.overlay.component}` : "no overlay"}</span>
        <span>
          {transition && transition.type !== "cut"
            ? `hands over · ${transition.type.replace(/_/g, " ")}`
            : "hands over · cut"}
        </span>
        <span>
          {musicUnder ? "music under" : "no bed"}
          {cuesInSpan.length ? ` · ${cuesInSpan.length} cue${cuesInSpan.length === 1 ? "" : "s"}` : ""}
        </span>
        {item?.asset?.path ? (
          <span>{item.asset.source}{item.asset.provider ? ` · ${item.asset.provider}` : ""}</span>
        ) : (
          <span className={s.warn}>no asset resolved</span>
        )}
      </div>

      {overlayDraft && beat.overlay && (
        <div className={s.note}>
          {timingDraft
            ? "Showing the overlay as the form has it, placed 0.4s into the beat for the catalogue's own hold — the compile can bring it later, onto the moment the narration says its subject."
            : "Showing the overlay as the form has it, on the timing the compile already gave it."}
          {props?.fromAnchor.length
            ? ` ${props.fromAnchor.join(", ")} filled from the beat's anchor.`
            : ""}
          {props?.standIns.length
            ? ` ${props.standIns.join(", ")} — stand-in value${props.standIns.length > 1 ? "s" : ""} until the compile supplies the real one.`
            : ""}
          {timingDraft ? " Its entrance cue is added at compile, so this plays silent." : ""}
        </div>
      )}
      {overlayDraft && !beat.overlay && (
        <div className={s.note}>
          The compiled overlay is gone from this preview because the form has none on this beat.
        </div>
      )}
      {transition && transition.type !== "cut" && (
        <div className={s.note}>
          Playing {transition.duration_s?.toFixed(2)}s past the cut, because a transition is drawn
          in the handle AFTER it — stopping at the beat&apos;s end would stop just before the
          hand-off.
          {transitionDraft ? " Shown as the form has it; the compile places it the same way." : ""}
        </div>
      )}
      {props?.problem && <div className={s.warn}>{props.problem}</div>}
    </div>
  );
}
