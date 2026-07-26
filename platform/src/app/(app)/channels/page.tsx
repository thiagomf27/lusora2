"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChannelConfig } from "@lusora/contracts";
import ChannelConfigForm, { defaultChannelConfig } from "@/components/ChannelConfigForm";
import s from "./channels.module.css";

interface ChannelRow {
  id: string;
  name: string;
  language: string;
  video_type: string;
  theme: string;
  style_pack: string;
  active: boolean;
}

interface VideoRow {
  id: string;
  status: string;
  price_usd: number | null;
  error_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface Rollup {
  loaded: boolean;
  videoCount: number;
  last5: string[]; // statuses, newest first
  queued: number;
  costMonth: number;
  failure: string | null;
}

/** Region subtag of a BCP-47 tag ("en-US" → "US") → flag emoji, else a globe. */
function flagFor(language: string): string {
  const region = language.split("-")[1];
  if (!region || region.length !== 2) return "🌐";
  const base = 0x1f1e6;
  return String.fromCodePoint(
    ...region.toUpperCase().split("").map((c) => base + c.charCodeAt(0) - 65)
  );
}

function dotClass(status: string): string {
  if (status === "posted" || status === "approved") return s.dotOk;
  if (status === "error" || status === "sent_back") return s.dotBad;
  if (status === "rendered" || status === "in_review") return s.dotWarn;
  return s.dotMuted; // draft, queued, producing
}

export default function ChannelsPage() {
  const router = useRouter();
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [rollups, setRollups] = useState<Record<string, Rollup>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [config, setConfig] = useState<ChannelConfig>(defaultChannelConfig);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/channels");
    if (!res.ok) return;
    const rows: ChannelRow[] = await res.json();
    setChannels(rows);
    // Roll up per-channel health/cost. Small channel counts — a per-row
    // fan-out is fine; each resolves independently so rows fill in as ready.
    for (const c of rows) {
      void loadRollup(c.id);
    }
  }

  async function loadRollup(id: string) {
    const [vRes, cRes] = await Promise.all([
      fetch(`/api/videos?channel=${encodeURIComponent(id)}`),
      fetch(`/api/channels/${encodeURIComponent(id)}/costs`),
    ]);
    const videos: VideoRow[] = vRes.ok ? await vRes.json() : [];
    const costs = cRes.ok ? await cRes.json() : { byMonth: [] };
    const now = new Date();
    const monthRow = (costs.byMonth ?? []).find((m: { month: string; usd: number }) => {
      const d = new Date(m.month);
      return d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth();
    });
    const failed = videos.find((v) => v.status === "error");
    setRollups((prev) => ({
      ...prev,
      [id]: {
        loaded: true,
        videoCount: videos.length,
        last5: videos.slice(0, 5).map((v) => v.status),
        queued: videos.filter((v) => v.status === "queued").length,
        costMonth: Number(monthRow?.usd ?? 0),
        failure: failed ? failed.error_reason ?? "render failed" : null,
      },
    }));
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setConfig(defaultChannelConfig());
    setError(null);
    setShowCreate(true);
  }

  async function create() {
    setError(null);
    const res = await fetch("/api/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    if (res.ok) {
      setShowCreate(false);
      load();
    } else setError((await res.json()).error ?? "failed");
  }

  const languages = new Set(channels.map((c) => c.language));

  return (
    <div className="page">
      <div className="pageHead">
        <div>
          <h1 className="pageTitle">Channels</h1>
          <div className="pageSub">
            {channels.length} channel{channels.length === 1 ? "" : "s"} · {languages.size} language
            {languages.size === 1 ? "" : "s"} · health of the last 5 videos
          </div>
        </div>
        <button className="primary" onClick={openCreate}>
          New channel
        </button>
      </div>

      <div className={s.filters}>
        <span className={s.count}>
          {channels.length} of {channels.length} channels
        </span>
      </div>

      <div className={s.table}>
        <div className={s.thead}>
          <div>CHANNEL</div>
          <div>LANGUAGE · TYPE</div>
          <div>LAST 5</div>
          <div>QUEUE</div>
          <div>COST · MONTH</div>
          <div>LAST FAILURE</div>
        </div>

        {channels.map((c) => {
          const r = rollups[c.id];
          return (
            <div key={c.id} className={s.rowWrap}>
              <div className={s.trow} onClick={() => router.push(`/channels/${c.id}`)}>
                <div className={s.channel}>
                  <div className={s.flag}>{flagFor(c.language)}</div>
                  <div className={s.channelMeta}>
                    <div className={s.channelName}>{c.name}</div>
                    <div className={s.channelSub}>
                      {r ? `${r.videoCount} video${r.videoCount === 1 ? "" : "s"}` : "…"}
                      {!c.active && " · inactive"}
                    </div>
                  </div>
                </div>

                <div className={s.langMode}>
                  <span className={s.lang}>{c.language}</span>
                  <span className={s.modeBadge}>{c.video_type}</span>
                </div>

                <div className={s.dots}>
                  {r
                    ? (r.last5.length
                        ? r.last5.map((st, i) => <span key={i} className={`${s.dot} ${dotClass(st)}`} />)
                        : <span className={s.numDim}>—</span>)
                    : <span className={s.numDim}>…</span>}
                </div>

                <div className={`${s.num} ${r?.queued ? "" : s.numDim}`}>{r ? (r.queued || "—") : "…"}</div>

                <div className={`${s.cost} ${r?.costMonth ? "" : s.numDim}`}>
                  {r ? `$${r.costMonth.toFixed(2)}` : "…"}
                </div>

                <div className={`${s.failure} ${r?.failure ? s.failureBad : ""}`}>
                  {r ? (r.failure ?? "no recent failures") : "…"}
                </div>
              </div>
            </div>
          );
        })}

        {channels.length === 0 && <div className={s.empty}>No channels yet.</div>}
      </div>

      {showCreate && (
        <div className={s.overlay} onClick={() => setShowCreate(false)}>
          <div className={s.modal} onClick={(e) => e.stopPropagation()}>
            <div className={s.modalHead}>
              <div className={s.modalTitle}>New channel</div>
              <button onClick={() => setShowCreate(false)}>Close</button>
            </div>
            <ChannelConfigForm value={config} onChange={setConfig} mode="create" />
            {error && <div style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
            <div className={s.modalActions}>
              <button onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="primary" onClick={create}>
                Create channel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
