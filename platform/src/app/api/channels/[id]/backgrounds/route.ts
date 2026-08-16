import { writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { NextResponse } from "next/server";
import { handler, requireUser, requireRole, requireChannelAccess, ApiError } from "@/lib/auth";
import {
  BACKGROUND_EXTENSIONS,
  BACKGROUND_NAME_RE,
  MAX_BACKGROUND_BYTES,
  deleteBackground,
  ensureBackgroundsDir,
  listBackgrounds,
} from "@/lib/backgrounds";

type Ctx = { params: Promise<{ id: string }> };

/** The channel's background library — the gallery on the brand profile. */
export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  await requireChannelAccess(user, id);
  return NextResponse.json(listBackgrounds(id));
});

/** Upload one image. multipart/form-data: `file`, optional `name`. */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireRole("manager");
  const { id } = await ctx.params;
  await requireChannelAccess(user, id);

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new ApiError(400, "file required");
  if (file.size > MAX_BACKGROUND_BYTES) {
    throw new ApiError(413, `background is ${(file.size / 1e6).toFixed(1)} MB — the limit is ${MAX_BACKGROUND_BYTES / 1e6} MB`);
  }
  const requested = String(form.get("name") ?? file.name ?? "").trim();
  const ext = extname(requested).toLowerCase();
  if (!BACKGROUND_EXTENSIONS.includes(ext)) {
    throw new ApiError(400, `unsupported image type '${ext || "(none)"}' — use ${BACKGROUND_EXTENSIONS.join(", ")}`);
  }
  // keep the caller's stem, but strip anything that is not a safe file name
  const stem = requested.slice(0, requested.length - ext.length).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+/, "");
  const name = `${stem || "background"}${ext}`;
  if (!BACKGROUND_NAME_RE.test(name)) throw new ApiError(400, `could not derive a safe file name from '${requested}'`);

  const dir = ensureBackgroundsDir(id);
  writeFileSync(join(dir, name), Buffer.from(await file.arrayBuffer()));
  return NextResponse.json({ ok: true, name }, { status: 201 });
});

/** Remove one image. A channel config still naming it fails pre-flight. */
export const DELETE = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireRole("manager");
  const { id } = await ctx.params;
  await requireChannelAccess(user, id);
  const name = new URL(req.url).searchParams.get("name");
  if (!name) throw new ApiError(400, "name query parameter required");
  deleteBackground(id, name);
  return NextResponse.json({ ok: true, name });
});
