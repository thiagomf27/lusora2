"use client";
/**
 * Prompts (M10, D42-D44). The editable half of every agent prompt, per role.
 *
 * The composed preview is the reason this screen exists: it shows the editable
 * text AND the welded contract block filled with real variables, so what you
 * read here is what the model reads. The welded half is displayed but never
 * editable (D43) — changing it would break the validator that judges the
 * output.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import s from "./prompts.module.css";

type Role = "script" | "planner" | "chat";
const ROLES: Role[] = ["script", "planner", "chat"];

interface PromptDoc {
  name: string;
  role: Role;
  video_type?: string;
  description?: string;
  system: string;
  user?: string;
  model_hint?: string | null;
  max_tokens?: number | null;
}

interface Row {
  doc: PromptDoc;
  errors: string[];
  usedBy: { kind: "channel" | "style_pack"; name: string }[];
  isDefault: boolean;
}

interface RoleDef {
  description: string;
  variables: Record<string, { required?: boolean; source?: string }>;
}

interface Payload {
  roles: Record<Role, RoleDef>;
  welded: Record<Role, { system: string; user: string }>;
  prompts: Row[];
}

interface Preview {
  system: string;
  user: string;
  errors: string[];
  output?: string;
  tokens?: number;
  usd?: number;
  ms?: number;
  finish_reason?: string | null;
}

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const key = (doc: { role: Role; name: string }) => `${doc.role}/${doc.name}`;

export default function PromptsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<PromptDoc | null>(null);
  const [draft, setDraft] = useState<PromptDoc | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [videoId, setVideoId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "saving" | "running" | "previewing">(null);
  const systemRef = useRef<HTMLTextAreaElement>(null);
  const userRef = useRef<HTMLTextAreaElement>(null);
  const focused = useRef<"system" | "user">("system");

  async function load(select?: string) {
    const res = await fetch("/api/prompts");
    if (!res.ok) return;
    const payload: Payload = await res.json();
    setData(payload);
    setSelected((prev) => select ?? prev ?? (payload.prompts[0] ? key(payload.prompts[0].doc) : null));
  }

  useEffect(() => {
    load();
  }, []);

  const current = useMemo(
    () => data?.prompts.find((r) => key(r.doc) === selected) ?? null,
    [data, selected]
  );
  const shown = editing ?? current?.doc ?? null;
  const dirty = Boolean(editing && current && JSON.stringify(editing) !== JSON.stringify(current.doc));
  const roleDef = shown && data ? data.roles[shown.role] : null;

  // Compose on the server so the preview uses the same renderer the agents do —
  // a second implementation here would drift and lie.
  useEffect(() => {
    if (!shown) return;
    setBusy("previewing");
    const body = JSON.stringify({ doc: shown, video_id: videoId || undefined });
    let cancelled = false;
    const timer = setTimeout(() => {
      fetch("/api/prompts/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((p) => {
          if (!cancelled) setPreview(p);
        })
        .catch(() => {})
        .finally(() => !cancelled && setBusy(null));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [shown, videoId]);

  function select(next: string) {
    if (next === selected) return;
    if (dirty && !confirm("Discard unsaved prompt changes?")) return;
    setEditing(null);
    setError(null);
    setSelected(next);
  }

  function insertVariable(name: string) {
    if (!editing) return;
    const which = focused.current;
    const ref = which === "system" ? systemRef.current : userRef.current;
    const token = `{{${name}}}`;
    const text = (which === "system" ? editing.system : editing.user) ?? "";
    const at = ref?.selectionStart ?? text.length;
    const next = text.slice(0, at) + token + text.slice(ref?.selectionEnd ?? at);
    setEditing({ ...editing, [which]: next });
    requestAnimationFrame(() => {
      ref?.focus();
      ref?.setSelectionRange(at + token.length, at + token.length);
    });
  }

  async function save() {
    if (!editing) return;
    setError(null);
    setBusy("saving");
    const res = await fetch(`/api/prompts/${editing.role}/${encodeURIComponent(editing.name)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editing),
    });
    setBusy(null);
    if (res.ok) {
      setEditing(null);
      load(key(editing));
    } else {
      setError((await res.json()).error ?? "failed");
    }
  }

  async function create() {
    if (!draft) return;
    setError(null);
    if (!NAME_RE.test(draft.name)) {
      setError("name must be lowercase letters, digits and dashes (e.g. doc-grave)");
      return;
    }
    setBusy("saving");
    const res = await fetch("/api/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    setBusy(null);
    if (res.ok) {
      const created = key(draft);
      setDraft(null);
      load(created);
    } else {
      setError((await res.json()).error ?? "failed");
    }
  }

  async function remove() {
    if (!current || current.isDefault) return;
    if (!confirm(`Delete prompt ${key(current.doc)}?`)) return;
    const res = await fetch(`/api/prompts/${current.doc.role}/${encodeURIComponent(current.doc.name)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setSelected(null);
      load();
    } else {
      setError((await res.json()).error ?? "failed");
    }
  }

  async function testRun() {
    if (!shown) return;
    setError(null);
    setBusy("running");
    const res = await fetch("/api/prompts/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc: shown, video_id: videoId || undefined, run: true }),
    });
    setBusy(null);
    if (res.ok) setPreview(await res.json());
    else setError((await res.json()).error ?? "failed");
  }

  const usedVars = new Set(
    [...String(shown?.system ?? "").matchAll(/\{\{[#/]?([a-z_][a-z0-9_]*)\}\}/g)].map((m) => m[1]).concat(
      [...String(shown?.user ?? "").matchAll(/\{\{[#/]?([a-z_][a-z0-9_]*)\}\}/g)].map((m) => m[1])
    )
  );

  return (
    <div className="page">
      <div className="pageHead">
        <div>
          <h1 className="pageTitle">Prompts</h1>
          <div className="pageSub">
            The editable half of each agent prompt. Resolution: video override → channel → style
            pack → default; the resolved text is snapshotted into the video at enqueue, so editing
            here never changes a video already in production.
          </div>
        </div>
        <button
          className="primary"
          onClick={() =>
            setDraft({ name: "", role: "script", description: "", system: "", user: "" })
          }
        >
          New prompt
        </button>
      </div>

      <div className={s.layout}>
        <div className={s.list}>
          {ROLES.map((role) => (
            <div key={role} style={{ display: "contents" }}>
              <div className={s.groupLabel}>{role.toUpperCase()}</div>
              {(data?.prompts ?? [])
                .filter((r) => r.doc.role === role)
                .map((r) => (
                  <button
                    key={key(r.doc)}
                    className={`${s.listItem}${key(r.doc) === selected ? " " + s.listActive : ""}`}
                    onClick={() => select(key(r.doc))}
                  >
                    <div className={s.itemName}>{r.doc.name}</div>
                    <div className={`${s.itemSub}${r.errors.length ? " " + s.itemBad : ""}`}>
                      {r.errors.length
                        ? `${r.errors.length} problem(s)`
                        : r.usedBy.length
                          ? `used by ${r.usedBy.length}`
                          : r.isDefault
                            ? "fallback for every channel"
                            : "unused"}
                    </div>
                  </button>
                ))}
            </div>
          ))}
        </div>

        <div className={s.detail}>
          {!shown ? (
            <div className={s.itemSub}>Select a prompt.</div>
          ) : (
            <>
              <div className={s.detailHead}>
                <div className={s.detailTitle}>
                  {shown.role}/{shown.name}
                  {current?.isDefault && <span className={s.badge}>default</span>}
                  {dirty && <span className={s.dirty}>unsaved</span>}
                </div>
                <div className={s.headActions}>
                  {editing ? (
                    <>
                      <button
                        onClick={() => {
                          if (dirty && !confirm("Discard unsaved prompt changes?")) return;
                          setEditing(null);
                        }}
                      >
                        Cancel
                      </button>
                      <button className="primary" onClick={save} disabled={busy === "saving"}>
                        {busy === "saving" ? "Saving…" : "Save"}
                      </button>
                    </>
                  ) : (
                    <>
                      {!current?.isDefault && <button onClick={remove}>Delete</button>}
                      <button onClick={() => setEditing({ ...shown })}>Edit</button>
                    </>
                  )}
                </div>
              </div>

              {roleDef && <div className={s.notice}>{roleDef.description}</div>}

              {(preview?.errors?.length ?? 0) > 0 && (
                <div className={s.errors}>
                  {preview!.errors.map((e) => (
                    <div key={e}>{e}</div>
                  ))}
                </div>
              )}
              {error && <div className={s.formError}>{error}</div>}

              <div className={s.editGrid}>
                <div className={s.section}>
                  <div className={s.sectionLabel}>EDITABLE</div>
                  {editing ? (
                    <>
                      <label className={s.field}>
                        <span className={s.fieldLabel}>description</span>
                        <input
                          className={s.input}
                          value={editing.description ?? ""}
                          onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                        />
                      </label>
                      <div className={s.vars}>
                        {Object.entries(roleDef?.variables ?? {}).map(([name, spec]) => (
                          <button
                            key={name}
                            className={`${s.varChip}${spec.required ? " " + s.varRequired : ""}${
                              usedVars.has(name) ? " " + s.varUsed : ""
                            }`}
                            title={spec.source ?? ""}
                            onClick={() => insertVariable(name)}
                          >
                            {`{{${name}}}`}
                            {spec.required ? " *" : ""}
                          </button>
                        ))}
                      </div>
                      <label className={s.field}>
                        <span className={s.fieldLabel}>system</span>
                        <textarea
                          ref={systemRef}
                          className={s.area}
                          value={editing.system}
                          onFocus={() => (focused.current = "system")}
                          onChange={(e) => setEditing({ ...editing, system: e.target.value })}
                        />
                      </label>
                      <label className={s.field}>
                        <span className={s.fieldLabel}>user</span>
                        <textarea
                          ref={userRef}
                          className={s.area}
                          value={editing.user ?? ""}
                          onFocus={() => (focused.current = "user")}
                          onChange={(e) => setEditing({ ...editing, user: e.target.value })}
                        />
                      </label>
                    </>
                  ) : (
                    <div className={s.preview}>
                      <div className={s.previewHalf}>
                        <div className={s.previewHead}>SYSTEM (template)</div>
                        <pre className={s.previewBody}>{shown.system}</pre>
                      </div>
                      {shown.user && (
                        <div className={s.previewHalf}>
                          <div className={s.previewHead}>USER (template)</div>
                          <pre className={s.previewBody}>{shown.user}</pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className={s.section}>
                  <div className={s.sectionLabel}>
                    COMPOSED — WHAT THE MODEL SEES
                    <input
                      className={s.input}
                      style={{ width: 190 }}
                      placeholder="video id (optional)"
                      value={videoId}
                      onChange={(e) => setVideoId(e.target.value.trim())}
                    />
                  </div>
                  <div className={s.preview}>
                    <div className={s.previewHalf}>
                      <div className={s.previewHead}>
                        SYSTEM {busy === "previewing" ? "…" : ""}
                      </div>
                      <pre className={s.previewBody}>{preview?.system ?? ""}</pre>
                    </div>
                    <div className={s.previewHalf}>
                      <div className={s.previewHead}>USER</div>
                      <pre className={s.previewBody}>{preview?.user ?? ""}</pre>
                    </div>
                  </div>
                  <div className={s.itemSub}>
                    Everything after the editable half is the welded contract block
                    (contracts/prompts/welded/{shown.role}.*) — it is composed at call time and
                    cannot be edited here.
                  </div>
                </div>
              </div>

              <div className={s.section}>
                <div className={s.sectionLabel}>
                  TEST RUN
                  <button onClick={testRun} disabled={busy === "running" || shown.role === "chat"}>
                    {busy === "running" ? "Running…" : "Run against DeepSeek"}
                  </button>
                </div>
                {shown.role === "chat" ? (
                  <div className={s.itemSub}>
                    Chat prompts run from the editor, against a real video.
                  </div>
                ) : preview?.output !== undefined ? (
                  <>
                    <div className={s.runMeta}>
                      {preview.tokens} tokens · ${preview.usd?.toFixed(4)} · {preview.ms} ms
                      {preview.finish_reason ? ` · ${preview.finish_reason}` : ""} · recorded as a
                      cost event
                    </div>
                    <div className={s.runOut}>{preview.output}</div>
                  </>
                ) : (
                  <div className={s.itemSub}>
                    Spends real money and is recorded in Monitoring like any other call.
                  </div>
                )}
              </div>

              <div className={s.section}>
                <div className={s.sectionLabel}>USED BY</div>
                {!current || current.usedBy.length === 0 ? (
                  <div className={s.itemSub}>
                    {current?.isDefault
                      ? "The fallback for every channel that names no prompt."
                      : "Nothing points at this prompt yet."}
                  </div>
                ) : (
                  <div className={s.chips}>
                    {current.usedBy.map((u) => (
                      <span key={`${u.kind}:${u.name}`} className={s.chip}>
                        {u.kind === "channel" ? "channel" : "style pack"} · {u.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {draft && (
        <div className={s.overlay} onClick={() => setDraft(null)}>
          <div className={s.modal} onClick={(e) => e.stopPropagation()}>
            <div className={s.modalHead}>
              <div className={s.modalTitle}>New prompt</div>
              <button onClick={() => setDraft(null)}>Close</button>
            </div>
            <label className={s.field}>
              <span className={s.fieldLabel}>role</span>
              <select
                className={s.input}
                value={draft.role}
                onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className={s.field}>
              <span className={s.fieldLabel}>name</span>
              <input
                className={s.input}
                value={draft.name}
                placeholder="doc-grave"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label className={s.field}>
              <span className={s.fieldLabel}>start from</span>
              <select
                className={s.input}
                defaultValue=""
                onChange={(e) => {
                  const from = data?.prompts.find((r) => key(r.doc) === e.target.value);
                  if (from) {
                    setDraft({
                      ...draft,
                      role: from.doc.role,
                      system: from.doc.system,
                      user: from.doc.user ?? "",
                    });
                  }
                }}
              >
                <option value="">blank</option>
                {(data?.prompts ?? []).map((r) => (
                  <option key={key(r.doc)} value={key(r.doc)}>
                    {key(r.doc)}
                  </option>
                ))}
              </select>
            </label>
            <label className={s.field}>
              <span className={s.fieldLabel}>description</span>
              <input
                className={s.input}
                value={draft.description ?? ""}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </label>
            <label className={s.field}>
              <span className={s.fieldLabel}>system</span>
              <textarea
                className={s.area}
                value={draft.system}
                onChange={(e) => setDraft({ ...draft, system: e.target.value })}
              />
            </label>
            <label className={s.field}>
              <span className={s.fieldLabel}>user</span>
              <textarea
                className={s.area}
                value={draft.user ?? ""}
                onChange={(e) => setDraft({ ...draft, user: e.target.value })}
              />
            </label>
            {error && <div className={s.formError}>{error}</div>}
            <div className={s.modalActions}>
              <button onClick={() => setDraft(null)}>Cancel</button>
              <button className="primary" onClick={create} disabled={busy === "saving"}>
                {busy === "saving" ? "Creating…" : "Create prompt"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
