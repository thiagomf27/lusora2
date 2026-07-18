/**
 * Cookie sessions (D25): stateless signed cookie, HMAC-SHA256 with
 * SESSION_SECRET. Payload: user id + expiry. No session table.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { requireEnv } from "./env.ts";

const COOKIE = "lusora_session";
const TTL_S = 60 * 60 * 24 * 14; // 14 days

interface SessionPayload {
  uid: string;
  exp: number;
}

function sign(data: string): string {
  return createHmac("sha256", requireEnv("SESSION_SECRET")).update(data).digest("base64url");
}

export function encodeSession(uid: string): string {
  const payload = Buffer.from(
    JSON.stringify({ uid, exp: Math.floor(Date.now() / 1000) + TTL_S } satisfies SessionPayload)
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(value: string | undefined): SessionPayload | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  const expected = sign(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed: SessionPayload = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (parsed.exp < Date.now() / 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function setSessionCookie(uid: string): Promise<void> {
  (await cookies()).set(COOKIE, encodeSession(uid), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: TTL_S,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export async function sessionUserId(): Promise<string | null> {
  const value = (await cookies()).get(COOKIE)?.value;
  return decodeSession(value)?.uid ?? null;
}
