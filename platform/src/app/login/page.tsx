"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (res.ok) router.push("/panel");
    else setError((await res.json()).error ?? "login failed");
  }

  return (
    <main style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
      <form onSubmit={submit} className="panel" style={{ width: 340, display: "grid", gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>lusora</h1>
        <input
          placeholder="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
        />
        <input
          placeholder="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
        <button className="primary" disabled={busy}>
          {busy ? "…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
