/** The row shape broll-engine's API returns (`_seg_json`: the Segment dataclass
 *  minus its embedding, plus `score`/`sim` on a search hit). */
export interface Segment {
  id: string;
  video_id: string;
  source: string;
  source_name: string | null;
  source_url: string | null;
  license: string;
  tags: string[];
  caption: string;
  start: number;
  end: number;
  duration: number;
  confidence: number;
  width: number;
  height: number;
  channel_id: string | null;
  niches: string[];
  usage_count: number;
  last_used: number | null;
  duplicate_of: string | null;
  created_at: number;
  status: string;
  /** search only: the RANKED order — similarity adjusted for confidence,
   *  overuse, recency and duration fit, minus a hard block on a clip already
   *  used in this project. Not a similarity, not bounded to 0..1 (D74). */
  score?: number;
  /** search only: the raw cosine. This is the one to read as "how close". */
  sim?: number;
}

export interface Lookup {
  id: string;
  name: string;
}

/** A row from the library's ingest queue. `status` is "queued", one of the
 *  stage names the worker mirrors into it (preparing / downloading / tagging /
 *  cutting / storing), "done", or "failed" — a retryable failure goes back to
 *  "queued" with the reason in `error`, so an error string does NOT imply a
 *  terminal state. */
export interface Job {
  id: string;
  kind: string;
  url: string | null;
  status: string;
  stage: string | null;
  progress: number;
  segments_created: number | null;
  attempts: number;
  error: string | null;
  created_at: number;
}

/** Everything the pages fetch goes through the platform's 1:1 proxy, so the
 *  browser never needs to reach the library directly. */
export const LIB = "/api/library";

export async function libGet<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }
  const res = await fetch(`${LIB}/${path}${qs.toString() ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `${path} failed`);
  return res.json();
}

export async function libSend<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${LIB}/${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? data.detail ?? `${path} failed`);
  return data as T;
}

export function fmtDuration(s: number): string {
  if (!s) return "—";
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function fmtAge(epoch: number | null): string {
  if (!epoch) return "never";
  const days = (Date.now() / 1000 - epoch) / 86400;
  if (days < 1) return "today";
  if (days < 30) return `${Math.round(days)}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}
