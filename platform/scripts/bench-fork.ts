/**
 * Fork a rendered video onto a pipeline with a FRESH snapshot, for the
 * documentary-pipeline benchmark (docs/05-roadmap/documentary-pipeline-plan.md,
 * evals/benchmarks/).
 *
 *   pnpm bench:fork --from <video_id> --pipeline documentary [--overrides '<json>'] [--title <t>]
 *
 * It shares the narration with its source byte for byte (script, audio,
 * subtitles, TTS timings — the same files `ab:fork` copies), so no TTS is paid
 * for and the voice is not a variable between two benchmark renders.
 *
 * Unlike `ab:fork` it does NOT copy the source's cfg snapshot. It enqueues
 * through the normal path, so the theme, style pack, sound pack and prompts are
 * the ones on disk NOW — which is the point: a slice that changes a theme's
 * sounds or a planner prompt must show up in the benchmark render. That makes
 * it the wrong tool for an A/B that must move one variable (use `ab:fork`), and
 * it writes `bench_fork.json`, not `ab_fork.json`, so `ab_report` never pairs it.
 *
 * `--overrides` are the per-video overrides the source was enqueued with, if
 * any; the snapshot keeps no record of them, so the benchmark README spells out
 * the ones each benchmark uses. `--pipeline` always wins over them.
 */
import { writeFileSync } from "node:fs";
import { copyForkFiles, missingForkFiles } from "../src/lib/abFork.ts";
import { videoFolder } from "../src/lib/folders.ts";
import { loadPipeline } from "../src/lib/pipelines.ts";
import { newId } from "../src/lib/ids.ts";

function usage(message: string): never {
  console.error(`bench:fork: ${message}`);
  console.error(
    "usage: pnpm bench:fork --from <video_id> --pipeline <name> [--overrides '<json>'] [--title <title>]"
  );
  process.exit(2);
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
  created_by: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  for (const key of Object.keys(args)) {
    if (!["from", "pipeline", "overrides", "title"].includes(key)) usage(`unknown option --${key}`);
  }
  if (!args.from) usage("--from is required");
  if (!args.pipeline) usage("--pipeline is required");
  const loaded = loadPipeline(args.pipeline);
  if (!loaded.ok) usage(loaded.problem);

  let overrides: Record<string, unknown> = {};
  if (args.overrides) {
    try {
      overrides = JSON.parse(args.overrides);
    } catch {
      usage("--overrides is not valid JSON");
    }
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) usage("--overrides must be a JSON object");
  }
  overrides = { ...overrides, pipeline: loaded.manifest.name };

  const { pool, query, one } = await import("../src/db/pool.ts");
  const { enqueueVideo, getVideo } = await import("../src/lib/videos.ts");
  try {
    const source = await one<SourceRow>(
      "SELECT id, channel_id, title, created_by FROM videos WHERE id = $1",
      [args.from]
    );
    if (!source) usage(`video ${args.from} not found`);
    const sourceFolder = videoFolder(source.id);
    const missing = missingForkFiles(sourceFolder);
    if (missing.length) usage(`${source.id} has no ${missing.join(", ")} yet — let it run past transcript`);

    const id = newId("vid");
    const title = args.title ?? `${source.title} — bench ${loaded.manifest.name} v${loaded.manifest.version}`;
    await query(
      `INSERT INTO videos (id, channel_id, title, status, created_by, cfg) VALUES ($1, $2, $3, 'draft', $4, NULL)`,
      [id, source.channel_id, title, source.created_by]
    );
    const folder = videoFolder(id);
    const files = copyForkFiles(sourceFolder, folder);
    writeFileSync(
      `${folder}/bench_fork.json`,
      JSON.stringify(
        { from: source.id, pipeline: loaded.manifest.name, version: loaded.manifest.version, overrides, files,
          created_at: new Date().toISOString() },
        null,
        2
      ) + "\n"
    );

    const result = await enqueueVideo(await getVideo(id), overrides);
    if (!result.ok) {
      console.error(result.problems.map((p) => `  - ${p}`).join("\n"));
      usage(`enqueue refused; ${id} is left as a draft`);
    }
    console.log(id);
    console.error(
      `bench fork of ${source.id} → ${id} (${loaded.manifest.name} v${loaded.manifest.version}), queued with a fresh ` +
        `snapshot; shared narration: ${Object.keys(files).join(", ")}`
    );
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
