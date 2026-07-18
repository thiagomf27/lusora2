import { Pool } from "pg";
import { loadEnv, requireEnv } from "../lib/env.ts";

loadEnv();

// survive Next.js hot reloads without leaking pools
const g = globalThis as unknown as { __lusoraPool?: Pool };

export const pool: Pool =
  g.__lusoraPool ?? new Pool({ connectionString: requireEnv("DATABASE_URL"), max: 10 });
g.__lusoraPool = pool;

export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

export async function one<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
