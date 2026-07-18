import { handler, requireUser, ApiError } from "@/lib/auth";
import { loadEnv } from "@/lib/env";

/** 1:1 proxy to the broll library API (D11: one API, two consumers). */
async function proxy(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  await requireUser();
  loadEnv();
  const base = process.env.LIBRARY_API_URL;
  if (!base) throw new ApiError(503, "LIBRARY_API_URL not configured");
  const { path } = await ctx.params;
  const url = new URL(req.url);
  const target = `${base}/${path.join("/")}${url.search}`;
  try {
    const res = await fetch(target, {
      method: req.method,
      headers: { "Content-Type": req.headers.get("Content-Type") ?? "application/json" },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.blob(),
      // @ts-expect-error duplex is required by node fetch for streamed bodies
      duplex: "half",
    });
    return new Response(res.body, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
    });
  } catch {
    throw new ApiError(502, `library service unreachable at ${base} — vendor it into library/ and start it (M5/OQ-4)`);
  }
}

export const GET = handler(proxy);
export const POST = handler(proxy);
export const PUT = handler(proxy);
export const DELETE = handler(proxy);
