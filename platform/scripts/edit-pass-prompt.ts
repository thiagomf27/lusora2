/**
 * Print the edit-pass prompt for a Claude web chat (docs/05-roadmap/directed-edit-test.md).
 *
 *   pnpm edit-pass-prompt --style-pack directed-test --minutes 1.5
 *   pnpm edit-pass-prompt --channel DIRECTED_TEST_01 --script roteiro.txt
 *   pnpm edit-pass-prompt --config channel.json --minutes 20
 *   pnpm edit-pass-prompt --write-fixture
 *
 * Where the menu comes from, most specific first:
 *   --channel <id>    that channel's stored config (reads the database) —
 *                     component_pack and look.exclude applied as at enqueue
 *   --config <file>   a channel config JSON, same resolution, no database
 *   --style-pack <p>  the pack alone: core plus nothing a channel installs
 * --style-pack also overrides the pack named by --channel / --config.
 *
 * How long the video is: --script <file> (word count at --wpm, default 142),
 * or --minutes <n>. With neither, the budgets are printed per minute.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_WPM } from "../src/lib/editHints.ts";
import {
  FIXTURE_PATH,
  renderEditPassPrompt,
  renderFixture,
  resolveStyleForConfig,
} from "../src/lib/editPassPrompt.ts";
import { repoRoot } from "../src/lib/env.ts";

function usage(message: string): never {
  console.error(`edit-pass-prompt: ${message}`);
  console.error(
    "usage: pnpm edit-pass-prompt [--channel <id> | --config <file>] [--style-pack <name>]\n" +
      "                             [--script <file> | --minutes <n>] [--wpm <n>]\n" +
      "       pnpm edit-pass-prompt --write-fixture"
  );
  process.exit(2);
}

/** A file argument, relative to where the command was TYPED: pnpm runs the
 *  script inside platform/, and records the original directory in INIT_CWD. */
function userPath(path: string): string {
  return resolve(process.env.INIT_CWD ?? process.cwd(), path);
}

function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (!arg.startsWith("--")) usage(`unexpected argument '${arg}'`);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[arg.slice(2)] = true;
    else {
      out[arg.slice(2)] = next;
      i++;
    }
  }
  return out;
}

async function channelConfig(id: string): Promise<Record<string, unknown>> {
  // imported here so the database is only touched when a channel is asked for
  const { one, pool } = await import("../src/db/pool.ts");
  try {
    const row = await one<{ config: Record<string, unknown> }>(
      "SELECT config FROM channels WHERE id = $1",
      [id]
    );
    if (!row) usage(`channel '${id}' not found`);
    return row.config;
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const known = ["channel", "config", "style-pack", "script", "minutes", "wpm", "write-fixture"];
  for (const key of Object.keys(args)) if (!known.includes(key)) usage(`unknown option --${key}`);

  if (args["write-fixture"]) {
    const path = join(repoRoot(), FIXTURE_PATH);
    writeFileSync(path, renderFixture());
    console.error(`wrote ${FIXTURE_PATH}`);
    return;
  }

  let config: Record<string, unknown> = {};
  if (typeof args.channel === "string") config = await channelConfig(args.channel);
  else if (typeof args.config === "string") config = JSON.parse(readFileSync(userPath(args.config), "utf8"));
  if (typeof args["style-pack"] === "string") {
    config = { ...config, style_pack: args["style-pack"] };
    delete config.style_pack_doc;
  }
  if (!config.style_pack) usage("name a style pack, a channel or a channel config");

  const wpm = typeof args.wpm === "string" ? Number(args.wpm) : DEFAULT_WPM;
  if (!(wpm > 0)) usage("--wpm must be a positive number");
  let durationS: number | null = null;
  if (typeof args.script === "string") {
    const words = readFileSync(userPath(args.script), "utf8").split(/\s+/).filter(Boolean).length;
    durationS = (words * 60) / wpm;
  } else if (typeof args.minutes === "string") {
    durationS = Number(args.minutes) * 60;
    if (!(durationS > 0)) usage("--minutes must be a positive number");
  }

  const { style, problems } = resolveStyleForConfig(config);
  if (!style) usage(problems.join("; "));
  // A narrowing problem (an exclusion that empties the menu, a pack the style
  // does not allow) would also refuse the enqueue: say so rather than print a
  // prompt for a video that cannot be made.
  if (problems.length) usage(problems.join("; "));

  process.stdout.write(renderEditPassPrompt({ style, durationS, wpm }));
  const menu = style.overlays?.allowed_components;
  console.error(
    `(${style.name}${durationS ? `, ~${(durationS / 60).toFixed(1)} min at ${wpm} wpm` : ""}` +
      `${menu ? `, ${menu.length} components` : ""} — prompt on stdout)`
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
