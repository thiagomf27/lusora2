import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { query } from "@/db/pool";
import { handler, requireUser, requireRole, grantedChannelIds, ApiError } from "@/lib/auth";
import {
  PROMPT_NAME_HINT,
  PROMPT_NAME_RE,
  PROMPT_ROLES,
  isPromptRole,
  listPrompts,
  loadRoles,
  promptPath,
  validatePrompt,
  weldedText,
  writePrompt,
  type PromptDoc,
  type PromptRole,
} from "@/lib/prompts";
import { listStylePacks } from "@/lib/stylePacks";

/** List / create prompt packs (D42). Single-prompt update: ./[role]/[name] */

export interface PromptRow {
  doc: PromptDoc;
  errors: string[];
  /** Who points at this prompt today — the D44 ladder, made visible. */
  usedBy: { kind: "channel" | "style_pack"; name: string }[];
  isDefault: boolean;
}

export interface PromptsPayload {
  roles: ReturnType<typeof loadRoles>;
  welded: Record<PromptRole, { system: string; user: string }>;
  prompts: PromptRow[];
}

export const GET = handler(async () => {
  const user = await requireUser();
  const granted = await grantedChannelIds(user);
  const channels =
    granted === "all"
      ? await query<{ name: string; config: Record<string, { prompt?: string }> }>(
          "SELECT name, config FROM channels ORDER BY name"
        )
      : await query<{ name: string; config: Record<string, { prompt?: string }> }>(
          "SELECT name, config FROM channels WHERE id = ANY($1) ORDER BY name",
          [granted]
        );
  const packs = listStylePacks();

  const prompts: PromptRow[] = listPrompts().map((doc) => {
    const usedBy: PromptRow["usedBy"] = [];
    for (const channel of channels) {
      if (channel.config?.[doc.role]?.prompt === doc.name) {
        usedBy.push({ kind: "channel", name: channel.name });
      }
    }
    if (doc.role === "script") {
      for (const pack of packs) {
        if (pack.scriptPrompt === doc.name) usedBy.push({ kind: "style_pack", name: pack.name });
      }
    }
    return { doc, errors: validatePrompt(doc), usedBy, isDefault: doc.name === "default" };
  });

  const welded = Object.fromEntries(
    PROMPT_ROLES.map((role) => [
      role,
      { system: weldedText(role, "system"), user: weldedText(role, "user") },
    ])
  ) as PromptsPayload["welded"];

  return NextResponse.json({ roles: loadRoles(), welded, prompts } satisfies PromptsPayload);
});

export const POST = handler(async (req: Request) => {
  await requireRole("manager");
  const doc: PromptDoc = await req.json();

  if (!isPromptRole(doc?.role)) throw new ApiError(400, `role must be one of ${PROMPT_ROLES.join(", ")}`);
  if (typeof doc?.name !== "string" || !PROMPT_NAME_RE.test(doc.name)) {
    throw new ApiError(400, PROMPT_NAME_HINT);
  }
  const errors = validatePrompt(doc);
  if (errors.length) throw new ApiError(400, `prompt invalid: ${errors.join("; ")}`);

  const path = promptPath(doc.role, doc.name);
  if (existsSync(path)) throw new ApiError(409, `prompt ${doc.role}/${doc.name} already exists`);

  writePrompt(doc);
  return NextResponse.json({ role: doc.role, name: doc.name }, { status: 201 });
});
