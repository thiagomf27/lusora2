/**
 * Fork a video onto another pipeline for the directed-edit A/B
 * (docs/05-roadmap/directed-edit-test.md, Part 2).
 *
 *   pnpm ab:fork --from <video_id> --pipeline faceless_v3
 *   pnpm ab:fork --from <video_id> --pipeline faceless_directed --edit paste.txt [--session <id>]
 *   pnpm ab:fork --from <video_id> --pipeline faceless_v3 --noise yes
 *
 * The fork gets the source's cfg snapshot with only the pipeline swapped, and
 * the source's script, audio, subtitles and TTS timings, copied byte for byte.
 * It is created QUEUED: the worker skips narration and transcript (their files
 * are present) and runs everything after.
 *
 * Either direction works. The usual one is directed first, from the quote page
 * (the paste box counts the round-trips), then `--pipeline faceless_v3` from it
 * once it has narrated. Going the other way, `--edit` takes the same script +
 * block text the paste box takes; pass the box's `--session` to keep the
 * round-trips it counted, or the paste starts a new session of one attempt.
 *
 * `--noise yes` allows the SAME pipeline: the control run twice on one script,
 * to see how much DeepSeek alone moves the scores at temperature 0.2.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PipelineManifest } from "@lusora/contracts";
import {
  copyForkFiles,
  forkSnapshot,
  missingForkFiles,
  sameNarration,
  snapshotDifferences,
  writeForkRecord,
} from "../src/lib/abFork.ts";
import { checkEditPaste, editPassLogPath, logCheck, materializeEditPaste } from "../src/lib/editPaste.ts";
import { videoFolder, videosRoot } from "../src/lib/folders.ts";
import { loadPipeline, receivableArtifacts } from "../src/lib/pipelines.ts";
import { validateAgainst } from "../src/lib/validate.ts";
import { newId } from "../src/lib/ids.ts";

function usage(message: string): never {
  console.error(`ab:fork: ${message}`);
  console.error(
    "usage: pnpm ab:fork --from <video_id> --pipeline <name> [--edit <paste.txt>] [--session <id>] [--noise yes]"
  );
  process.exit(2);
}

function userPath(path: string): string {
  return resolve(process.env.INIT_CWD ?? process.cwd(), path);
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (!arg.startsWith("--")) usage(`unexpected argument '${arg}'`);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) usage(`--${arg.slice(2)} needs a value`);
    out[arg.slice(2)] = next;
    i++;
  }
  return out;
}

interface SourceRow {
  id: string;
  channel_id: string;
  title: string;
  status: string;
  created_by: string;
  cfg: Record<string, unknown> | null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  for (const key of Object.keys(args)) {
    if (!["from", "pipeline", "edit", "session", "noise"].includes(key)) usage(`unknown option --${key}`);
  }
  if (!args.from) usage("--from is required");
  if (!args.pipeline) usage("--pipeline is required");

  const loaded = loadPipeline(args.pipeline);
  if (!loaded.ok) usage(loaded.problem);
  const manifest: PipelineManifest = loaded.manifest;
  const receivable = receivableArtifacts(manifest);
  const takesBlock = manifest.stages.some((s) => s.name === "edit_hints");
  if (takesBlock && !args.edit) usage(`${manifest.name} runs the edit_hints stage — pass --edit <paste.txt>`);
  if (!takesBlock && args.edit) usage(`${manifest.name} does not run the edit_hints stage — drop --edit`);

  // Imported here, as in edit-pass-prompt: nothing above needs the database.
  const { pool, query, one } = await import("../src/db/pool.ts");
  try {
    const source = await one<SourceRow>(
      "SELECT id, channel_id, title, status, created_by, cfg FROM videos WHERE id = $1",
      [args.from]
    );
    if (!source) usage(`video ${args.from} not found`);
    const cfg = source.cfg;
    if (!cfg || !cfg.pipeline_doc) usage(`${source.id} has no cfg snapshot yet — enqueue it first`);
    if (cfg.pipeline === manifest.name && args.noise !== "yes") {
      usage(`${source.id} already runs ${manifest.name} — pass --noise yes for a same-pipeline noise run`);
    }
    if (args.noise === "yes" && takesBlock) usage("a noise run is the control twice — fork onto the control pipeline");
    const sourceFolder = videoFolder(source.id);
    const missing = missingForkFiles(sourceFolder);
    if (missing.length) usage(`${source.id} has no ${missing.join(", ")} yet — let it run past transcript`);

    const snapshot = forkSnapshot(cfg, manifest);
    const schema = validateAgainst("channel_config", snapshot);
    if (!schema.ok) usage(`the forked snapshot fails the schema: ${schema.errors.join("; ")}`);
    const drift = snapshotDifferences(cfg, snapshot);
    if (drift.length) throw new Error(`bug: the fork differs from its source in ${drift.join(", ")}`);

    // The block is judged against the snapshot the fork will RUN with, and its
    // script half must be the narration that is being copied — a block written
    // against another draft would pin phrases that are not in the audio.
    let paste: { text: string; check: ReturnType<typeof checkEditPaste>; session: string } | null = null;
    if (args.edit) {
      const path = userPath(args.edit);
      if (!existsSync(path)) usage(`no file ${path}`);
      const text = readFileSync(path, "utf8");
      const check = checkEditPaste(text, snapshot);
      const session = args.session ?? newId("abfork");
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(session)) usage("--session must be 8-64 letters, digits, - or _");
      logCheck(editPassLogPath(videosRoot()), session, source.channel_id, text, check);
      if (!check.ok) {
        const problems = [...check.scriptErrors, ...check.errors];
        console.error(problems.map((p) => `  - ${p}`).join("\n"));
        if (check.pasteBack) console.error(`\n--- send this back to Claude ---\n${check.pasteBack}`);
        usage("the edit paste did not pass the check");
      }
      const narration = readFileSync(`${sourceFolder}/script.txt`, "utf8");
      if (!sameNarration(check.script!, narration)) {
        usage(`the paste's script is not ${source.id}'s script.txt — the block must be written against the narration being copied`);
      }
      for (const w of check.warnings) console.error(`  warning: ${w}`);
      paste = { text, check, session };
    }

    const id = newId("vid");
    const folder = videoFolder(id);
    await query(
      `INSERT INTO videos (id, channel_id, title, status, created_by, cfg) VALUES ($1, $2, $3, 'draft', $4, NULL)`,
      [id, source.channel_id, source.title, source.created_by]
    );
    if (paste) {
      materializeEditPaste(folder, editPassLogPath(videosRoot()), id, source.channel_id, paste.session, paste.check, receivable);
    }
    const files = copyForkFiles(sourceFolder, folder);
    writeForkRecord(folder, {
      from: source.id,
      from_pipeline: String(cfg.pipeline),
      pipeline: manifest.name,
      files,
      created_at: new Date().toISOString(),
    });
    writeFileSync(`${folder}/cfg.json`, JSON.stringify(snapshot, null, 2));
    await query(
      `UPDATE videos SET status = 'queued', cfg = $2, folder_path = $3, updated_at = now() WHERE id = $1`,
      [id, JSON.stringify(snapshot), folder]
    );
    await query(
      `INSERT INTO video_events (video_id, stage, status, message) VALUES ($1, 'enqueue', 'done', $2)`,
      [id, `A/B fork of ${source.id} — pipeline ${manifest.name} v${manifest.version}, same narration`]
    );
    console.log(id);
    console.error(
      `forked ${source.id} (${cfg.pipeline}) → ${id} (${manifest.name}), queued; ` +
        `shared: ${Object.keys(files).join(", ")}`
    );
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
