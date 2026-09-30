/**
 * Renderer routing (D7): inspect the validated plan and decide ffmpeg vs
 * Remotion. `--renderer ffmpeg` pinned on a plan needing more must FAIL
 * with the list of offending items — capability enforcement, not
 * degradation.
 */
import type { EditPlan, Theme } from "@lusora/contracts";

// whip is absent on purpose: xfade has no flick, only smears (transitions plan, slice 2)
const FFMPEG_TRANSITIONS = new Set([
  "cut", "crossfade", "fade", "fade_to_black", "flash", "zoom_through", "push", "wipe",
]);
const FFMPEG_CAPTION_PRESETS = new Set(["plain"]);

export interface RouteResult {
  renderer: "ffmpeg" | "remotion";
  /** items that force the Remotion path (empty when ffmpeg suffices) */
  reasons: string[];
}

/**
 * `theme` is optional because most callers route a plan alone; given one, a
 * theme that draws film texture (D112 dust or tape) routes the video to
 * Remotion too — ffmpeg would drop it silently.
 */
export function routePlan(plan: EditPlan, theme?: Theme): RouteResult {
  const reasons: string[] = [];

  const texture = theme?.texture;
  if (texture?.dust && texture.dust !== "none") reasons.push(`theme: dust ${texture.dust}`);
  if (texture?.tape && texture.tape !== "none") reasons.push(`theme: tape ${texture.tape}`);

  for (const item of plan.tracks.overlays) {
    if (item.kind === "component") {
      reasons.push(`overlay ${item.id}: catalog component ${item.component}`);
    } else {
      reasons.push(`overlay ${item.id}: media overlay (PiP transform)`);
    }
  }

  for (const item of plan.tracks.visual) {
    const t = item.transition_out?.type;
    if (t && !FFMPEG_TRANSITIONS.has(t)) {
      reasons.push(`visual ${item.id}: transition ${t}`);
    }
    if (item.grade) reasons.push(`visual ${item.id}: ${item.grade} grade`);
    if (item.crt) reasons.push(`visual ${item.id}: CRT set`);
    if (item.speed !== undefined && item.speed !== 1) {
      reasons.push(`visual ${item.id}: speed ${item.speed} (playbackRate is Remotion-only)`);
    }
  }

  const captions = plan.tracks.captions;
  if (captions.enabled && captions.preset && !FFMPEG_CAPTION_PRESETS.has(captions.preset)) {
    reasons.push(`captions: styled preset '${captions.preset}'`);
  }

  return { renderer: reasons.length > 0 ? "remotion" : "ffmpeg", reasons };
}
