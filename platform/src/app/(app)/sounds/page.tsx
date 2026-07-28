"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SoundBed, SoundCue, SoundPack } from "@lusora/contracts";
import s from "./sounds.module.css";

interface PackRow {
  name: string;
  doc: SoundPack | null;
  errors: string[];
  usage: Record<string, string[]>;
  missing: string[];
}

type Table = "cues" | "beds";
/** Discriminated on `table` so narrowing works in BOTH branches — a bare
 *  `spec: SoundCue | SoundBed` leaves the else-branch un-narrowed. */
type Item = { pack: string; key: string } & (
  | { table: "cues"; spec: SoundCue }
  | { table: "beds"; spec: SoundBed }
);

const MOODS = [
  "neutral", "tense", "somber", "hopeful",
  "urgent", "triumphant", "reflective", "playful",
] as const;

const LICENSES = ["cc0", "cc-by", "cc-by-sa", "owned", "stock-licensed", "unknown"] as const;

/** The two levels a theme applies, so the preview slider starts somewhere real. */
const DEFAULT_GAIN = { cues: 0.32, beds: 0.16 };

export default function SoundsPage() {
  const [packs, setPacks] = useState<PackRow[] | null>(null);
  const [packFilter, setPackFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Item | null>(null);
  const [gain, setGain] = useState(0.32);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showPack, setShowPack] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function load(keep?: string) {
    const res = await fetch("/api/sounds");
    const rows: PackRow[] = res.ok ? await res.json() : [];
    setPacks(rows);
    if (keep) setSelected(keep);
  }
  useEffect(() => {
    load();
  }, []);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const row of packs ?? []) {
      if (!row.doc) continue;
      for (const [key, spec] of Object.entries(row.doc.cues ?? {})) out.push({ pack: row.name, table: "cues", key, spec });
      for (const [key, spec] of Object.entries(row.doc.beds ?? {})) out.push({ pack: row.name, table: "beds", key, spec });
    }
    return out;
  }, [packs]);

  const id = (i: Item) => `${i.pack}/${i.table}/${i.key}`;
  const current = items.find((i) => id(i) === selected) ?? null;
  const currentPack = (packs ?? []).find((p) => p.name === current?.pack) ?? null;
  const usedBy = current ? currentPack?.usage[current.key] ?? [] : [];
  const fileMissing = current ? (currentPack?.missing ?? []).includes(current.key) : false;

  // reset the editor and the level preview when the selection changes
  useEffect(() => {
    setDraft(null);
    setError(null);
    if (current) setGain(DEFAULT_GAIN[current.table]);
  }, [selected]);

  // keep the preview level live while dragging
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = Math.min(Math.max(gain, 0), 1);
  }, [gain, selected]);

  const packNames = useMemo(() => ["all", ...(packs ?? []).map((p) => p.name)], [packs]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (packFilter !== "all" && i.pack !== packFilter) return false;
      if (!q) return true;
      return i.key.toLowerCase().includes(q) || ("mood" in i.spec && String(i.spec.mood).includes(q));
    });
  }, [items, query, packFilter]);

  const grouped = useMemo(() => {
    const out = new Map<string, Item[]>();
    for (const i of visible) {
      const label = `${i.pack} · ${i.table === "cues" ? "cues" : "beds"}`;
      out.set(label, [...(out.get(label) ?? []), i]);
    }
    return [...out.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [visible]);

  const value = draft ?? current;

  function patch(next: Partial<SoundCue & SoundBed>) {
    const base = draft ?? current;
    if (!base) return;
    // the cast re-ties spec to `table`; every caller is inside a branch that
    // already knows which of the two it is editing
    setDraft({ ...base, spec: { ...base.spec, ...next } } as Item);
  }

  async function save() {
    if (!draft || !currentPack?.doc) return;
    setBusy(true);
    setError(null);
    const doc = structuredClone(currentPack.doc);
    (doc[draft.table] as Record<string, unknown>)[draft.key] = draft.spec;
    const res = await fetch(`/api/sounds/${draft.pack}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(doc),
    });
    setBusy(false);
    if (res.ok) {
      setDraft(null);
      load(selected ?? undefined);
      setNotice(`Saved ${draft.key}.`);
    } else setError((await res.json()).error ?? "failed");
  }

  async function removeEntry() {
    if (!current) return;
    if (!confirm(`Delete ${current.key} from ${current.pack}? The audio file goes too.`)) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/sounds/${current.pack}/entries/${current.key}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      setSelected(null);
      setNotice(`Deleted ${current.key}.`);
      load();
    } else setError((await res.json()).error ?? "failed");
  }

  async function deletePack() {
    if (packFilter === "all") return;
    if (!confirm(`Delete the whole "${packFilter}" pack and every sound in it?`)) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/sounds/${packFilter}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      setPackFilter("all");
      setSelected(null);
      setNotice(`Deleted pack "${packFilter}".`);
      load();
    } else setError((await res.json()).error ?? "failed");
  }

  const totalErrors = (packs ?? []).flatMap((p) => p.errors);
  const totalMissing = (packs ?? []).flatMap((p) => p.missing.map((m) => `${p.name}: ${m}`));

  return (
    <div className="page">
      <div className="pageHead">
        <div>
          <h1 className="pageTitle">Sounds</h1>
          <div className="pageSub">
            {packs ? items.length : "…"} sounds across {(packs ?? []).length} pack
            {(packs ?? []).length === 1 ? "" : "s"} · the only cues and beds a theme may name
          </div>
        </div>
        <div className={s.headActions}>
          <button onClick={() => { setError(null); setNotice(null); setShowPack(true); }}>New pack</button>
          <button
            className="primary"
            disabled={!packs?.length}
            onClick={() => { setError(null); setNotice(null); setShowAdd(true); }}
          >
            Add sound
          </button>
        </div>
      </div>

      {notice && <div className={s.okNotice}>{notice}</div>}
      {(totalErrors.length > 0 || totalMissing.length > 0) && (
        <div className={s.errors}>
          <div className={s.errTitle}>Sound pack problems</div>
          {totalErrors.map((e, i) => <div key={`e${i}`} className={s.errLine}>{e}</div>)}
          {totalMissing.map((m, i) => (
            <div key={`m${i}`} className={s.errLine}>{m} — manifest names a file that is not on disk</div>
          ))}
        </div>
      )}

      <div className={s.layout}>
        <div className={s.sidebar}>
          <input
            className={s.search}
            name="search"
            placeholder="Search name or mood…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className={s.packTabs}>
            {packNames.map((p) => (
              <button
                key={p}
                className={`${s.packTab}${packFilter === p ? " " + s.packTabOn : ""}`}
                onClick={() => setPackFilter(p)}
              >
                {p}
              </button>
            ))}
          </div>
          {packFilter !== "all" && (
            <div className={s.packBar}>
              <button className={s.packLink} onClick={deletePack} disabled={busy}>
                delete pack
              </button>
            </div>
          )}

          <div className={s.list}>
            {grouped.map(([label, group]) => (
              <div key={label}>
                <div className={s.groupLabel}>{label} · {group.length}</div>
                {group.map((i) => {
                  const packRow = (packs ?? []).find((p) => p.name === i.pack);
                  const missing = (packRow?.missing ?? []).includes(i.key);
                  const used = (packRow?.usage[i.key] ?? []).length > 0;
                  return (
                    <button
                      key={id(i)}
                      className={`${s.listItem}${id(i) === selected ? " " + s.listActive : ""}`}
                      onClick={() => setSelected(id(i))}
                    >
                      <span className={s.itemName}>{i.key}</span>
                      {missing ? <span className={s.warnDot} title="file missing" />
                        : used ? <span className={s.usedDot} title="used by a theme" /> : null}
                      <span className={s.itemMeta}>
                        {i.table === "cues" ? i.spec.kind.replace("_", " ") : i.spec.mood} ·{" "}
                        {i.spec.duration_s.toFixed(2)}s
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
            {visible.length === 0 && <div className={s.empty}>Nothing matches.</div>}
          </div>
        </div>

        <div className={s.detail}>
          {!current && <div className={s.empty}>Select a sound to hear it.</div>}
          {current && value && (
            <>
              <div className={s.detailHead}>
                <div>
                  <div className={s.detailTitle}>
                    {current.key}
                    <span className={s.badge}>{current.pack}</span>
                    <span className={s.badge}>{current.table === "cues" ? "cue" : "bed"}</span>
                    <span className={s.badgeOk}>
                      {current.table === "cues" ? current.spec.kind.replace("_", " ") : current.spec.mood}
                    </span>
                    {fileMissing && <span className={s.badgeWarn}>file missing</span>}
                    {draft && <span className={s.badgeWarn}>editing</span>}
                  </div>
                  <div className={s.detailSub}>
                    contracts/sound-packs/{current.pack}/{current.spec.file}
                  </div>
                </div>
                <div className={s.headActions}>
                  {draft ? (
                    <>
                      <button onClick={() => setDraft(null)}>Cancel</button>
                      <button className="primary" onClick={save} disabled={busy}>
                        {busy ? "Saving…" : "Save"}
                      </button>
                    </>
                  ) : (
                    <button onClick={removeEntry} disabled={busy}>Delete</button>
                  )}
                </div>
              </div>

              {error && <div className={s.formError}>{error}</div>}

              {/* Listen */}
              <div className={s.player}>
                <audio
                  ref={audioRef}
                  className={s.audio}
                  controls
                  preload="metadata"
                  src={`/api/sounds/${current.pack}/audio/${current.spec.file}`}
                />
                <div className={s.gainRow}>
                  <span>preview at gain</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={gain}
                    onChange={(e) => setGain(Number(e.target.value))}
                  />
                  <span className={s.playerMeta}>{gain.toFixed(2)}</span>
                </div>
                <div className={s.hint}>
                  The slider is the level a theme applies (<code>gain.sfx</code> for a cue,{" "}
                  <code>gain.music_duck</code>/<code>music_lift</code> for a bed) — it changes
                  playback only, never the file. Judge a cue against narration, not in silence.
                </div>
              </div>

              {/* What the compiler reads */}
              <div className={s.section}>
                <div className={s.sectionLabel}>WHAT THE COMPILER READS</div>
                <div className={s.locked}>
                  duration_s {current.spec.duration_s.toFixed(3)}s — probed from the file on upload,
                  not editable. The compiler sizes one-shot cues from it.
                </div>
                <div className={s.fields}>
                  {current.table === "cues" ? (
                    <>
                      <label className={s.field}>
                        <span className={s.fieldLabel}>kind</span>
                        <select
                          value={(value.spec as SoundCue).kind}
                          onChange={(e) => patch({ kind: e.target.value as SoundCue["kind"] })}
                        >
                          <option value="one_shot">one_shot</option>
                          <option value="loop">loop</option>
                        </select>
                      </label>
                      <label className={s.field}>
                        <span className={s.fieldLabel}>lead_s</span>
                        <input
                          type="number" min={0} step={0.01}
                          value={(value.spec as SoundCue).lead_s ?? ""}
                          placeholder="0"
                          onChange={(e) => patch({ lead_s: e.target.value === "" ? undefined : Number(e.target.value) })}
                        />
                      </label>
                      <label className={s.field}>
                        <span className={s.fieldLabel}>priority</span>
                        <input
                          type="number" min={0} step={1}
                          value={(value.spec as SoundCue).priority ?? ""}
                          placeholder="0"
                          onChange={(e) => patch({ priority: e.target.value === "" ? undefined : Number(e.target.value) })}
                        />
                      </label>
                      <label className={s.field}>
                        <span className={s.fieldLabel}>gain</span>
                        <input
                          type="number" min={0} max={1} step={0.01}
                          value={value.spec.gain ?? ""}
                          placeholder="1 (no trim)"
                          onChange={(e) => patch({ gain: e.target.value === "" ? undefined : Number(e.target.value) })}
                        />
                      </label>
                      <label className={s.field}>
                        <span className={s.fieldLabel}>fade_out_s</span>
                        <input
                          type="number" min={0} step={0.01}
                          value={(value.spec as SoundCue).fade_out_s ?? ""}
                          placeholder="0"
                          onChange={(e) => patch({ fade_out_s: e.target.value === "" ? undefined : Number(e.target.value) })}
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <label className={s.field}>
                        <span className={s.fieldLabel}>mood</span>
                        <select
                          value={(value.spec as SoundBed).mood}
                          onChange={(e) => patch({ mood: e.target.value as SoundBed["mood"] })}
                        >
                          {MOODS.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </label>
                      <label className={s.field}>
                        <span className={s.fieldLabel}>loopable</span>
                        <select
                          value={String((value.spec as SoundBed).loopable ?? true)}
                          onChange={(e) => patch({ loopable: e.target.value === "true" })}
                        >
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      </label>
                      <label className={s.field}>
                        <span className={s.fieldLabel}>gain</span>
                        <input
                          type="number" min={0} max={1} step={0.01}
                          value={value.spec.gain ?? ""}
                          placeholder="1 (no trim)"
                          onChange={(e) => patch({ gain: e.target.value === "" ? undefined : Number(e.target.value) })}
                        />
                      </label>
                    </>
                  )}
                </div>
                <div className={s.hint}>
                  {current.table === "cues"
                    ? "lead_s starts the cue BEFORE the visual it belongs to, so its transient lands on the entrance instead of beginning there. priority decides which cue survives when two collide inside the style pack's min_gap_s."
                    : "A bed with loopable false is never extended past its own length; a mood span longer than the file simply ends early."}
                </div>
              </div>

              {/* Who names it */}
              <div className={s.section}>
                <div className={s.sectionLabel}>NAMED BY</div>
                {usedBy.length ? (
                  <>
                    <div className={s.chips}>
                      {usedBy.map((t) => <span key={t} className={s.chip}>{t}</span>)}
                    </div>
                    <div className={s.hint}>
                      Deleting is refused while a theme names this sound — a theme pointing at a
                      cue that no longer exists fails the next video at compile.
                    </div>
                  </>
                ) : (
                  <div className={s.hint}>
                    No theme names this sound yet, so it is never played. Point a theme&apos;s{" "}
                    <code>sound.{current.table === "cues" ? "entrance / per_entrance" : "mood_beds"}</code>{" "}
                    at <code>{current.key}</code> on the Themes screen.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {showAdd && (
        <AddSound
          packs={(packs ?? []).map((p) => p.name)}
          initialPack={packFilter === "all" ? (packs ?? [])[0]?.name ?? "" : packFilter}
          onClose={() => setShowAdd(false)}
          onDone={(pack, table, key, msg) => {
            setShowAdd(false);
            setNotice(msg);
            setPackFilter(pack);
            load(`${pack}/${table}/${key}`);
          }}
        />
      )}
      {showPack && (
        <NewPack
          onClose={() => setShowPack(false)}
          onDone={(name) => {
            setShowPack(false);
            setPackFilter(name);
            setNotice(`Created pack "${name}". Add sounds to it.`);
            load();
          }}
        />
      )}
    </div>
  );
}

/** Upload a file and register it. Duration is probed server-side. */
function AddSound({
  packs,
  initialPack,
  onClose,
  onDone,
}: {
  packs: string[];
  initialPack: string;
  onClose: () => void;
  onDone: (pack: string, table: Table, key: string, msg: string) => void;
}) {
  const [pack, setPack] = useState(initialPack);
  const [table, setTable] = useState<Table>("cues");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<SoundCue["kind"]>("one_shot");
  const [mood, setMood] = useState<SoundBed["mood"]>("neutral");
  const [normalize, setNormalize] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!file) return setError("choose an audio file");
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("name", name);
    form.set("table", table);
    form.set("normalize", normalize ? "1" : "0");
    if (table === "cues") form.set("kind", kind);
    else form.set("mood", mood);
    form.set("file", file);
    const res = await fetch(`/api/sounds/${pack}/entries`, { method: "POST", body: form });
    setBusy(false);
    if (res.ok) {
      const body = await res.json();
      onDone(pack, table, name, `${body.replaced ? "Replaced" : "Added"} ${name} · ${body.duration_s}s probed.`);
    } else setError((await res.json()).error ?? "failed");
  }

  return (
    <div className={s.modalBack} onClick={onClose}>
      <div className={s.modal} onClick={(e) => e.stopPropagation()}>
        <div className={s.modalTitle}>Add sound</div>
        {error && <div className={s.formError}>{error}</div>}

        <label className={s.field}>
          <span className={s.fieldLabel}>pack</span>
          <select value={pack} onChange={(e) => setPack(e.target.value)}>
            {packs.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>

        <div className={s.radioRow}>
          {(["cues", "beds"] as Table[]).map((t) => (
            <button
              key={t}
              className={`${s.radio}${table === t ? " " + s.radioOn : ""}`}
              onClick={() => setTable(t)}
            >
              {t === "cues" ? "cue (sfx)" : "bed (music)"}
            </button>
          ))}
        </div>

        <label className={s.field}>
          <span className={s.fieldLabel}>name</span>
          <input
            value={name}
            placeholder={table === "cues" ? "swoosh-soft" : "tense-01"}
            spellCheck={false}
            onChange={(e) => setName(e.target.value.trim())}
          />
          <span className={s.hint}>
            Lowercase, digits and dashes. This is what a theme will name, and the filename the
            worker copies into the video folder. Reusing an existing name replaces its file.
          </span>
        </label>

        {table === "cues" ? (
          <label className={s.field}>
            <span className={s.fieldLabel}>kind</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as SoundCue["kind"])}>
              <option value="one_shot">one_shot — plays at its own length</option>
              <option value="loop">loop — fills the entrance window (a typing bed)</option>
            </select>
          </label>
        ) : (
          <label className={s.field}>
            <span className={s.fieldLabel}>mood</span>
            <select value={mood} onChange={(e) => setMood(e.target.value as SoundBed["mood"])}>
              {MOODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        )}

        <label className={s.field}>
          <span className={s.fieldLabel}>file</span>
          <input
            type="file"
            accept=".mp3,.wav,.m4a,.ogg,.flac,audio/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <span className={s.hint}>
            The duration is probed from the file and written into the manifest — it is never
            typed. A wrong duration makes a cue end early or overrun its window, and nothing
            complains until someone listens.
          </span>
        </label>

        <label className={s.check}>
          <input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} />
          Normalize on upload ({table === "cues" ? "peak to -6 dBFS" : "loudness to -24 LUFS"})
        </label>
        <div className={s.hint}>
          Cues are normalized by peak and beds by loudness, which is not an inconsistency:
          integrated loudness of a 0.4s transient is close to meaningless, so loudness-normalizing
          a swoosh makes it clipping-hot. One ceiling per pack is what makes a theme&apos;s gain a
          predictable trim rather than a per-file guess.
        </div>

        <div className={s.modalActions}>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={submit} disabled={busy || !name || !file}>
            {busy ? "Uploading…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

function NewPack({ onClose, onDone }: { onClose: () => void; onDone: (name: string) => void }) {
  const [name, setName] = useState("");
  const [license, setLicense] = useState<(typeof LICENSES)[number]>("cc0");
  const [attribution, setAttribution] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/sounds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, license, attribution: attribution || undefined }),
    });
    setBusy(false);
    if (res.ok) onDone(name);
    else setError((await res.json()).error ?? "failed");
  }

  return (
    <div className={s.modalBack} onClick={onClose}>
      <div className={s.modal} onClick={(e) => e.stopPropagation()}>
        <div className={s.modalTitle}>New sound pack</div>
        {error && <div className={s.formError}>{error}</div>}
        <label className={s.field}>
          <span className={s.fieldLabel}>name</span>
          <input
            value={name}
            placeholder="doc-restrained"
            spellCheck={false}
            onChange={(e) => setName(e.target.value.trim())}
          />
          <span className={s.hint}>Lowercase, digits and dashes — it is also the folder name.</span>
        </label>
        <label className={s.field}>
          <span className={s.fieldLabel}>license</span>
          <select value={license} onChange={(e) => setLicense(e.target.value as typeof license)}>
            {LICENSES.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <span className={s.hint}>
            Pack-wide, because that is what makes a channel&apos;s anti-copyright rule checkable.
            Mixing licenses means splitting the pack in two.
          </span>
        </label>
        <label className={s.field}>
          <span className={s.fieldLabel}>attribution</span>
          <input
            value={attribution}
            placeholder="credit line, if the license needs one"
            onChange={(e) => setAttribution(e.target.value)}
          />
        </label>
        <div className={s.modalActions}>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={submit} disabled={busy || !name}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
