"use client";
import { useEffect, useState } from "react";

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  channels: string[];
}

export default function AdminPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [channels, setChannels] = useState<{ id: string }[]>([]);
  const [form, setForm] = useState({ email: "", name: "", password: "", role: "editor", channels: [] as string[] });
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  async function load() {
    const res = await fetch("/api/admin/users");
    if (res.status === 403 || res.status === 401) {
      setForbidden(true);
      return;
    }
    if (res.ok) setUsers(await res.json());
    const c = await fetch("/api/channels");
    if (c.ok) setChannels(await c.json());
  }
  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setForm({ email: "", name: "", password: "", role: "editor", channels: [] });
      load();
    } else setError((await res.json()).error);
  }

  async function patch(id: string, body: Record<string, unknown>) {
    await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    load();
  }

  if (forbidden) return <div className="panel">Admin role required.</div>;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <h1 style={{ margin: 0 }}>Admin — users & grants</h1>

      <form onSubmit={create} className="panel" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input placeholder="email" type="email" required value={form.email}
               onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input placeholder="name" required value={form.name}
               onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="password" type="password" required value={form.password}
               onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="admin">admin</option>
          <option value="manager">manager</option>
          <option value="editor">editor</option>
        </select>
        <select multiple value={form.channels} style={{ minWidth: 140, height: 60 }}
                onChange={(e) => setForm({ ...form, channels: [...e.target.selectedOptions].map((o) => o.value) })}>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>{c.id}</option>
          ))}
        </select>
        <button className="primary">Create user</button>
        {error && <span style={{ color: "var(--danger)", fontSize: 13 }}>{error}</span>}
      </form>

      <table>
        <thead>
          <tr><th>email</th><th>name</th><th>role</th><th>channels</th><th>active</th><th /></tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td>{u.name}</td>
              <td>
                <select value={u.role} onChange={(e) => patch(u.id, { role: e.target.value })}>
                  <option value="admin">admin</option>
                  <option value="manager">manager</option>
                  <option value="editor">editor</option>
                </select>
              </td>
              <td style={{ fontSize: 12 }}>{u.role === "admin" ? "all" : u.channels.join(", ") || "—"}</td>
              <td>{u.active ? "✓" : "—"}</td>
              <td>
                <button onClick={() => patch(u.id, { active: !u.active })}>
                  {u.active ? "Deactivate" : "Activate"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="panel" style={{ fontSize: 13, color: "var(--muted)" }}>
        Provider credentials live in <code>.env</code> (never in the DB — D18). Health is on the
        Monitoring screen.
      </div>
    </div>
  );
}
