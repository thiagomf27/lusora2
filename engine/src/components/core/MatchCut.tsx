/**
 * MatchCut — D111, the hook's match cut (Dark Palace's `matchcut`): real
 * photos of one KIND of place flash one after another, each scaled and offset
 * so its main subject lands on the same point of the frame at the same height.
 * The eye stays on one spot while the world changes under it.
 *
 * The photos and each subject's centre (ax, ay) and height (th) — fractions
 * of that photo's own width and height — are computed by the hook_plan stage
 * (a vision judge marks them), never written by a planner: the catalog entry
 * is `compiler_only`.
 *
 * Placement is DP's arithmetic, per photo: the scale that brings the subject
 * to `SUBJECT_H` of the frame, at least a cover scale, never so small that an
 * edge shows past the anchor point, never blown past 2.6x cover (soft); then
 * the offset that puts (ax, ay) on the target point, clamped inside the frame.
 */
import { z } from "zod";
import { Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";

const photoSchema = z.object({
  /** path under the video folder (the renderer's public dir) */
  src: z.string().max(160),
  w: z.number().positive(),
  h: z.number().positive(),
  ax: z.number().min(0).max(1),
  ay: z.number().min(0).max(1),
  th: z.number().min(0.05).max(1).default(0.35),
});

export const MatchCutProps = z.object({
  photos: z.array(photoSchema).max(16).default([]),
  step_s: z.number().min(0.06).max(0.5).default(0.14),
  hold_s: z.number().min(0).max(3).default(0.7),
  /** the words it lands on: read by the compiler to time it, never drawn */
  says: z.string().max(40).optional(),
});
export type MatchCutProps = z.infer<typeof MatchCutProps>;

const TARGET_X = 0.5;
const TARGET_Y = 0.5;
const SUBJECT_H = 0.46;

export function MatchCut({ props }: { props: MatchCutProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  // props arrive as the plan holds them; a hand-written plan may omit the defaults
  const photos = props.photos ?? [];
  if (photos.length === 0) return null;
  const step = Math.max(1, Math.round((props.step_s ?? 0.14) * fps));
  const k = Math.min(photos.length - 1, Math.floor(frame / step));
  const p = photos[k];
  const th = p.th ?? 0.35;

  const ax = Math.min(0.95, Math.max(0.05, p.ax));
  const ay = Math.min(0.95, Math.max(0.05, p.ay));
  const tx = W * TARGET_X;
  const ty = H * TARGET_Y;
  const cover = Math.max(W / p.w, H / p.h);
  let s = Math.max(cover * 1.05, (H * SUBJECT_H) / (th * p.h));
  s = Math.max(s, tx / (ax * p.w), (W - tx) / ((1 - ax) * p.w), ty / (ay * p.h), (H - ty) / ((1 - ay) * p.h));
  s = Math.min(s, cover * 2.6);
  const left = Math.min(0, Math.max(W - p.w * s, tx - ax * p.w * s));
  const top = Math.min(0, Math.max(H - p.h * s, ty - ay * p.h * s));

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#000" }}>
      <Img
        src={staticFile(p.src)}
        style={{
          position: "absolute",
          left,
          top,
          width: p.w * s,
          height: p.h * s,
          filter: "saturate(0.9) contrast(1.06)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: H * 0.28,
          background: "linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,0.45))",
        }}
      />
    </div>
  );
}
