import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { handler, requireUser, requireChannelAccess, ApiError } from "@/lib/auth";
import { getVideo, videoFolder } from "@/lib/videos";

type Ctx = { params: Promise<{ id: string; path: string[] }> };

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** Serve any artifact inside the video folder (the editor's Player preview
 *  loads clips/, audio.mp3 etc. through here). Range support for seeking. */
export const GET = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id, path } = await ctx.params;
  const video = await getVideo(id);
  await requireChannelAccess(user, video.channel_id);

  const folder = resolve(videoFolder(id));
  const file = resolve(join(folder, ...path));
  if (file !== folder && !file.startsWith(folder + sep)) throw new ApiError(400, "invalid path");
  if (!existsSync(file) || !statSync(file).isFile()) throw new ApiError(404, "file not found");

  const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
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
        "Content-Type": type,
      },
    });
  }
  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Length": String(size),
      "Content-Type": type,
      "Accept-Ranges": "bytes",
    },
  });
});
