/**
 * The directed-edit paste: one text box holding the script, then the block.
 *
 *     <script text, exactly as written>
 *
 *     ===LUSORA EDIT v1===
 *     { …the block… }
 *     ===END===
 *
 * docs/05-roadmap/directed-edit-test.md, slice 3. This module splits the paste,
 * judges both halves, writes the round-trip log, and — when a video is created
 * from it — writes script.txt, edit_hints.json and edit_pass.json into the
 * folder.
 *
 * Two kinds of problem, kept apart on purpose, because they go to different
 * people:
 *  - SCRIPT problems (markdown, speaker labels, emoji…) are about the pasted
 *    narration, which the edit pass may never change. They go to the human.
 *  - BLOCK problems go back to Claude, as a ready-to-paste repair request
 *    (`pasteBack`). Sending Claude a script problem would invite it to "fix"
 *    the narration, which is the one thing it must not do.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_WPM, validateEditHints, type EditHints } from "./editHints.ts";
import { resolveStyleForConfig } from "./editPassPrompt.ts";

export const EDIT_MARKER = "===LUSORA EDIT v1===";
export const END_MARKER = "===END===";

/** A line that is only a code fence — Claude often wraps its answer in one. */
const FENCE = /^\s*```[\w-]*\s*$/;

export interface SplitPaste {
  script: string;
  /** The JSON between the markers, fences removed. */
  blockText: string;
}

/**
 * Script half and block half, or the reason the paste has no such shape.
 * Tolerates CRLF, code fences around the block or around the whole answer,
 * and commentary after the end marker. Refuses a second marker: two blocks
 * in one paste is a paste mistake, and guessing which one was meant is worse
 * than asking.
 */
export function splitEditPaste(raw: string): { ok: true; value: SplitPaste } | { ok: false; error: string } {
  const text = raw.replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const markers = lines.flatMap((line, i) => (line.trim() === EDIT_MARKER ? [i] : []));
  if (markers.length === 0) {
    return { ok: false, error: `no ${EDIT_MARKER} line — paste the script, then Claude's block below it` };
  }
  if (markers.length > 1) {
    return { ok: false, error: `${EDIT_MARKER} appears ${markers.length} times — paste exactly one block` };
  }
  const at = markers[0];
  const end = lines.findIndex((line, i) => i > at && line.trim() === END_MARKER);
  if (end === -1) return { ok: false, error: `no ${END_MARKER} line after the block — paste the whole block` };

  const before = lines.slice(0, at);
  while (before.length && (FENCE.test(before[before.length - 1]) || !before[before.length - 1].trim())) {
    before.pop();
  }
  const script = before.join("\n").trim();
  if (!script) return { ok: false, error: `nothing above ${EDIT_MARKER} — the script goes first` };

  const blockText = lines
    .slice(at + 1, end)
    .filter((line) => !FENCE.test(line))
    .join("\n")
    .trim();
  if (!blockText) return { ok: false, error: `the block between ${EDIT_MARKER} and ${END_MARKER} is empty` };
  return { ok: true, value: { script, blockText } };
}

// ---------------- the script's own rules ----------------

/**
 * What the worker's `validate_script` demands of narration, mirrored for a
 * pasted script: an uploaded script.txt skips the script stage, so without
 * this nothing would stop `**bold**` reaching the TTS (three shipped videos
 * had it read aloud). Same patterns, same messages; the shared expectation
 * table is contracts/fixtures/rules/script_rules.json. Change both.
 */
const SCRIPT_RULES: [RegExp, string][] = [
  [/^\s{0,3}#{1,6}\s/m, "a markdown heading — the narration is spoken aloud, so a heading is read out as words"],
  [/\*\*[^*\n]+\*\*|__[^_\n]+__/, "markdown bold — the asterisks are spoken by the TTS"],
  [/(?<![\p{L}\p{N}_*])\*[^*\n]+\*(?![\p{L}\p{N}_*])/u, "markdown italics — the asterisks are spoken by the TTS"],
  [/^\s{0,3}[-*+]\s+\S/m, "a bullet list — narration is sentences, and a bullet is read as a dash"],
  [
    /^\s*(narrator|host|voice ?over|vo|speaker|announcer)\s*:/im,
    "a speaker label — there is one voice and it does not announce itself",
  ],
  [/^\s*[A-Z][A-Z ]{2,20}:/m, "an all-caps label at the start of a line — it will be read aloud"],
  [/\[[^\]\n]{1,120}\]/, "a bracketed stage direction or note — anything in the file is spoken"],
  [
    /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\uFE0F]/u,
    "an emoji — it has no spoken form and the TTS will either skip it or name it",
  ],
];

