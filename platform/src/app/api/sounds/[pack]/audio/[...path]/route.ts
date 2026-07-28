import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { handler, requireUser, ApiError } from "@/lib/auth";
import { SOUND_PACK_NAME_RE, SOUND_NAME_HINT, soundPackDir } from "@/lib/soundPacks";

type Ctx = { params: Promise<{ pack: string; path: string[] }> };

const MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
};

/** Serve a pack's audio so the Sounds page can play it. Range support because
 *  an <audio> element seeking without it re-downloads the whole file. */
export const GET = handler(async (req: Request, ctx: Ctx) => {
  await requireUser();
  const { pack, path } = await ctx.params;
  if (!SOUND_PACK_NAME_RE.test(pack)) throw new ApiError(400, SOUND_NAME_HINT);

  const dir = resolve(soundPackDir(pack));
  const file = resolve(join(dir, ...path));
  if (!file.startsWith(dir + sep)) throw new ApiError(400, "invalid path");
  const type = MIME[extname(file).toLowerCase()];
  if (!type) throw new ApiError(400, "not an audio file");
  if (!existsSync(file) || !statSync(file).isFile()) throw new ApiError(404, "file not found");

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
    headers: { "Content-Length": String(size), "Content-Type": type, "Accept-Ranges": "bytes" },
  });
});
