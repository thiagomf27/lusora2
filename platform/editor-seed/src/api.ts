/**
 * Typed client for the UI API (contracts/ui_api_interface.json in
 * yt-video-automation). The UI talks ONLY to this API — never to
 * Pexels/Gemini/DeepSeek directly.
 */

import type { EditPlan } from "@engine/player";
import type {
  Candidate,
  ChatMessage,
  ChatResponse,
  Manifest,
  PlanPayload,
  RenderStatus,
  ValidateResult,
  VideoEntry,
  Waveform,
} from "./types";

export const API_BASE: string = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8710";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string | string[],
  ) {
    super(Array.isArray(detail) ? detail.join("\n") : detail);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw new ApiError(0, `UI API unreachable at ${API_BASE} — start it with 'python -m pipeline.ui_api'`);
  }
  if (!response.ok) {
    let detail: string | string[] = response.statusText;
    try {
      detail = (await response.json()).detail ?? detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(response.status, detail);
  }
  return (await response.json()) as T;
}

export const api = {
  listVideos: () => request<VideoEntry[]>("/videos"),

  getPlan: (id: string) => request<PlanPayload>(`/videos/${id}/plan`),

  putPlan: (id: string, plan: EditPlan) =>
    request<PlanPayload>(`/videos/${id}/plan`, { method: "PUT", body: JSON.stringify(plan) }),

  validatePlan: (id: string, plan: EditPlan) =>
    request<ValidateResult>(`/videos/${id}/plan/validate`, {
      method: "POST",
      body: JSON.stringify(plan),
    }),

  getManifest: (id: string) => request<Manifest>(`/videos/${id}/manifest`),

  getWaveform: (id: string, path = "audio.mp3", samples = 1000) =>
    request<Waveform>(`/videos/${id}/waveform?path=${encodeURIComponent(path)}&samples=${samples}`),

  listLibrary: (id: string) =>
    request<{ files: { name: string; path: string; materialized: boolean }[] }>(
      `/videos/${id}/library`,
    ),

  getThumbs: (id: string, path: string, count = 5) =>
    request<{ urls: string[] }>(
      `/videos/${id}/thumbs?path=${encodeURIComponent(path)}&count=${count}`,
    ),

  searchAssets: (query: string, mediaType: "video" | "image", count = 24) =>
    request<{ candidates: Candidate[] }>(
      `/assets/search?query=${encodeURIComponent(query)}&media_type=${mediaType}&count=${count}`,
    ),

  downloadAsset: (id: string, candidate: Candidate, visualIndex: number) =>
    request<PlanPayload>(`/videos/${id}/assets/download`, {
      method: "POST",
      body: JSON.stringify({ candidate, visual_index: visualIndex }),
    }),

  chat: (id: string, messages: ChatMessage[], planVersionHash: string) =>
    request<ChatResponse>(`/videos/${id}/chat`, {
      method: "POST",
      body: JSON.stringify({ messages, plan_version_hash: planVersionHash }),
    }),

  startRender: (id: string) => request<{ job_id: string }>(`/videos/${id}/render`, { method: "POST" }),

  renderStatus: (id: string) => request<RenderStatus>(`/videos/${id}/render/status`),
};

/** URL of a file inside the video folder, served by the API with Range support. */
export function fileUrl(videoId: string, relPath: string): string {
  return `${API_BASE}/videos/${videoId}/files/${relPath}`;
}
