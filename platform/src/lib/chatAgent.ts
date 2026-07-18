/**
 * Editor chat agent (bounded agent #3, D15): turns a natural-language
 * request into beat ops + plan ops. It NEVER applies anything — the
 * route validates the ops and the client applies them explicitly.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BeatSheet, EditPlan } from "@lusora/contracts";
import { loadEnv, repoRoot } from "./env";
import { ApiError } from "./auth";
import type { BeatOp } from "./beatEdit";
import type { PlanOp } from "./planEdit";

export interface ChatProposal {
  explanation: string;
  beat_ops: BeatOp[];
  plan_ops: PlanOp[];
}

function catalogMenu(): string {
  const catalog = JSON.parse(readFileSync(join(repoRoot(), "contracts/catalog.json"), "utf8"));
  return catalog.components
    .map((c: { name: string; when_to_use: string; anchor_types: string[] }) =>
      `- ${c.name} (anchors: ${c.anchor_types.join("/") || "pure text"}): ${c.when_to_use}`)
    .join("\n");
}

const SYSTEM = `You are a video editor assistant. You receive the current beat sheet and edit plan of a video plus a user request. You respond with ONLY a JSON object proposing operations — you never apply them.

Response shape:
{"explanation": "one short sentence of what you propose",
 "beat_ops": [ ... ], "plan_ops": [ ... ]}

Beat ops (semantic changes; trigger per-beat recompile + re-source):
- {"op":"set_visual_intent","beat_id":"b2","visual_intent":"scout-style concrete visual description"}
- {"op":"set_mood","beat_id":"b2","mood":"grave"}
- {"op":"set_media_preference","beat_id":"b2","media_preference":"video|image|any"}
- {"op":"set_overlay","beat_id":"b2","overlay":{"component":"AnimatedMap","anchor_ref":0,"props_hint":{}}} or overlay null to remove
- {"op":"split_beat","beat_id":"b2","after_sentence":1}
- {"op":"merge_with_next","beat_id":"b2"}

Plan ops (precise timeline changes; they LOCK the touched items):
- {"op":"set_timing","id":"v_b2","start_s":3.0,"end_s":6.5,"in_offset_s":1.0}
- {"op":"move_overlay","id":"o_b2","start_s":4.0,"end_s":8.0}
- {"op":"set_transform","id":"o_x","scale":0.4,"position":"bottom_right"}
- {"op":"remove_overlay","id":"o_b2"}
- {"op":"set_music_volume","index":0,"volume":0.08}

Rules: overlays may only use catalog components and must attach to an existing anchor of a matching type (anchor_ref is an index into that beat's anchors). An overlay with no matching anchor is invalid — propose none instead. Prefer beat ops for creative changes, plan ops for timing precision. Propose the SMALLEST set of ops that fulfils the request.

COMPONENT MENU:
${"${MENU}"}`;

export async function propose(
  beats: BeatSheet,
  plan: EditPlan,
  message: string
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

  const system = SYSTEM.replace("${MENU}", catalogMenu());
  const user =
    `BEAT SHEET:\n${JSON.stringify(beats)}\n\nEDIT PLAN (tracks only):\n` +
    `${JSON.stringify(plan.tracks)}\n\nUSER REQUEST: ${message}\n\nRespond with the JSON object only.`;

  let text: string;
  if (deepseekKey) {
    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${deepseekKey}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: 3000,
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
        model: "claude-haiku-4-5-20251001",
        system,
        messages: [{ role: "user", content: user }],
        max_tokens: 3000,
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
