"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { ChannelConfig } from "@lusora/contracts";
import ChannelConfigForm from "@/components/ChannelConfigForm";
import s from "./channel.module.css";

interface Channel {
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
  title: string;
  status: string;
  price_usd: number | null;
  created_at: string;
}
interface Member {
  id: string;
  email: string;
  name: string;
  role: string;
}
type Tab = "videos" | "settings" | "team";

function flagFor(language: string): string {
  const region = language.split("-")[1];
  if (!region || region.length !== 2) return "🌐";
  const base = 0x1f1e6;
  return String.fromCodePoint(
    ...region.toUpperCase().split("").map((c) => base + c.charCodeAt(0) - 65)
  );
}

function statusMeta(status: string): { label: string; cls: string } {
  switch (status) {
    case "posted":
    case "approved":
      return { label: status.toUpperCase(), cls: s.stOk };
    case "rendered":
    case "in_review":
      return { label: status === "rendered" ? "RENDERED" : "IN REVIEW", cls: s.stWarn };
    case "sent_back":
      return { label: "SENT BACK", cls: s.stWarn };
    case "error":
      return { label: "ERROR", cls: s.stErr };
    default:
      return { label: status.toUpperCase(), cls: s.stMut }; // draft, queued, producing
  }
}

function timeAgo(iso: string): string {
  const secs = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  const units: [number, string][] = [
    [86400, "d"],
    [3600, "h"],
    [60, "m"],
  ];
  for (const [size, label] of units) {
    if (secs >= size) return `${Math.floor(secs / size)}${label} ago`;
  }
  return "just now";
}