/** Python's `repr` of a short string, so the two languages print the same. */
function pyStr(text: string): string {
  return text.includes("'") && !text.includes('"') ? `"${text}"` : `'${text.replace(/'/g, "\\'")}'`;
}

export function validateScript(text: string): string[] {
  if (!text.trim()) return ["the script is empty"];
  const out: string[] = [];
  for (const [pattern, message] of SCRIPT_RULES) {
    const found = pattern.exec(text);
    if (found) out.push(`${message} — found ${pyStr(found[0].slice(0, 60))}`);
  }
  return out;
}

// ---------------- the check ----------------

export interface EditPasteCheck {
  ok: boolean;
  /** Problems with the paste's shape or the block — Claude's to fix. */
  errors: string[];
  warnings: string[];
  /** Problems with the narration itself — the human's to fix, never Claude's. */
  scriptErrors: string[];
  /** A repair request ready to paste into the Claude chat; null when there is nothing to fix. */
  pasteBack: string | null;
  stats: { words: number; estimatedSeconds: number; sections: number; pins: number; graphics: number; shots: number } | null;
  script: string | null;
  hints: EditHints | null;
}

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

function repairRequest(errors: string[], warnings: string[]): string {
  const lines = [
    "The edit block you wrote failed the LUSORA check. Fix every error below and output the",
    `whole corrected block again — same format, between ${EDIT_MARKER} and ${END_MARKER},`,
    "nothing else. Do not change, reprint or shorten the script.",
    "",
    "ERRORS",
    ...errors.map((e) => `- ${e}`),
  ];
  if (warnings.length) lines.push("", "WARNINGS (fix if you can; not required)", ...warnings.map((w) => `- ${w}`));
  return lines.join("\n");
}

/**
 * Judge a paste against the channel config a video would be made with (the
 * channel's config with this video's overrides merged, as at enqueue).
 */
export function checkEditPaste(text: string, config: Record<string, unknown>): EditPasteCheck {
  const fail = (errors: string[], scriptErrors: string[] = []): EditPasteCheck => ({
    ok: false,
    errors,
    warnings: [],
    scriptErrors,
    pasteBack: errors.length ? repairRequest(errors, []) : null,
    stats: null,
    script: null,
    hints: null,
  });

  const split = splitEditPaste(text);
  if (!split.ok) return { ...fail([split.error]), pasteBack: null }; // a paste problem, not Claude's
  const { script, blockText } = split.value;
  const scriptErrors = validateScript(script);

  let hints: unknown;
  try {
    hints = JSON.parse(blockText);
  } catch (e) {
    return fail([`the block is not valid JSON: ${(e as Error).message}`], scriptErrors);
  }

  const { style, problems } = resolveStyleForConfig(config);
  if (!style) return { ...fail(problems, scriptErrors), pasteBack: null };

  const words = script.split(/\s+/).filter(Boolean).length;
  const report = validateEditHints(hints, script, { style_pack_doc: style }, { wpm: DEFAULT_WPM });
  const block = hints as EditHints;
  const valid = report.errors.length === 0;
  const pins = valid ? block.pins : [];
  return {
    ok: valid && scriptErrors.length === 0 && problems.length === 0,
    errors: [...problems, ...report.errors],
    warnings: report.warnings,
    scriptErrors,
    pasteBack: report.errors.length ? repairRequest(report.errors, report.warnings) : null,
    stats: {
      words,
      estimatedSeconds: Math.round((words * 60) / DEFAULT_WPM),
      sections: valid ? block.sections.length : 0,
      pins: pins.length,
      graphics: pins.filter((p) => p.overlay).length,
      shots: pins.filter((p) => p.visual_intent).length,
    },
    script,
    hints: valid ? block : null,
  };
}

