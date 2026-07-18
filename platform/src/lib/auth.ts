/**
 * Auth + roles (checked at API route level — no permission builder).
 * Admin: everything. Manager/Editor: granted channels only.
 */
import { NextResponse } from "next/server";
import type { UserRole } from "@lusora/contracts";
import { query, one } from "../db/pool.ts";
import { sessionUserId } from "./session.ts";

export interface AuthedUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function currentUser(): Promise<AuthedUser | null> {
  const uid = await sessionUserId();
  if (!uid) return null;
  return one<AuthedUser>(
    "SELECT id, email, name, role FROM users WHERE id = $1 AND active",
    [uid]
  );
}

export async function requireUser(): Promise<AuthedUser> {
  const user = await currentUser();
  if (!user) throw new ApiError(401, "not authenticated");
  return user;
}

export async function requireRole(...roles: UserRole[]): Promise<AuthedUser> {
  const user = await requireUser();
  if (user.role !== "admin" && !roles.includes(user.role)) {
    throw new ApiError(403, `requires role: ${roles.join(" or ")}`);
  }
  return user;
}

/** Channels this user can see (admin: all). */
export async function grantedChannelIds(user: AuthedUser): Promise<string[] | "all"> {
  if (user.role === "admin") return "all";
  const rows = await query<{ channel_id: string }>(
    "SELECT channel_id FROM user_channel_grants WHERE user_id = $1",
    [user.id]
  );
  return rows.map((r) => r.channel_id);
}

export async function requireChannelAccess(user: AuthedUser, channelId: string): Promise<void> {
  const granted = await grantedChannelIds(user);
  if (granted === "all" || granted.includes(channelId)) return;
  throw new ApiError(403, `no access to channel ${channelId}`);
}

/** Wrap a route handler: catches ApiError into a JSON response. */
export function handler<A extends unknown[]>(
  fn: (...args: A) => Promise<NextResponse | Response>
): (...args: A) => Promise<NextResponse | Response> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof ApiError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      console.error(e);
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "internal error" },
        { status: 500 }
      );
    }
  };
}
