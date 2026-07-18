import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { query, one } from "@/db/pool";
import { handler, requireRole, ApiError } from "@/lib/auth";
import { newId } from "@/lib/ids";

export const GET = handler(async () => {
  await requireRole(); // admin only (requireRole with no roles passes only admins)
  const users = await query(
    `SELECT u.id, u.email, u.name, u.role, u.active, u.created_at,
            COALESCE(array_agg(g.channel_id) FILTER (WHERE g.channel_id IS NOT NULL), '{}') AS channels
     FROM users u LEFT JOIN user_channel_grants g ON g.user_id = u.id
     GROUP BY u.id ORDER BY u.created_at`
  );
  return NextResponse.json(users);
});

export const POST = handler(async (req: Request) => {
  await requireRole();
  const { email, name, password, role, channels } = await req.json();
  if (!email || !name || !password || !role) {
    throw new ApiError(400, "email, name, password, role required");
  }
  if (!["admin", "manager", "editor"].includes(role)) throw new ApiError(400, "invalid role");
  const existing = await one("SELECT 1 FROM users WHERE email = $1", [email]);
  if (existing) throw new ApiError(409, "email already registered");
  const id = newId("usr");
  await query(
    "INSERT INTO users (id, email, name, password_hash, role) VALUES ($1, $2, $3, $4, $5)",
    [id, email, name, await bcrypt.hash(password, 10), role]
  );
  for (const ch of channels ?? []) {
    await query(
      "INSERT INTO user_channel_grants (user_id, channel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [id, ch]
    );
  }
  return NextResponse.json({ id }, { status: 201 });
});
