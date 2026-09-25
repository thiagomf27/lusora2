"use client";

/**
 * The directed-edit paste box (docs/05-roadmap/directed-edit-test.md, slice 3).
 *
 * One text box: the script, then Claude's block between the markers. It
 * offers the edit-pass prompt to copy, checks the paste on the server (no
 * model, no cost), and splits what it finds by who has to act:
 *  - block errors come with a ready-to-paste repair request for Claude;
 *  - script problems are the human's — Claude must never touch the narration.
 *
 * Checks run on PASTE and on the Check button, never per keystroke: every
 * distinct block checked is logged as a round-trip, and typing is not one.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ds";
import s from "./EditPasteBox.module.css";

const MARKER = "===LUSORA EDIT v1===";
/** DEFAULT_WPM in lib/editHints.ts, which is server-only (it reads the catalog
 *  from disk). Only the hint before a check uses it; the check reports the
 *  server's own estimate. */
const WPM = 142;

interface Verdict {
  ok: boolean;
  errors: string[];
  warnings: string[];
  scriptErrors: string[];
  pasteBack: string | null;
  stats: { words: number; estimatedSeconds: number; sections: number; pins: number; graphics: number; shots: number } | null;
  attempt: number;
}

function newSession(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/** Words in the script half — what the prompt's budgets are estimated from. */
function scriptWords(text: string): number {
  const head = text.includes(MARKER) ? text.slice(0, text.indexOf(MARKER)) : text;
  return head.split(/\s+/).filter(Boolean).length;
}

function duration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return m ? `${m}m${String(seconds % 60).padStart(2, "0")}s` : `${seconds}s`;
}

export function EditPasteBox({
  channelId,
  overrides,
  value,
  onChange,
  session,
  onSession,
}: {
  channelId: string;
  overrides: Record<string, unknown> | undefined;
  value: string;
  onChange: (text: string) => void;
  session: string;
  onSession: (id: string) => void;
}) {
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [checkedText, setCheckedText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const pending = useRef<string | null>(null);

  const check = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      const id = session || newSession();
      if (!session) onSession(id);
      setBusy(true);
      try {
        const res = await fetch("/api/edit-hints/check", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ channel_id: channelId, overrides, text, paste_session: id }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setVerdict(null);
          setNote(body.error ?? `check failed (${res.status})`);
          return;
        }
        setVerdict(body as Verdict);
        setCheckedText(text);
        setNote(null);
      } finally {
        setBusy(false);
      }
    },
    [channelId, overrides, session, onSession]
  );

  // A paste lands in `value` on the next render; check it once it has.
  useEffect(() => {
    if (pending.current !== null && pending.current === value) {
      pending.current = null;
      void check(value);
    }
  }, [value, check]);

  async function copyPrompt() {
    const res = await fetch("/api/edit-hints/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel_id: channelId, overrides, words: scriptWords(value) || undefined }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNote(body.error ?? `could not build the prompt (${res.status})`);
      return;
    }
    await navigator.clipboard.writeText(body.prompt);
    const words = scriptWords(value);
    setNote(
      `Edit-pass prompt copied (${body.style_pack}, ${body.components ?? "all"} components` +
        `${words ? `, budgets for ~${duration(Math.round((words * 60) / WPM))}` : ", budgets per minute"}). ` +
        "Paste it into a new Claude chat, then your script below it."
    );
  }

  const stale = verdict !== null && checkedText !== value;
  const words = scriptWords(value);

  return (
    <div className={s.box}>
      <div className={s.head}>
        <div className={s.title}>Directed edit — script + edit block</div>
        <span className={s.note}>Optional · test mode</span>
      </div>
      <div className={s.hint}>
        Paste the final script, then Claude&apos;s block from <code>{MARKER}</code> to <code>===END===</code>.
        Only a pipeline that runs the edit_hints stage accepts it.
      </div>
      <textarea
        className={s.area}
        value={value}
        spellCheck={false}
        placeholder={`<the script, exactly as written>\n\n${MARKER}\n{ … }\n===END===`}
        onChange={(e) => onChange(e.currentTarget.value)}
        onPaste={(e) => {
          const el = e.currentTarget;
          const pasted = e.clipboardData.getData("text");
          pending.current =
            el.value.slice(0, el.selectionStart) + pasted + el.value.slice(el.selectionEnd);
        }}
      />
      <div className={s.actions}>
        <Button size="sm" variant="secondary" onClick={copyPrompt}>
          Copy edit-pass prompt
        </Button>
        <Button size="sm" variant="outline" disabled={busy || !value.trim()} onClick={() => check(value)}>
          {busy ? "Checking…" : "Check"}
        </Button>
        {value && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onChange("");
              onSession("");
              setVerdict(null);
              setCheckedText(null);
            }}
          >
            Clear
          </Button>
        )}
        {words > 0 && <span className={s.hint}>{words} words · ~{duration(Math.round((words * 60) / WPM))}</span>}
      </div>

      {note && <div className={`${s.status} ${s.stale}`}>{note}</div>}

      {verdict && (
        <>
          <div className={`${s.status} ${stale ? s.stale : verdict.ok ? s.ok : s.bad}`}>
            {stale
              ? "Changed since the last check — check again."
              : verdict.ok
                ? `Ready — ${verdict.stats?.sections} sections, ${verdict.stats?.pins} pins ` +
                  `(${verdict.stats?.graphics} graphics, ${verdict.stats?.shots} key shots), ` +
                  `~${duration(verdict.stats?.estimatedSeconds ?? 0)} · attempt ${verdict.attempt}`
                : `Not ready · attempt ${verdict.attempt}`}
          </div>

          {verdict.scriptErrors.length > 0 && (
            <div className={s.group}>
              <div className={s.groupTitle}>Your script — fix it yourself; Claude must not change it</div>
              <ul className={s.list}>
                {verdict.scriptErrors.map((e) => <li key={e} className={s.errorItem}>{e}</li>)}
              </ul>
            </div>
          )}
          {verdict.errors.length > 0 && (
            <div className={s.group}>
              <div className={s.groupTitle}>The block</div>
              <ul className={s.list}>
                {verdict.errors.map((e) => <li key={e} className={s.errorItem}>{e}</li>)}
              </ul>
            </div>
          )}
          {verdict.warnings.length > 0 && (
            <div className={s.group}>
              <div className={s.groupTitle}>Warnings — accept or fix</div>
              <ul className={s.list}>
                {verdict.warnings.map((w) => <li key={w} className={s.warnItem}>{w}</li>)}
              </ul>
            </div>
          )}
          {verdict.pasteBack && (
            <div className={s.group}>
              <div className={s.head}>
                <div className={s.groupTitle}>Send this back to Claude</div>
                <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(verdict.pasteBack!)}>
                  Copy fix request
                </Button>
              </div>
              <pre className={s.pasteBack}>{verdict.pasteBack}</pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}
