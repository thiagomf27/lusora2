/**
 * Payload types of the UI API (yt-video-automation's
 * contracts/ui_api_interface.json). Plan/track item types come from the
 * engine (@engine/player) — the plan itself is the shared contract.
 */

import type { EditPlan, VisualAsset } from "@engine/player";

export interface VideoEntry {
  id: string;
  date: string;
  channel: string;
  slug: string;
  title: string;
  artifacts: { script: boolean; audio: boolean; srt: boolean; plan: boolean; final: boolean };
}

export interface CfgSlice {
  captions_enabled: boolean;
  captions_style: string;
  resolution: string;
  fps: number;
}

export interface PlanPayload {
  plan: EditPlan;
  cfg: CfgSlice;
  voiceover_duration: number | null;
  plan_version_hash: string;
}

export interface Manifest {
  assets: VisualAsset[];
}

export interface Waveform {
  duration: number;
  samples: number;
  peaks: number[];
}

export interface Candidate {
  id: string;
  source: string;
  media_type: "video" | "image";
  thumbnail_url: string;
  download_url: string;
  width: number;
  height: number;
  duration: number | null;
}

export interface ValidateResult {
  valid: boolean;
  errors: string[];
}

export interface RenderStatus {
  state: "idle" | "running" | "done" | "failed";
  log_tail: string[];
  exit_code: number | null;
  final_exists: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** EditOp — the closed op set from ui_api_interface.json (chat agent output). */
export interface EditOp {
  op: string;
  [key: string]: unknown;
}

export interface ChatResponse {
  reply: string;
  operations: EditOp[];
  errors: string[];
}
