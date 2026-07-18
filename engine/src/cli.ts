#!/usr/bin/env node
/**
 * engine CLI — the renderer interface contract:
 *   engine render --video-dir <folder> --renderer auto|ffmpeg|remotion
 * Writes final.mp4 atomically; exit 0 = success, non-zero = ONE actionable
 * reason on stderr. Files-only: no network, no DB.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { EditPlan } from "@lusora/contracts";
import { routePlan } from "./router.ts";
import { renderFfmpeg } from "./renderers/ffmpeg/render.ts";

function fail(reason: string): never {
  console.error(reason);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[i + 1] ?? "";
  }
  return args;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd !== "render") fail(`unknown command '${cmd ?? ""}' — usage: engine render --video-dir <folder> --renderer auto|ffmpeg|remotion`);

  const args = parseArgs(rest);
  const videoDir = args["video-dir"];
  const requested = (args["renderer"] ?? "auto") as "auto" | "ffmpeg" | "remotion";
  if (!videoDir) fail("missing --video-dir");
  if (!existsSync(videoDir)) fail(`video dir not found: ${videoDir}`);

  const planPath = join(videoDir, "edit_plan.json");
  if (!existsSync(planPath)) fail(`edit_plan.json not found in ${videoDir}`);
  const plan: EditPlan = JSON.parse(readFileSync(planPath, "utf8"));

  const route = routePlan(plan);
  let renderer: "ffmpeg" | "remotion";
  if (requested === "auto") {
    renderer = route.renderer;
  } else if (requested === "ffmpeg") {
    if (route.renderer === "remotion") {
      fail(
        `plan requires the remotion renderer but ffmpeg is pinned; offending items:\n- ${route.reasons.join("\n- ")}`
      );
    }
    renderer = "ffmpeg";
  } else {
    renderer = "remotion";
  }

  const result =
    renderer === "remotion"
      ? await (await import("./renderers/remotion/render.ts")).renderRemotion(plan, videoDir)
      : await renderFfmpeg(plan, videoDir);
  console.log(JSON.stringify({ renderer, duration_s: result.duration_s, ok: true }));
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
