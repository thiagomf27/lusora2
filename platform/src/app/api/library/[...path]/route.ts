import { handler, requireUser, ApiError } from "@/lib/auth";
import { loadEnv } from "@/lib/env";

/** 1:1 proxy to the broll library API (D11: one API, two consumers).
 *
 * Headers are forwarded rather than rebuilt because two of the library's
 * routes serve BYTES, not JSON: /clips/{id} and /thumbs/{id}. A <video>
 * scrubbing a clip issues Range requests, and dropping Range on the way out
 * (or Content-Range/Accept-Ranges on the way back) makes the player refetch
 * the whole file on every seek, or refuse to seek at all. */
const PASS_REQUEST = ["content-type", "range", "if-range", "accept"];
const PASS_RESPONSE = [
  "content-type", "content-length", "content-range",
  "accept-ranges", "content-disposition",
];

async function proxy(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  await requireUser();
  loadEnv();
  const base = process.env.LIBRARY_API_URL;
  if (!base) throw new ApiError(503, "LIBRARY_API_URL not configured");
  const { path } = await ctx.params;
  const url = new URL(req.url);
  const target = `${base}/${path.join("/")}${url.search}`;

  const headers = new Headers();
  for (const h of PASS_REQUEST) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }

  try {
    const res = await fetch(target, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.blob(),
      // @ts-expect-error duplex is required by node fetch for streamed bodies
      duplex: "half",
    });
    const out = new Headers();
    for (const h of PASS_RESPONSE) {
      const v = res.headers.get(h);
      if (v) out.set(h, v);
    }
    if (!out.has("content-type")) out.set("content-type", "application/json");
    return new Response(res.body, { status: res.status, headers: out });
  } catch {
    throw new ApiError(
      502,
      `library service unreachable at ${base} — start it (docker compose up library)`
    );
  }
}

export const GET = handler(proxy);
export const POST = handler(proxy);
export const PUT = handler(proxy);
export const PATCH = handler(proxy);
export const DELETE = handler(proxy);
