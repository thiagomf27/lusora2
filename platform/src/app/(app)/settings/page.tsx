"use client";
/**
 * Settings — ported from VidRush.dc.html (isSettings).
 *
 * Five of the mockup's six tabs have something real behind them. Its
 * "workspace name / time zone / interface language", API keys and library
 * connections do not exist in this system: there is one workspace, and the
 * providers are configured by environment, so the Account tab reports what is
 * actually true instead of offering fields that write nowhere.
 *
 * "New video defaults" are per-channel here, so that tab is a read-only
 * overview that links to the channel and its brand profile.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Dropdown, StatusBadge, TextInput, type Tone } from "@/components/ds";
import scr from "../screen.module.css";
import s from "./settings.module.css";

const TABS = ["Account", "Defaults", "Members", "Costs", "Monitor"];
const ROLES = ["admin", "manager", "editor"];

const ROLE_PERMS: Record<string, [string, boolean][]> = {
  admin: [
    ["Everything a manager can do", true],
    ["Create and remove users", true],
    ["Change anyone's role", true],
    ["Grant channel access", true],
  ],
  manager: [
    ["Create and enqueue videos", true],
    ["Edit channels and brand profiles", true],
    ["Approve, send back and post", true],
    ["Manage users", false],
  ],
  editor: [
    ["Open the editor and edit plans", true],
    ["Leave review notes", true],
    ["Edit channels and brand profiles", false],
    ["See per-video cost", false],
  ],
};

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  channels: string[];
}
interface ChannelRow {
  id: string;
  name: string;
  language: string;
  video_type: string;
  theme: string;
  style_pack: string;
  active: boolean;
}
interface Monitor {
  workers: { worker_id: string; last_seen: string; current_video_id: string | null; alive: boolean }[];
  providers: { provider: string; configured: boolean; last_success_ts: string | null; last_error_ts: string | null; last_error: string | null }[];
  costsByDay: { day: string; usd: number; ops: number }[];
  costsByProvider: { provider: string; usd: number; ops: number }[];
  storage: { videos_root: string; folders: number; bytes: number };
}

const money = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const gb = (bytes: number) => `${(bytes / 1e9).toFixed(2)} GB`;

function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase();
}

export default function SettingsPage() {
  const [tab, setTab] = useState(0);
  const [me, setMe] = useState<{ id: string; name: string; email: string; role: string } | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [monitor, setMonitor] = useState<Monitor | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({ name: "", email: "", password: "", role: "editor" });
  const [message, setMessage] = useState<{ text: string; ok?: boolean } | null>(null);

  const isAdmin = me?.role === "admin";

  /** Each panel fills in as its own call lands — /api/monitor walks the whole
   *  videos root for its storage figure, so nothing else waits on it. */
  const load = useCallback(async () => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => {
        if (!u) return;
        setMe(u);
        if (u.role !== "admin") return;
        return fetch("/api/admin/users")
          .then((r) => (r.ok ? r.json() : []))
          .then(setUsers);
      })
      .catch(() => undefined);
    fetch("/api/channels")
      .then((r) => (r.ok ? r.json() : []))
      .then(setChannels)
      .catch(() => undefined);
    fetch("/api/monitor")
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => m && setMonitor(m))
      .catch(() => undefined);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function setRole(id: string, role: string) {
    setMessage(null);
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setMessage({ text: body.error ?? `could not change the role (${res.status})` });
    }
    load();
  }

  async function setActive(id: string, active: boolean) {
    await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    load();
  }

  async function sendInvite() {
    setMessage(null);
    if (!invite.name.trim() || !invite.email.trim() || !invite.password.trim()) {
      setMessage({ text: "Name, email and an initial password are all required." });
      return;
    }
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(invite),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage({ text: body.error ?? `could not create the user (${res.status})` });
      return;
    }
    setMessage({ text: `${invite.email} can sign in with the password you set.`, ok: true });
    setInvite({ name: "", email: "", password: "", role: "editor" });
    setInviteOpen(false);
    load();
  }

  const totalSpend = (monitor?.costsByProvider ?? []).reduce((a, p) => a + p.usd, 0);
  const totalOps = (monitor?.costsByProvider ?? []).reduce((a, p) => a + p.ops, 0);
  const last30 = (monitor?.costsByDay ?? []).reduce((a, d) => a + d.usd, 0);
  const maxProvider = Math.max(1, ...(monitor?.costsByProvider ?? []).map((p) => p.usd));

  return (
    <div className={scr.screen}>
      <div className={scr.sticky}>
        <div className={scr.head}>
          <div className={scr.headMain}>
            <h1 className={scr.h1}>Settings</h1>
            <p className={scr.sub}>
              What is true for the whole installation. Anything that varies per channel lives on Channels and
              Brands.
            </p>
          </div>
        </div>
        <div className={scr.tabs}>
          {TABS.map((name, i) => (
            <button key={name} type="button" className={`${scr.tab}${tab === i ? " " + scr.active : ""}`} onClick={() => setTab(i)}>
              {name}
            </button>
          ))}
        </div>
      </div>

      <div className={scr.wrap}>
        {tab === 0 && (
          <div className={scr.stack}>
            <div className={scr.card}>
              <h2 className={scr.h2}>Account</h2>
              <p className={scr.cardSub}>Who you are signed in as, and what that lets you do.</p>
              <div className={scr.tileGrid}>
                <div className={scr.tile}>
                  <div className={scr.tileLabel}>Name</div>
                  <div className={scr.tileValue}>{me?.name ?? "—"}</div>
                </div>
                <div className={scr.tile}>
                  <div className={scr.tileLabel}>Email</div>
                  <div className={scr.tileValue}>{me?.email ?? "—"}</div>
                </div>
                <div className={scr.tile}>
                  <div className={scr.tileLabel}>Role</div>
                  <div className={scr.tileValue}>{me?.role ?? "—"}</div>
                </div>
              </div>
            </div>

            <div className={scr.card}>
              <h2 className={scr.h2}>Storage</h2>
              <p className={scr.cardSub}>
                Where renders are filed. Retention per channel decides how long clips and the final file survive.
              </p>
              <div className={scr.tileGrid}>
                <div className={scr.tile}>
                  <div className={scr.tileLabel}>Videos root</div>
                  <div className={`${scr.tileValue} ${scr.mono}`}>{monitor?.storage.videos_root ?? "—"}</div>
                </div>
                <div className={scr.tile}>
                  <div className={scr.tileLabel}>Video folders</div>
                  <div className={scr.tileValue}>{monitor?.storage.folders ?? 0}</div>
                </div>
                <div className={scr.tile}>
                  <div className={scr.tileLabel}>On disk</div>
                  <div className={scr.tileValue}>{monitor ? gb(monitor.storage.bytes) : "—"}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 1 && (
          <div className={scr.stack}>
            <div className={scr.card}>
              <h2 className={scr.h2}>New video defaults</h2>
              <p className={scr.cardSub}>
                Every video starts from its channel, not from a workspace default. This is what each channel
                hands a new video.
              </p>
              <div className={scr.stackTight}>
                {channels.map((c) => (
                  <div key={c.id} className={s.member}>
                    <span className={s.avatar}>{initials(c.name)}</span>
                    <div className={s.memberMain}>
                      <div className={s.memberName}>{c.name}</div>
                      <div className={s.memberEmail}>
                        {c.video_type} · {c.language} · {c.theme} · {c.style_pack}
                      </div>
                    </div>
                    <StatusBadge label={c.active ? "Active" : "Paused"} tone={c.active ? "success" : "neutral"} />
                    <Link href={`/channels?channel=${c.id}`}>
                      <Button size="sm" variant="ghost">Configure</Button>
                    </Link>
                  </div>
                ))}
                {channels.length === 0 && <div className={scr.toggleDesc}>No channels yet.</div>}
              </div>
            </div>
          </div>
        )}

        {tab === 2 && (
          <div className={scr.stack}>
            <div className={scr.card}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 18 }}>
                <div style={{ flex: 1 }}>
                  <h2 className={scr.h2}>Members</h2>
                  <p className={scr.cardSub} style={{ marginBottom: 0 }}>
                    {isAdmin ? `${users.length} member${users.length === 1 ? "" : "s"}` : "Only an admin can see and change the member list."}
                  </p>
                </div>
                {isAdmin && (
                  <Button size="sm" variant="secondary" onClick={() => setInviteOpen((o) => !o)}>
                    {inviteOpen ? "Cancel" : "Add member"}
                  </Button>
                )}
              </div>

              {isAdmin && inviteOpen && (
                <div className={s.invite}>
                  <div className={s.inviteTitle}>Add a member</div>
                  <div className={s.inviteNote}>
                    There is no mail server here, so you set the initial password and hand it over yourself.
                  </div>
                  <div className={s.inviteGrid}>
                    <TextInput label="Name" value={invite.name}
                               onChange={(e) => setInvite({ ...invite, name: e.currentTarget.value })} />
                    <TextInput label="Email" value={invite.email}
                               onChange={(e) => setInvite({ ...invite, email: e.currentTarget.value })} />
                    <Dropdown label="Role" options={ROLES} value={invite.role}
                              onChange={(v) => setInvite({ ...invite, role: v })} />
                  </div>
                  <div className={s.inviteGrid} style={{ marginTop: 12 }}>
                    <TextInput label="Initial password" type="password" value={invite.password}
                               onChange={(e) => setInvite({ ...invite, password: e.currentTarget.value })} />
                  </div>
                  <div className={s.inviteActions}>
                    <Button size="sm" onClick={sendInvite}>Create member</Button>
                    <Button size="sm" variant="ghost" onClick={() => setInviteOpen(false)}>Cancel</Button>
                  </div>
                </div>
              )}

              {isAdmin && (
                <div className={scr.stackTight}>
                  {users.map((u) => (
                    <div key={u.id} className={`${s.member}${u.active ? "" : " " + s.inactive}`}>
                      <span className={s.avatar}>{initials(u.name)}</span>
                      <div className={s.memberMain}>
                        <div className={s.memberName}>{u.name}</div>
                        <div className={s.memberEmail}>
                          {u.email}
                          {u.channels.length ? ` · ${u.channels.length} channel grant(s)` : " · all channels"}
                        </div>
                      </div>
                      <div className={s.memberRole}>
                        <Dropdown options={ROLES} value={u.role} onChange={(v) => setRole(u.id, v)} />
                      </div>
                      <Button size="sm" variant={u.active ? "ghost" : "secondary"}
                              disabled={u.id === me?.id}
                              onClick={() => setActive(u.id, !u.active)}>
                        {u.active ? "Deactivate" : "Reactivate"}
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {message && <div className={message.ok ? s.okMessage : s.message}>{message.text}</div>}
            </div>

            <div className={scr.card}>
              <h2 className={scr.h2}>Roles</h2>
              <p className={scr.cardSub}>What each role can do. Enforced by the API, not by the screen.</p>
              <div className={s.roleGrid}>
                {ROLES.map((role) => (
                  <div key={role} className={s.roleCard}>
                    <div className={s.roleHead}>
                      <span className={s.roleName}>{role}</span>
                      <span className={s.roleCount}>{users.filter((u) => u.role === role).length}</span>
                    </div>
                    {ROLE_PERMS[role].map(([label, allowed]) => (
                      <div key={label} className={s.perm}>
                        <span className={`${s.permIcon}${allowed ? "" : " " + s.no}`}>
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            {allowed ? <path d="M3.5 8.5l3 3 6-6" /> : <path d="M4 4l8 8M12 4l-8 8" />}
                          </svg>
                        </span>
                        {label}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 3 && (
          <div className={scr.stack}>
            <div className={scr.card}>
              <h2 className={scr.h2}>Spend</h2>
              <p className={scr.cardSub}>
                Every metered operation, priced from contracts/prices.json when it completes.
              </p>
              <div className={s.totals}>
                <div className={s.total}>
                  <div className={s.totalLabel}>All time</div>
                  <div className={s.totalValue}>{money(totalSpend)}</div>
                  <div className={s.totalNote}>{totalOps} operations</div>
                </div>
                <div className={s.total}>
                  <div className={s.totalLabel}>Last 30 days</div>
                  <div className={s.totalValue}>{money(last30)}</div>
                  <div className={s.totalNote}>{(monitor?.costsByDay ?? []).length} days with activity</div>
                </div>
                <div className={s.total}>
                  <div className={s.totalLabel}>Channels</div>
                  <div className={s.totalValue}>{channels.length}</div>
                  <div className={s.totalNote}>each with its own per-video cap</div>
                </div>
              </div>
            </div>

            <div className={scr.card}>
              <h2 className={scr.h2}>Cost by provider</h2>
              <p className={scr.cardSub}>Where the money goes inside a render.</p>
              {(monitor?.costsByProvider ?? []).map((p) => (
                <div key={p.provider} className={s.costRow}>
                  <div className={s.costHead}>
                    <span className={s.costName}>{p.provider}</span>
                    <span className={s.costValue}>{money(p.usd)}</span>
                  </div>
                  <div className={s.track}>
                    <div className={s.fill} style={{ width: `${Math.round((p.usd / maxProvider) * 100)}%` }} />
                  </div>
                  <div className={s.costDetail}>{p.ops} operations</div>
                </div>
              ))}
              {(monitor?.costsByProvider ?? []).length === 0 && (
                <div className={scr.toggleDesc}>Nothing metered yet.</div>
              )}
            </div>
          </div>
        )}

        {tab === 4 && (
          <div className={scr.stack}>
            <div className={scr.card}>
              <h2 className={scr.h2}>Workers</h2>
              <p className={scr.cardSub}>A worker is alive if it has been seen in the last 30 seconds.</p>
              <div className={scr.stackTight}>
                {(monitor?.workers ?? []).map((w) => (
                  <div key={w.worker_id} className={s.monitorRow}>
                    <span className={`${s.pulse}${w.alive ? "" : " " + s.bad}`} />
                    <div className={s.monitorMain}>
                      <div className={s.monitorName}>{w.worker_id}</div>
                      <div className={s.monitorNote}>
                        last seen {new Date(w.last_seen).toLocaleString()}
                        {w.current_video_id ? ` · working on ${w.current_video_id}` : " · idle"}
                      </div>
                    </div>
                    <StatusBadge label={w.alive ? "Alive" : "Gone"} tone={w.alive ? "success" : "danger"} />
                  </div>
                ))}
                {(monitor?.workers ?? []).length === 0 && (
                  <div className={scr.toggleDesc}>No worker has ever checked in.</div>
                )}
              </div>
            </div>

            <div className={scr.card}>
              <h2 className={scr.h2}>Providers</h2>
              <p className={scr.cardSub}>
                Configured by environment. An unconfigured provider fails loudly at the stage that needs it.
              </p>
              <div className={scr.stackTight}>
                {(monitor?.providers ?? []).map((p) => {
                  const tone: Tone = !p.configured ? "neutral" : p.last_error_ts ? "warning" : "success";
                  const label = !p.configured ? "Not configured" : p.last_error_ts ? "Last call failed" : "Healthy";
                  return (
                    <div key={p.provider} className={s.monitorRow}>
                      <span className={`${s.pulse}${!p.configured ? " " + s.idle : p.last_error_ts ? " " + s.bad : ""}`} />
                      <div className={s.monitorMain}>
                        <div className={s.monitorName}>{p.provider}</div>
                        <div className={s.monitorNote}>
                          {p.last_error
                            ? `last error: ${p.last_error}`
                            : p.last_success_ts
                            ? `last success ${new Date(p.last_success_ts).toLocaleString()}`
                            : "never called"}
                        </div>
                      </div>
                      <StatusBadge label={label} tone={tone} />
                    </div>
                  );
                })}
                {(monitor?.providers ?? []).length === 0 && (
                  <div className={scr.toggleDesc}>No provider has reported health yet.</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
