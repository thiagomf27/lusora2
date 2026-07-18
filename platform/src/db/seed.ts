/** Create the initial admin user (from ADMIN_EMAIL/ADMIN_PASSWORD) if no users exist. */
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { pool } from "./pool.ts";
import { loadEnv } from "../lib/env.ts";

async function main() {
  loadEnv();
  const existing = await pool.query("SELECT count(*)::int AS n FROM users");
  if (existing.rows[0].n > 0) {
    console.log("users exist — nothing to seed");
  } else {
    const email = process.env.ADMIN_EMAIL ?? "admin@example.com";
    const password = process.env.ADMIN_PASSWORD ?? "admin";
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      "INSERT INTO users (id, email, name, password_hash, role) VALUES ($1, $2, $3, $4, 'admin')",
      [`usr_${randomUUID().slice(0, 8)}`, email, "Admin", hash]
    );
    console.log(`✓ admin user created: ${email}`);
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
