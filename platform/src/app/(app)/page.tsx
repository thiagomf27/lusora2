"use client";
/**
 * Home — ported from VidRush.dc.html (isHome).
 *
 * The composer collects what the quote statement needs: an idea (the video's
 * title), the channel it belongs to, and the two things a video may pin over
 * its channel — the pipeline (D60 "production style") and the script model.
 * Nothing is created here; the quote screen is what writes the draft, exactly
 * as the mockup's "Approving locks this quote statement" note describes.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import s from "./home.module.css";

interface ChannelRow {
  id: string;
  name: string;
  language: string;
  video_type: string;
  theme: string;
  style_pack: string;
}
interface VideoRow {
  id: string;
  title: string;
  channel_id: string;
  status: string;
  price_usd: string;
}
interface ChannelConfigLite {
  pipeline?: string;
  script?: { generator?: string; llm?: string; model?: string };
  planner?: { llm?: string; model?: string };
  voice?: { provider?: string; voice_id?: string };
  budget?: { max_usd_per_video?: number };
}

function Chevron() {
  return (
    <svg className={s.chev} width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

export default function HomePage() {
  const router = useRouter();
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [channelId, setChannelId] = useState("");
  const [pipelines, setPipelines] = useState<string[]>([]);
  const [pipeline, setPipeline] = useState(""); // "" = let enqueue resolve it
  const [cfg, setCfg] = useState<ChannelConfigLite | null>(null);
  const [recent, setRecent] = useState<VideoRow[]>([]);
  const [idea, setIdea] = useState("");
  const [menu, setMenu] = useState<null | "channel" | "pipeline" | "model">(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/channels")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: ChannelRow[]) => {
        setChannels(rows);
        if (rows.length) setChannelId((prev) => prev || rows[0].id);
      })
      .catch(() => setChannels([]));
    fetch("/api/config-options")
      .then((r) => (r.ok ? r.json() : { pipelines: [] }))
      .then((o) => setPipelines(o.pipelines ?? []))
      .catch(() => setPipelines([]));
    fetch("/api/videos")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: VideoRow[]) => setRecent(rows.slice(0, 3)))
      .catch(() => setRecent([]));
  }, []);

  useEffect(() => {
    if (!channelId) return;
    setCfg(null);
    fetch(`/api/channels/${channelId}/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setCfg)
      .catch(() => setCfg(null));
  }, [channelId]);

  const channel = channels.find((c) => c.id === channelId) ?? null;
  const modelSummary = cfg
    ? [cfg.script?.llm ?? cfg.script?.generator ?? "script", cfg.planner?.llm ?? "planner"].join(" → ")
    : channelId
    ? "loading…"
    : "no channel";

  function open() {
    setError(null);
    const title = idea.trim();
    if (!title) return setError("Give the video an idea first — it becomes the draft's title.");
    if (!channelId) return setError("No channel available. Create one on the Channels screen.");
    const params = new URLSearchParams({ channel: channelId, title });
    if (pipeline) params.set("pipeline", pipeline);
    router.push(`/quote?${params}`);
  }

  return (
    <div className={s.screen} onClick={() => setMenu(null)}>
      <div className={s.hero} />
      <div className={s.body}>
        <div className={s.composerWrap} onClick={(e) => e.stopPropagation()}>
          <div className={s.composer}>
            <textarea
              className={s.prompt}
              rows={2}
              value={idea}
              placeholder="Create a documentary about ancient mysteries…"
              onChange={(e) => setIdea(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) open();
              }}
            />
            <div className={s.controls}>
              <button type="button" className={s.pill} disabled={channels.length === 0}
                      onClick={() => setMenu((m) => (m === "channel" ? null : "channel"))}>
                <span className={s.pillDot} />
                <span className={s.pillText}>{channel?.name ?? "No channels"}</span>
                <Chevron />
              </button>

              <button type="button" className={s.pill}
                      onClick={() => setMenu((m) => (m === "pipeline" ? null : "pipeline"))}>
                <span className={s.pillText}>{pipeline || "Pipeline · from channel"}</span>
                <Chevron />
              </button>

              <button type="button" className={s.plain}
                      onClick={() => setMenu((m) => (m === "model" ? null : "model"))}>
                {modelSummary}
                <Chevron />
              </button>

              <button type="button" className={s.submit} title="Open quote statement" onClick={open}>
                <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 13V3.5" />
                  <path d="M4 7.2L8 3.2l4 4" />
                </svg>
              </button>
            </div>
          </div>

          {menu === "channel" && (
            <div className={`${s.menu} ${s.menuLeft}`}>
              <div className={s.menuLabel}>Channel</div>
              {channels.map((c) => (
                <button key={c.id} type="button"
                        className={`${s.menuItem}${c.id === channelId ? " " + s.on : ""}`}
                        onClick={() => { setChannelId(c.id); setMenu(null); }}>
                  <span className={s.pillDot} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className={s.menuName}>{c.name}</span>
                    <div className={s.menuNote}>{c.video_type} · {c.language} · {c.theme}</div>
                  </span>
                </button>
              ))}
              {channels.length === 0 && <div className={s.menuNote} style={{ padding: "6px 10px" }}>No channels yet.</div>}
            </div>
          )}

          {menu === "pipeline" && (
            <div className={`${s.menu} ${s.menuMid}`}>
              <div className={s.menuLabel}>Production style</div>
              <button type="button" className={`${s.menuItem}${pipeline === "" ? " " + s.on : ""}`}
                      onClick={() => { setPipeline(""); setMenu(null); }}>
                <span style={{ flex: 1 }}>
                  <span className={s.menuName}>From the channel</span>
                  <div className={s.menuNote}>{cfg?.pipeline ?? "resolved at enqueue"}</div>
                </span>
              </button>
              {pipelines.map((p) => (
                <button key={p} type="button" className={`${s.menuItem}${p === pipeline ? " " + s.on : ""}`}
                        onClick={() => { setPipeline(p); setMenu(null); }}>
                  <span className={s.menuName}>{p}</span>
                </button>
              ))}
            </div>
          )}

          {menu === "model" && (
            <div className={`${s.menu} ${s.menuRight}`}>
              <div className={s.menuLabel} style={{ padding: "0 0 6px" }}>Resolved for this channel</div>
              <div className={s.menuRow}><span>Script</span><span>{cfg?.script?.llm ?? cfg?.script?.generator ?? "—"}</span></div>
              <div className={s.menuRow}><span>Script model</span><span>{cfg?.script?.model ?? "provider default"}</span></div>
              <div className={s.menuRow}><span>Planner</span><span>{cfg?.planner?.llm ?? "—"}</span></div>
              <div className={s.menuRow}><span>Voice</span><span>{cfg?.voice?.provider ?? "—"}</span></div>
              <div className={s.menuRow}><span>Budget</span><span>${(cfg?.budget?.max_usd_per_video ?? 0).toFixed(2)}</span></div>
              <div className={s.menuFoot}>
                Models come from the channel&apos;s brand profile. Change them in{" "}
                <Link href={`/brands?channel=${channelId}`}>Brands</Link>, or override this one video on the next screen.
              </div>
            </div>
          )}

          {error && <div className={s.error}>{error}</div>}
        </div>

        <div className={s.recent}>
          <div className={s.recentHead}>
            <span>Recent generations</span>
            <Link href="/videos" className={s.recentAll}>View all ↗</Link>
          </div>
          <div className={s.recentGrid}>
            {recent.map((v) => (
              <Link key={v.id} href={`/videos/${v.id}`} className={s.card}>
                <div className={s.thumb}>
                  {["rendered", "in_review", "approved", "posted"].includes(v.status) && (
                    <video src={`/api/videos/${v.id}/stream#t=0.5`} preload="metadata" muted />
                  )}
                  <span className={s.thumbTag}>${Number(v.price_usd ?? 0).toFixed(2)}</span>
                </div>
                <div className={s.cardBody}>
                  <div className={s.cardTitle}>{v.title}</div>
                  <div className={s.cardMeta}>{v.channel_id} · {v.status}</div>
                </div>
              </Link>
            ))}
            {recent.length === 0 && <div className={s.empty}>Nothing generated yet.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
