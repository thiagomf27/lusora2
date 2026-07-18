"use client";
import { useEffect, useState } from "react";

interface Segment {
  id?: string;
  segment_id?: string;
  score?: number;
  media_type?: string;
  license?: string;
  tags?: string[];
  thumb_url?: string;
  description?: string;
}

export default function LibraryPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Segment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ingestUrl, setIngestUrl] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/library/search?query=${encodeURIComponent(query)}&limit=24`);
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      setResults(data.results ?? data ?? []);
    } else {
      setError((await res.json()).error ?? "search failed");
    }
  }

  useEffect(() => {
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ingest(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const res = await fetch(`/api/library/ingest_url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: ingestUrl }),
    });
    const body = await res.json().catch(() => ({}));
    setMessage(res.ok ? `ingest job started: ${JSON.stringify(body)}` : body.error ?? "ingest failed");
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <h1 style={{ margin: 0 }}>Library</h1>

      <form onSubmit={search} style={{ display: "flex", gap: 8 }}>
        <input style={{ flex: 1 }} placeholder="scout-style search: 'aerial view of a 1940s harbor, cranes…'"
               value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="primary" disabled={busy}>Search</button>
      </form>

      <form onSubmit={ingest} style={{ display: "flex", gap: 8 }}>
        <input style={{ flex: 1 }} placeholder="ingest URL (YouTube, archive.org…)"
               value={ingestUrl} onChange={(e) => setIngestUrl(e.target.value)} />
        <button disabled={!ingestUrl}>Ingest</button>
      </form>

      {message && <div className="panel" style={{ fontSize: 13 }}>{message}</div>}
      {error && (
        <div className="panel" style={{ color: "var(--danger)" }}>
          {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
        {results.map((s, i) => (
          <div key={i} className="panel" style={{ padding: 10, fontSize: 12 }}>
            {s.thumb_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.thumb_url} alt="" style={{ width: "100%", borderRadius: 6, aspectRatio: "16/9", objectFit: "cover" }} />
            ) : (
              <div style={{ aspectRatio: "16/9", background: "#000", borderRadius: 6 }} />
            )}
            <div style={{ marginTop: 6 }}>{s.description ?? s.id ?? s.segment_id}</div>
            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--muted)", marginTop: 4 }}>
              <span>{s.media_type ?? "?"}</span>
              <span>{s.license ?? "license?"}</span>
              <span>{s.score !== undefined ? s.score.toFixed(2) : ""}</span>
            </div>
          </div>
        ))}
        {!error && results.length === 0 && <div style={{ color: "var(--muted)" }}>no results</div>}
      </div>
    </div>
  );
}
