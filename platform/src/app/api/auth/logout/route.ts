import { NextResponse } from "next/server";
import { handler } from "@/lib/auth";
import { clearSessionCookie } from "@/lib/session";

export const POST = handler(async () => {
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
});
