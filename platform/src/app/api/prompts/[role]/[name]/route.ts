import { NextResponse } from "next/server";
import { query } from "@/db/pool";
import { handler, requireUser, requireRole, ApiError } from "@/lib/auth";
import {
  PROMPT_ROLES,
  deletePrompt,
  isPromptRole,
  readPrompt,
  validatePrompt,
  writePrompt,
  type PromptDoc,
  type PromptRole,
} from "@/lib/prompts";
import { listStylePacks } from "@/lib/stylePacks";

type Ctx = { params: Promise<{ role: string; name: string }> };

async function parse(ctx: Ctx): Promise<{ role: PromptRole; name: string }> {
  const { role, name } = await ctx.params;
  if (!isPromptRole(role)) throw new ApiError(400, `role must be one of ${PROMPT_ROLES.join(", ")}`);
  return { role, name };
}

/** Every reference, including ones on channels the caller cannot see: the file
 *  is global, so a delete has to answer for all of them. */
async function referencedBy(role: PromptRole, name: string): Promise<string[]> {
  const channels = await query<{ name: string; config: Record<string, { prompt?: string }> }>(
    "SELECT name, config FROM channels ORDER BY name"
  );
  const used = channels
    .filter((c) => c.config?.[role]?.prompt === name)
    .map((c) => `channel ${c.name}`);
  if (role === "script") {
    used.push(
      ...listStylePacks()
        .filter((p) => p.scriptPrompt === name)
        .map((p) => `style pack ${p.name}`)
    );
  }
  return used;
}

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  await requireUser();
  const { role, name } = await parse(ctx);
  const doc = readPrompt(role, name);
  if (!doc) throw new ApiError(404, `prompt ${role}/${name} not found`);
  return NextResponse.json({ doc, errors: validatePrompt(doc) });
});

/**
 * Overwrite a prompt in place. The name is the filename, so it cannot change
 * here — a rename would break the channels and style packs pointing at it.
 * Videos already enqueued keep their own snapshot (cfg.prompts, D44), so an
 * edit only affects future enqueues.
 */
export const PUT = handler(async (req: Request, ctx: Ctx) => {
  await requireRole("manager");
  const { role, name } = await parse(ctx);
  if (!readPrompt(role, name)) throw new ApiError(404, `prompt ${role}/${name} not found`);

  const doc: PromptDoc = await req.json();
  if (doc?.name !== name || doc?.role !== role) {
    throw new ApiError(
      400,
      `name and role cannot change (${role}/${name} → ${doc?.role}/${doc?.name}); create a new prompt instead`
    );
  }
  const errors = validatePrompt(doc);
  if (errors.length) throw new ApiError(400, `prompt invalid: ${errors.join("; ")}`);

  writePrompt(doc);
  return NextResponse.json({ role, name });
});

export const DELETE = handler(async (_req: Request, ctx: Ctx) => {
  await requireRole("manager");
  const { role, name } = await parse(ctx);
  if (!readPrompt(role, name)) throw new ApiError(404, `prompt ${role}/${name} not found`);

  const used = await referencedBy(role, name);
  if (used.length > 0) throw new ApiError(409, `prompt ${role}/${name} is used by ${used.join(", ")}`);

  const problems = deletePrompt(role, name);
  if (problems.length) throw new ApiError(409, problems.join("; "));
  return NextResponse.json({ role, name, deleted: true });
});
