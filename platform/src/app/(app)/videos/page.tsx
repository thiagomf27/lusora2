"use client";
/**
 * Videos — ported from VidRush.dc.html (isVideos).
 *
 * The mockup's card carries a duration and a render percentage; neither is
 * recorded, so the thumbnail shows the file size and the card falls back to
 * the status badge for progress. Everything else on it is real.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Dropdown, StatusBadge, type Tone } from "@/components/ds";
import scr from "../screen.module.css";
import s from "./videos.module.css";

interface VideoRow {
  id: string;
  channel_id: string;
  title: string;
  status: string;
  price_usd: string;
  size_bytes: number | null;
  error_reason: string | null;
  created_at: string;
}
interface ChannelRow {
  id: string;
  name: string;
}

const STATUSES = [
  "draft", "queued", "producing", "rendered", "in_review", "sent_back", "approved", "posted", "error",
];
const PLAYABLE = new Set(["rendered", "in_review", "approved", "posted"]);
const REVIEWABLE = new Set(["in_review", "sent_back"]);

function toneFor(status: string): Tone {
  if (status === "posted" || status === "approved" || status === "rendered") return "success";
  if (status === "queued" || status === "producing") return "info";
  if (status === "error") return "danger";
  if (REVIEWABLE.has(status)) return "warning";
  return "neutral";
}

function fmtSize(bytes: number | null): string {
  if (bytes == null) return "—";
  return bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1e3)} KB`;
}

export default function VideosPage() {
  const router = useRouter();
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");

  useEffect(() => {
    fetch("/api/channels").then(async (r) => r.ok && setChannels(await r.json()));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (channel) params.set("channel", channel);
    if (status) params.set("status", status);
    fetch(`/api/videos?${params}`).then(async (r) => r.ok && setVideos(await r.json()));
  }, [channel, status]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? videos.filter((v) => v.title.toLowerCase().includes(q)) : videos;
  }, [videos, search]);

  const nameOf = (id: string) => channels.find((c) => c.id === id)?.name ?? id;
  const producing = videos.filter((v) => v.status === "producing" || v.status === "queued").length;
  const countLabel =
    filtered.length === videos.length
      ? `${videos.length} videos · ${producing} in the pipeline`
      : `${filtered.length} of ${videos.length} videos`;

  return (
    <div className={scr.screen}>
      <div className={scr.wrap}>
        <div className={scr.head} style={{ padding: 0, marginBottom: 20 }}>
          <div className={scr.headMain}>
            <h1 className={scr.h1}>Videos</h1>
            <p className={scr.sub}>{countLabel}</p>
          </div>
          <Button onClick={() => router.push("/")}>New video</Button>
        </div>

        <div className={s.filters}>
          <div className={s.search}>
            <svg className={s.searchIcon} width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="var(--text-faint)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="7.2" cy="7.2" r="4.4" />
              <path d="M10.6 10.6L13.5 13.5" />
            </svg>
            <input
              className={s.searchInput}
              value={search}
              placeholder="Search videos…"
              onChange={(e) => setSearch(e.currentTarget.value)}
            />
          </div>
          <div className={s.filter}>
            <Dropdown
              options={["", ...STATUSES].map((v) => ({ value: v, label: v || "All statuses" }))}
              value={status}
              onChange={setStatus}
            />
          </div>
          <div className={s.filter}>
            <Dropdown
              options={[{ value: "", label: "All channels" }, ...channels.map((c) => ({ value: c.id, label: c.name }))]}
              value={channel}
              onChange={setChannel}
            />
          </div>
        </div>

        <div className={s.grid}>
          {filtered.map((v) => (
            <Link key={v.id} href={`/videos/${v.id}`} className={s.card}>
              <div className={s.thumb}>
                {PLAYABLE.has(v.status) ? (
                  <video src={`/api/videos/${v.id}/stream#t=0.5`} preload="metadata" muted />
                ) : (
                  <svg width="30" height="30" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="8" cy="8" r="6" />
                    <path d="M6.8 5.6l3.4 2.4-3.4 2.4z" />
                  </svg>
                )}
                <span className={s.tag}>{fmtSize(v.size_bytes)}</span>
                {(v.status === "producing" || v.status === "queued") && (
                  <span className={s.progress}>{v.status}</span>
                )}
              </div>
              <div className={s.body}>
                <div className={s.titleRow}>
                  <div className={s.title}>{v.title}</div>
                  <StatusBadge label={v.status} tone={toneFor(v.status)} />
                </div>
                <div className={s.metaRow}>
                  <span>{nameOf(v.channel_id)}</span>
                  {REVIEWABLE.has(v.status) && <span className={s.reviewTag}>Review mode</span>}
                </div>
                {v.error_reason && <div className={s.errorNote}>{v.error_reason}</div>}
                <div className={s.footRow}>
                  <span>{new Date(v.created_at).toLocaleDateString()}</span>
                  <span className={s.cost}>${Number(v.price_usd ?? 0).toFixed(3)}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {filtered.length === 0 && <div className={scr.emptyState}>No videos match these filters.</div>}
      </div>
    </div>
  );
}
