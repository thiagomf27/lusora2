/**
 * Renderer routing (D7): inspect the validated plan and decide ffmpeg vs
 * Remotion. `--renderer ffmpeg` pinned on a plan needing more must FAIL
 * with the list of offending items — capability enforcement, not
 * degradation.
 */
import type { EditPlan } from "@lusora/contracts";

const FFMPEG_TRANSITIONS = new Set(["cut", "crossfade", "fade", "fade_to_black"]);
const FFMPEG_CAPTION_PRESETS = new Set(["plain"]);

export interface RouteResult {
  renderer: "ffmpeg" | "remotion";
  /** items that force the Remotion path (empty when ffmpeg suffices) */
  reasons: string[];
}

export function routePlan(plan: EditPlan): RouteResult {
  const reasons: string[] = [];

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
  }

  const captions = plan.tracks.captions;
  if (captions.enabled && captions.preset && !FFMPEG_CAPTION_PRESETS.has(captions.preset)) {
    reasons.push(`captions: styled preset '${captions.preset}'`);
  }

  return { renderer: reasons.length > 0 ? "remotion" : "ffmpeg", reasons };
}
