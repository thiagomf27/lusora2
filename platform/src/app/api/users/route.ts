import { NextResponse } from "next/server";
import { query } from "@/db/pool";
import { handler, requireRole } from "@/lib/auth";

/** Minimal user directory for the channel Team picker. Manager-readable
 *  (the full /api/admin/users is admin-only). */
export const GET = handler(async () => {
  await requireRole("manager");
  const rows = await query(
    "SELECT id, email, name, role FROM users WHERE active = TRUE ORDER BY email"
  );
  return NextResponse.json(rows);
});
