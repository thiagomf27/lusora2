import type { EditPlan } from "@lusora/contracts";

export interface RenderResult {
  duration_s: number;
}

// Implemented in M3.
export async function renderFfmpeg(_plan: EditPlan, _videoDir: string): Promise<RenderResult> {
  throw new Error("ffmpeg renderer not implemented yet (M3)");
}
