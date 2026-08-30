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
  /** Has a HUMAN rewritten the caption, or is this still the model's first
   *  guess? Dedup runs at approval against whatever the caption says, so
   *  Review warns before approving on clips nobody has looked at. */
  caption_edited: boolean;
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
  video_id: string | null;
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

// ---- Slice 7's additions ----

export interface TagCount { name: string; segments: number }
export interface SourceCount { name: string; segments: number }

export interface SourceVideo {
  video_id: string;
  segments: number;
  pending: number;
  created_at: number;
  source_name: string | null;
  source: string;
}

export interface LibraryStats {
  approved: number;
  pending: number;
  duplicates: number;
  duration_s: number;
  videos: number;
  sources: number;
}

/** Filters the API accepts on both /search and /segments. Kept as one type so
 *  the rail, the search page and the browse page cannot drift about what a
 *  filter is called. */
export interface Filters {
  licenses?: string[];
  tags?: string[];
  source_name?: string;
  min_duration?: number;
  max_duration?: number;
  created_after?: number;
  created_before?: number;
  channel_id?: string;
  include_global?: boolean;
  video_id?: string;
}

export function filterParams(f: Filters): Record<string, string | number | undefined> {
  return {
    licenses: f.licenses?.length ? f.licenses.join(",") : undefined,
    tags: f.tags?.length ? f.tags.join(",") : undefined,
    source_name: f.source_name || undefined,
    min_duration: f.min_duration,
    max_duration: f.max_duration,
    created_after: f.created_after,
    created_before: f.created_before,
    channel_id: f.channel_id || undefined,
    include_global: f.include_global === false ? "false" : undefined,
    video_id: f.video_id || undefined,
  };
}

export function activeFilterCount(f: Filters): number {
  return [
    f.licenses?.length, f.tags?.length, f.source_name,
    f.min_duration !== undefined || f.max_duration !== undefined,
    f.created_after !== undefined || f.created_before !== undefined,
    f.channel_id,
  ].filter(Boolean).length;
}

/** A listing plus the total under the SAME filters. A page cannot report how
 *  many rows it is a page of, so the count rides in a header (Slice 7). */
export async function libList(
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<{ rows: Segment[]; total: number }> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }
  const res = await fetch(`${LIB}/${path}${qs.toString() ? `?${qs}` : ""}`);
  if (!res.ok) {
    throw new Error((await res.json().catch(() => ({}))).error ?? `${path} failed`);
  }
  const rows: Segment[] = await res.json();
  const header = res.headers.get("x-total-count");
  return { rows, total: header ? Number(header) : rows.length };
}

export function fmtClock(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/** Timecode with hundredths, for the trim workbench where a frame matters. */
export function fmtPrecise(s: number): string {
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${String(m).padStart(2, "0")}:${rest.toFixed(2).padStart(5, "0")}`;
}

export function fmtFootage(seconds: number): string {
  // Below a minute, say seconds. Rounding to minutes reports a library that
  // has footage in it as "0 m", which is what a new library looks like for its
  // whole first day.
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h} h ${m} m` : `${m} m`;
}
