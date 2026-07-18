import { createReadStream, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { handler, requireUser, requireChannelAccess, ApiError } from "@/lib/auth";
import { getVideo, videoFolder } from "@/lib/videos";

type Ctx = { params: Promise<{ id: string }> };

/** final.mp4 streaming with HTTP range support (the Video page player). */
export const GET = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const video = await getVideo(id);
  await requireChannelAccess(user, video.channel_id);

  const file = join(videoFolder(id), "final.mp4");
  if (!existsSync(file)) throw new ApiError(404, "final.mp4 not present (not rendered, or thinned by retention)");
  const size = statSync(file).size;

  const range = req.headers.get("range");
  if (range) {
    const m = range.match(/bytes=(\d+)-(\d*)/);
    const start = m ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
    const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        "Content-Type": "video/mp4",
      },
    });
  }
  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Length": String(size),
      "Content-Type": "video/mp4",
      "Accept-Ranges": "bytes",
    },
  });
});
