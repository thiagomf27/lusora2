import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { query, one } from "@/db/pool";
import { handler, requireUser, requireRole, ApiError } from "@/lib/auth";
import { componentMenu } from "@/lib/catalog";
import { repoRoot } from "@/lib/env";
import {
  PROMPT_ROLES,
  compose,
  isPromptRole,
  validatePrompt,
  type PromptDoc,
  type PromptRole,
} from "@/lib/prompts";
import { videoFolder } from "@/lib/videos";

/**
 * Composed preview and test run for a prompt being edited.
 *
 * The preview is the whole point of the screen: it renders the editable half
 * AND the welded contract half against real data, so what you read is what the
 * model will read. `?video=<id>` uses that video's script/beats/cfg; without
 * it, a small built-in sample stands in.
 */

interface PreviewBody {
  doc: PromptDoc;
  video_id?: string;
  /** run the composed prompt against the provider instead of only rendering it */
  run?: boolean;
}

const SAMPLE = {
  title: "The Harbour That Emptied",
  script:
    "In 1974 the harbour handled four hundred ships a month. By 1981 it handled nine. " +
    "The cranes stayed up for another decade, because taking them down cost more than leaving them.",
  duration: 90,
};

async function variablesFor(role: PromptRole, videoId?: string): Promise<Record<string, unknown>> {
  let cfg: Record<string, unknown> = {};
  let title = SAMPLE.title;
  let script = SAMPLE.script;
  let beats = "{}";
  let planTracks = "{}";

  if (videoId) {
    const video = await one<{ id: string; title: string; cfg: Record<string, unknown> | null }>(
      "SELECT id, title, cfg FROM videos WHERE id = $1",
      [videoId]
    );
    if (!video) throw new ApiError(404, `video ${videoId} not found`);
    cfg = video.cfg ?? {};
    title = video.title;
    const folder = videoFolder(video.id);
    const read = (file: string) => {
      try {
        return readFileSync(join(folder, file), "utf8");
      } catch {
        return null;
      }
    };
    script = read("script.txt") ?? script;
    beats = read("beats.json") ?? beats;
    const plan = read("edit_plan.json");
    if (plan) planTracks = JSON.stringify(JSON.parse(plan).tracks ?? {});
  }

  const pack = (cfg.style_pack_doc ?? {}) as {
    script_persona?: string;
    visual_language?: string;
    pacing?: { avg_hold_seconds?: number; min_hold?: number; max_hold?: number; arc?: string };
    overlays?: { density?: unknown; allowed_components?: string[] };
    script?: { target_seconds?: number };
  };
  const seconds =
    ((cfg.script ?? {}) as { target_seconds?: number }).target_seconds ??
    pack.script?.target_seconds ??
    SAMPLE.duration;
  const avgHold = pack.pacing?.avg_hold_seconds ?? 4;

  const common = {
    content_rules: String(cfg.content_rules ?? ""),
    instructions: String(((cfg.overrides ?? {}) as { instructions?: string }).instructions ?? ""),
  };

  if (role === "script") {
    return {
      ...common,
      persona: pack.script_persona ?? "",
      language: String(cfg.language ?? "en-US"),
      title,
      target_seconds: Math.round(seconds),
      target_words: Math.round(seconds * 2.5),
    };
  }
  if (role === "planner") {
    const density = pack.overlays?.density ?? "normal";
    return {
      ...common,
      script,
      audio_duration_s: String(Math.round(SAMPLE.duration)),
      target_beats: Math.max(1, Math.round(SAMPLE.duration / avgHold)),
      avg_hold: avgHold,
      min_hold: pack.pacing?.min_hold ?? 2.5,
      max_hold: pack.pacing?.max_hold ?? 8,
      arc: pack.pacing?.arc ?? "",
      density: typeof density === "string" ? density : JSON.stringify(density),
      visual_language: pack.visual_language ?? "",
      component_menu: componentMenu(pack.overlays?.allowed_components ?? null),
      video_id: videoId ?? "sample",
    };
  }
  return {
    component_menu: componentMenu(),
    beats,
    plan_tracks: planTracks,
    message: "make the middle faster and add a map when he mentions the route",
  };
}

/** Price lookup mirrors the worker's gate: an unknown provider+operation is a
 *  hard error, never a silent $0 (D13). */
function unitPrice(provider: string, operation: string): number {
  const table = JSON.parse(
    readFileSync(join(repoRoot(), "contracts", "prices.json"), "utf8")
  ) as { prices: Record<string, Record<string, { unit_price_usd: number }>> };
  const price = table.prices[provider]?.[operation];
  if (!price) throw new ApiError(400, `no price for ${provider}.${operation} in contracts/prices.json`);
  return price.unit_price_usd;
}

export const POST = handler(async (req: Request) => {
  const user = await requireUser();
  const body: PreviewBody = await req.json();
  const doc = body?.doc;
  if (!isPromptRole(doc?.role)) throw new ApiError(400, `role must be one of ${PROMPT_ROLES.join(", ")}`);

  const errors = validatePrompt(doc);
  const variables = await variablesFor(doc.role, body.video_id);
  const composed = compose(doc.role, doc, variables);

  if (!body.run) {
    return NextResponse.json({ ...composed, errors, variables: Object.keys(variables) });
  }

  // A test run spends real money, so it is manager-only and recorded like any
  // other spend — an untracked experiment is exactly what D13 rules out.
  await requireRole("manager");
  if (errors.length) throw new ApiError(400, `fix the prompt first: ${errors.join("; ")}`);

  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new ApiError(503, "test run needs DEEPSEEK_API_KEY in .env");
  const provider = "deepseek";
  const operation = doc.role === "planner" ? "llm.plan_beats" : "llm.generate_script";
  const price = unitPrice(provider, operation);

  const started = Date.now();
  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: doc.model_hint ?? "deepseek-v4-pro",
      messages: [
        { role: "system", content: composed.system },
        { role: "user", content: composed.user },
      ],
      max_tokens: doc.max_tokens ?? 4000,
    }),
  });
  if (!res.ok) throw new ApiError(502, `deepseek error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const usage = data.usage ?? {};
  const tokens = Number(usage.total_tokens ?? 0);

  await query(
    `INSERT INTO cost_events (video_id, channel_id, provider, operation, status, units, unit_price_usd, usd, details)
     VALUES (NULL, NULL, $1, $2, 'actual', $3, $4, $5, $6)`,
    [
      provider,
      operation,
      tokens,
      price,
      tokens * price,
      JSON.stringify({
        test_run: true,
        prompt: `${doc.role}/${doc.name}`,
        by: user.email,
        input_tokens: usage.prompt_tokens ?? 0,
        output_tokens: usage.completion_tokens ?? 0,
      }),
    ]
  );

  return NextResponse.json({
    ...composed,
    errors,
    output: data.choices?.[0]?.message?.content ?? "",
    finish_reason: data.choices?.[0]?.finish_reason ?? null,
    tokens,
    usd: tokens * price,
    ms: Date.now() - started,
  });
});
