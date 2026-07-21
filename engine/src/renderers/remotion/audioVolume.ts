/**
 * Per-frame volume for a music/sfx item: base volume shaped by fade_in_s /
 * fade_out_s ramps (both relative to the item's on-timeline span, not the
 * asset). Pure and unit-testable; overlapping fades multiply. Ported from
 * video-engine's audioVolume.ts, adapted to edit_plan v1.0 field names.
 */

export interface VolumeShape {
  volume?: number;
  fade_in_s?: number;
  fade_out_s?: number;
}

export function audioVolumeAt(
  item: VolumeShape,
  frame: number,
  durationInFrames: number,
  fps: number,
  defaultVolume = 1,
): number {
  let volume = item.volume ?? defaultVolume;
  const fadeInFrames = item.fade_in_s ? Math.round(item.fade_in_s * fps) : 0;
  if (fadeInFrames > 0) {
    volume *= clamp01(frame / fadeInFrames);
  }
  const fadeOutFrames = item.fade_out_s ? Math.round(item.fade_out_s * fps) : 0;
  if (fadeOutFrames > 0) {
    volume *= clamp01((durationInFrames - frame) / fadeOutFrames);
  }
  return clamp01(volume);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
