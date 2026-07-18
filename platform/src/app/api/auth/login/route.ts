import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { one } from "@/db/pool";
import { handler, ApiError } from "@/lib/auth";
import { setSessionCookie } from "@/lib/session";

export const POST = handler(async (req: Request) => {
  const { email, password } = await req.json();
  if (!email || !password) throw new ApiError(400, "email and password required");
  const user = await one<{ id: string; password_hash: string; role: string; name: string }>(
    "SELECT id, password_hash, role, name FROM users WHERE email = $1 AND active",
    [email]
  );
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new ApiError(401, "invalid credentials");
  }
  await setSessionCookie(user.id);
  return NextResponse.json({ id: user.id, name: user.name, role: user.role });
});