function initials(name: string): string {
  const parts = (name || "?").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function ChannelDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>("videos");
  const [channel, setChannel] = useState<Channel | null>(null);
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [costMonth, setCostMonth] = useState(0);
  const [canManage, setCanManage] = useState(false);

  // Settings tab
  const [config, setConfig] = useState<ChannelConfig | null>(null);
  const [configMsg, setConfigMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Team tab
  const [members, setMembers] = useState<Member[]>([]);
  const [candidates, setCandidates] = useState<Member[]>([]);
  const [addPick, setAddPick] = useState("");
  const [teamForbidden, setTeamForbidden] = useState(false);

  const loadChannel = useCallback(async () => {
    const res = await fetch(`/api/channels/${id}`);
    if (res.ok) {
      const c: Channel = await res.json();
      setChannel(c);
    }
  }, [id]);

  const loadVideos = useCallback(async () => {
    const res = await fetch(`/api/videos?channel=${encodeURIComponent(id)}`);
    if (res.ok) setVideos(await res.json());
  }, [id]);

  const loadCosts = useCallback(async () => {
    const res = await fetch(`/api/channels/${id}/costs`);
    if (!res.ok) return;
    const { byMonth } = await res.json();
    const now = new Date();
    const row = (byMonth ?? []).find((m: { month: string; usd: number }) => {
      const d = new Date(m.month);
      return d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth();
    });
    setCostMonth(Number(row?.usd ?? 0));
  }, [id]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => setCanManage(u && (u.role === "manager" || u.role === "admin")));
    loadChannel();
    loadVideos();
    loadCosts();
  }, [id, loadChannel, loadVideos, loadCosts]);

  // Lazy-load per-tab data on first visit.
  useEffect(() => {
    if (tab === "settings" && !config) {
      fetch(`/api/channels/${id}/config`).then(async (r) => {
        if (r.ok) setConfig(await r.json());
      });
    }
    if (tab === "team" && members.length === 0 && !teamForbidden) {
      fetch(`/api/channels/${id}/team`).then(async (r) => {
        if (r.status === 403) return setTeamForbidden(true);
        if (r.ok) setMembers(await r.json());
      });
      fetch(`/api/users`).then(async (r) => {
        if (r.ok) setCandidates(await r.json());
      });
    }
  }, [tab, id, config, members.length, teamForbidden]);

  async function saveConfig() {
    if (!config) return;
    setConfigMsg(null);
    const res = await fetch(`/api/channels/${id}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    if (res.ok) {
      setConfigMsg({ ok: true, text: "Saved." });
      loadChannel();
    } else {
      setConfigMsg({ ok: false, text: (await res.json()).error ?? "save failed" });
    }
  }

  async function patchChannel(patch: Record<string, unknown>) {
    const res = await fetch(`/api/channels/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) setChannel(await res.json());
  }

  async function saveTeam(nextIds: string[]) {
    const res = await fetch(`/api/channels/${id}/team`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_ids: nextIds }),
    });
    if (res.ok) {
      const r = await fetch(`/api/channels/${id}/team`);
      if (r.ok) setMembers(await r.json());
    }
  }

  if (!channel) return <div className="page">Loading…</div>;

  const nonMembers = candidates.filter((c) => !members.some((m) => m.id === c.id));

  return (
    <div className="page">
      <div className={s.header}>
        <div className={s.headLeft}>
          <Link href="/channels" className={s.back}>
            ← Channels
          </Link>
          <div className={s.titleRow}>
            <div className={s.flag}>{flagFor(channel.language)}</div>
            <h1 className={s.title}>{channel.name}</h1>
          </div>
          <div className={s.meta}>
            {channel.language} · {channel.video_type} · {videos.length} video
            {videos.length === 1 ? "" : "s"} · ${costMonth.toFixed(2)} this month
            {!channel.active && " · inactive"}
          </div>
        </div>
        <Link href={`/videos?channel=${channel.id}`} className={s.newBtn}>
          New production
        </Link>
      </div>

      <div className={s.tabs}>
        {(["videos", "settings", "team"] as Tab[]).map((t) => (
          <button
            key={t}
            className={`${s.tab}${tab === t ? " " + s.tabActive : ""}`}
            onClick={() => setTab(t)}
          >
            {t === "videos" ? "Videos" : t === "settings" ? "Settings" : "Team"}
          </button>
        ))}
      </div>

      {tab === "videos" && (
        <div>
          {videos.length === 0 ? (
            <div className={s.muted}>No videos for this channel yet.</div>
          ) : (
            <div className={s.vList}>
              {videos.map((v) => {
                const meta = statusMeta(v.status);
                return (
                  <Link key={v.id} href={`/videos/${v.id}`} className={s.vRow}>
                    <div className={s.vThumb} />
                    <div className={s.vTitle}>{v.title}</div>
                    <span className={`${s.statusChip} ${meta.cls}`}>{meta.label}</span>
                    <div className={s.vCost}>${Number(v.price_usd ?? 0).toFixed(3)}</div>
                    <div className={s.vTime}>{timeAgo(v.created_at)}</div>
                  </Link>
                );
              })}
            </div>
          )}
          <div className={s.vFooter}>
            <Link href={`/videos?channel=${channel.id}`}>
              See all in Videos filtered to this channel →
            </Link>
          </div>
        </div>
      )}

      {tab === "settings" && (
        <div className={s.settings}>
          {!canManage && <div className={s.readonlyNote}>Read-only — manager role required to edit.</div>}
          <div className={s.field}>
            <label className={s.fieldLabel}>Status</label>
            <div className={s.row}>
              <span className={s.roleBadge}>{channel.active ? "Active" : "Inactive"}</span>
              <button disabled={!canManage} onClick={() => patchChannel({ active: !channel.active })}>
                {channel.active ? "Deactivate" : "Activate"}
              </button>
            </div>
          </div>
          {config ? (
            <fieldset disabled={!canManage} className={s.fieldset}>
              <ChannelConfigForm value={config} onChange={setConfig} mode="edit" />
            </fieldset>
          ) : (
            <div className={s.muted}>Loading config…</div>
          )}
          {configMsg && <div className={configMsg.ok ? s.ok : s.err}>{configMsg.text}</div>}
          {canManage && config && (
            <div>
              <button className="primary" onClick={saveConfig}>
                Save config
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "team" && (
        <div>
          {teamForbidden ? (
            <div className={s.muted}>Manager role required to view the team.</div>
          ) : (
            <>
              <div className={s.teamList}>
                {members.length === 0 && <div className={s.muted}>No members granted yet.</div>}
                {members.map((m) => (
                  <div key={m.id} className={s.member}>
                    <div className={s.avatar}>{initials(m.name)}</div>
                    <div className={s.memberMeta}>
                      <div className={s.memberName}>{m.name}</div>
                      <div className={s.memberEmail}>{m.email}</div>
                    </div>
                    <span className={s.roleBadge}>{m.role}</span>
                    {canManage && (
                      <button
                        className={s.removeBtn}
                        onClick={() => saveTeam(members.filter((x) => x.id !== m.id).map((x) => x.id))}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {canManage && (
                <div className={s.addRow}>
                  <select value={addPick} onChange={(e) => setAddPick(e.target.value)}>
                    <option value="">Add a member…</option>
                    {nonMembers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} — {c.email} ({c.role})
                      </option>
                    ))}
                  </select>
                  <button
                    className="primary"
                    disabled={!addPick}
                    onClick={() => {
                      saveTeam([...members.map((m) => m.id), addPick]);
                      setAddPick("");
                    }}
                  >
                    Add
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
