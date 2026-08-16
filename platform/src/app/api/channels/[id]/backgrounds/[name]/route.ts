import { createReadStream, existsSync, statSync } from "node:fs";
import { extname } from "node:path";
import { Readable } from "node:stream";
import { handler, requireUser, requireChannelAccess, ApiError } from "@/lib/auth";
import { backgroundPath } from "@/lib/backgrounds";

type Ctx = { params: Promise<{ id: string; name: string }> };

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/** Serve one background so the gallery can show it. */
export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id, name } = await ctx.params;
  await requireChannelAccess(user, id);
  const file = backgroundPath(id, name);
  if (!existsSync(file) || !statSync(file).isFile()) throw new ApiError(404, "background not found");
  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": String(statSync(file).size),
      "Cache-Control": "private, max-age=60",
    },
  });
});