// ---------------- the round-trip log (decision 4) ----------------

/** data/edit-pass/log.jsonl, beside the videos root: one line per checked paste.
 *  Paths are passed in rather than read from the environment, so this module
 *  stays importable by a test without a database or a request context. */
export function editPassLogPath(videosRoot: string): string {
  return join(dirname(videosRoot), "edit-pass", "log.jsonl");
}

interface LogLine {
  ts: string;
  event: "check" | "submit";
  paste_session: string;
  attempt?: number;
  channel_id?: string;
  video_id?: string;
  script_sha256?: string;
  block_sha256?: string;
  ok?: boolean;
  errors?: string[];
  warnings?: string[];
  script_errors?: string[];
}

function readSession(path: string, session: string): LogLine[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as LogLine;
      } catch {
        return null;
      }
    })
    .filter((l): l is LogLine => l !== null && l.paste_session === session);
}

function appendLog(path: string, line: LogLine): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(line) + "\n");
}

/**
 * Record a check as an ATTEMPT — once per distinct block in a session.
 *
 * A round-trip is a new block from Claude, not a click: checking the same
 * block twice, or editing only the script half, is not another attempt. The
 * attempt number is therefore the count of distinct block hashes seen in this
 * session, and a repeat returns the number it already had.
 */
export function logCheck(
  logPath: string,
  session: string,
  channelId: string,
  text: string,
  result: EditPasteCheck
): number {
  const split = splitEditPaste(text);
  const blockHash = sha256(split.ok ? split.value.blockText : text);
  const seen = readSession(logPath, session).filter((l) => l.event === "check");
  const previous = seen.find((l) => l.block_sha256 === blockHash);
  if (previous) return previous.attempt ?? 1;
  const attempt = new Set(seen.map((l) => l.block_sha256)).size + 1;
  appendLog(logPath, {
    ts: new Date().toISOString(),
    event: "check",
    paste_session: session,
    attempt,
    channel_id: channelId,
    script_sha256: split.ok ? sha256(split.value.script) : undefined,
    block_sha256: blockHash,
    ok: result.ok,
    errors: result.errors,
    warnings: result.warnings,
    script_errors: result.scriptErrors,
  });
  return attempt;
}

// ---------------- into a video folder ----------------

/**
 * Write an accepted paste into a new video's folder: script.txt, the block as
 * edit_hints.json, and edit_pass.json tying the video to its paste session so
 * the A/B report can count the round-trips it took.
 *
 * Refused unless the channel's pipeline declares both artifacts receivable —
 * only a pipeline with an `edit_hints` stage reads the block, and writing it
 * where nothing reads it would look applied while being ignored.
 */
export function materializeEditPaste(
  folder: string,
  logPath: string,
  videoId: string,
  channelId: string,
  session: string,
  check: EditPasteCheck,
  receivable: Set<string> | null
): string[] {
  if (!check.ok || !check.script || !check.hints) throw new Error("materializeEditPaste needs a passing check");
  for (const artifact of ["script.txt", "edit_hints.json"]) {
    if (receivable && !receivable.has(artifact)) {
      throw new Error(
        `this channel's pipeline does not take a directed edit (${artifact} is not receivable) — ` +
          "pin a pipeline that runs the edit_hints stage"
      );
    }
  }
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "script.txt"), check.script + "\n");
  writeFileSync(join(folder, "edit_hints.json"), JSON.stringify({ version: "1", ...check.hints }, null, 2) + "\n");
  const attempts = new Set(readSession(logPath, session).filter((l) => l.event === "check").map((l) => l.block_sha256)).size;
  writeFileSync(
    join(folder, "edit_pass.json"),
    JSON.stringify(
      {
        paste_session: session,
        attempts,
        script_sha256: sha256(check.script),
        submitted_at: new Date().toISOString(),
      },
      null,
      2
    ) + "\n"
  );
  appendLog(logPath, { ts: new Date().toISOString(), event: "submit", paste_session: session, channel_id: channelId, video_id: videoId });
  return ["script.txt", "edit_hints.json", "edit_pass.json"];
}
