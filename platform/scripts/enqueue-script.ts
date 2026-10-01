/**
 * Enqueue a video whose script is already written — the comparison runs
 * (documentary plan slice 14b) start from a text the user supplies.
 *
 *   pnpm enqueue:script --channel <id> --script <file> --title <t> [--overrides '<json>']
 *
 * The draft gets the file as its script.txt, so the script stage finds it and
 * skips (manual-first), then it is enqueued through the normal path: a fresh
 * cfg snapshot from the channel, with `--overrides` merged over it.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { videoFolder } from "../src/lib/folders.ts";
import { newId } from "../src/lib/ids.ts";

function usage(message: string): never {
  console.error(`enqueue:script: ${message}`);
  console.error("usage: pnpm enqueue:script --channel <id> --script <file> --title <t> [--overrides '<json>']");
  process.exit(2);
}

const args: Record<string, string> = {};
const argv = process.argv.slice(2).filter((a) => a !== "--");
for (let i = 0; i < argv.length; i += 2) {
  if (!argv[i].startsWith("--") || argv[i + 1] === undefined) usage(`bad argument '${argv[i]}'`);
  args[argv[i].slice(2)] = argv[i + 1];
}
for (const need of ["channel", "script", "title"]) if (!args[need]) usage(`--${need} is required`);
let overrides: Record<string, unknown> = {};
try {
  overrides = args.overrides ? JSON.parse(args.overrides) : {};
} catch {
  usage("--overrides is not JSON");
}

const { pool, query, one } = await import("../src/db/pool.ts");
const { enqueueVideo, getVideo } = await import("../src/lib/videos.ts");
try {
  const channel = await one<{ id: string }>("SELECT id FROM channels WHERE id = $1", [args.channel]);
  if (!channel) usage(`channel ${args.channel} not found`);
  const admin = await one<{ id: string }>("SELECT id FROM users ORDER BY created_at LIMIT 1", []);
  const id = newId("vid");
  await query(
    `INSERT INTO videos (id, channel_id, title, status, created_by, cfg) VALUES ($1, $2, $3, 'draft', $4, NULL)`,
    [id, channel.id, args.title, admin?.id ?? null]
  );
  const folder = videoFolder(id);
  mkdirSync(folder, { recursive: true });
  copyFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), args.script), `${folder}/script.txt`);
  const result = await enqueueVideo(await getVideo(id), overrides);
  if (!result.ok) {
    console.error(result.problems.map((p) => `  - ${p}`).join("\n"));
    usage(`enqueue refused; ${id} is left as a draft`);
  }
  console.log(id);
} finally {
  await pool.end();
}
