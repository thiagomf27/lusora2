/**
 * Editor chat agent (bounded agent #3, D15): turns a natural-language
 * request into beat ops + plan ops. It NEVER applies anything — the
 * route validates the ops and the client applies them explicitly.
 *
 * The prompt is data (D42): the editable half comes from the video's cfg
 * snapshot (`cfg.prompts.chat`, resolved at enqueue per D44) or from the
 * built-in default; the op vocabulary and response shape are welded
 * (D43), because they are what `beatEdit`/`planEdit` are about to enforce.
 */
import type { BeatSheet, EditPlan } from "@lusora/contracts";
import { componentMenu } from "./catalog";
import { loadEnv } from "./env";
import { ApiError } from "./auth";
import type { BeatOp } from "./beatEdit";
import type { PlanOp } from "./planEdit";
import { compose, readPrompt, type ResolvedPrompt } from "./prompts";

export interface ChatProposal {
  explanation: string;
  beat_ops: BeatOp[];
  plan_ops: PlanOp[];
}

export async function propose(
  beats: BeatSheet,
  plan: EditPlan,
  message: string,
  cfg?: { prompts?: { chat?: ResolvedPrompt }; chat?: { llm?: string; model?: string } } | null
): Promise<ChatProposal> {
  loadEnv();
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!deepseekKey && !anthropicKey) {
    throw new ApiError(
      503,
      "chat agent needs DEEPSEEK_API_KEY or ANTHROPIC_API_KEY in .env"
    );
  }

  // Videos enqueued before M10 carry no snapshot; fall back to the default so
  // the editor keeps working on them.
  const doc = cfg?.prompts?.chat ?? readPrompt("chat", "default");
  if (!doc) throw new ApiError(500, "contracts/prompts/chat/default.json is missing");

  const { system, user } = compose("chat", doc, {
    component_menu: componentMenu(),
    beats: JSON.stringify(beats),
    plan_tracks: JSON.stringify(plan.tracks),
    message,
  });

  const maxTokens = doc.max_tokens ?? 12000;
  let text: string;
  if (deepseekKey) {
    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${deepseekKey}` },
      body: JSON.stringify({
        model: cfg?.chat?.model ?? doc.model_hint ?? "deepseek-v4-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: maxTokens,
      }),
    });
    if (!res.ok) throw new ApiError(502, `deepseek error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    text = (await res.json()).choices[0].message.content;
  } else {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: cfg?.chat?.model ?? "claude-haiku-4-5-20251001",
        system,
        messages: [{ role: "user", content: user }],
        max_tokens: maxTokens,
      }),
    });
    if (!res.ok) throw new ApiError(502, `anthropic error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    text = data.content.map((b: { text?: string }) => b.text ?? "").join("");
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new ApiError(502, "chat agent returned no JSON object");
  let parsed: ChatProposal;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new ApiError(502, "chat agent returned unparseable JSON");
  }
  return {
    explanation: String(parsed.explanation ?? ""),
    beat_ops: Array.isArray(parsed.beat_ops) ? parsed.beat_ops : [],
    plan_ops: Array.isArray(parsed.plan_ops) ? parsed.plan_ops : [],
  };
}
