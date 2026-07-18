/**
 * Apply contracts/db/*.sql migrations in filename order.
 * The DB schema is a contract (Core Principle 2) — files live in contracts.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pool } from "./pool.ts";
import { repoRoot } from "../lib/env.ts";

async function main() {
  const dir = join(repoRoot(), "contracts/db");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  await pool.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
  );

  for (const file of files) {
    const done = await pool.query("SELECT 1 FROM schema_migrations WHERE version = $1", [file]);
    if (done.rowCount) {
      console.log(`= ${file} (applied)`);
      continue;
    }
    const sql = readFileSync(join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING",
        [file]
      );
      await client.query("COMMIT");
      console.log(`✓ ${file}`);
    } catch (e) {
      await client.query("ROLLBACK");
      throw new Error(`migration ${file} failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      client.release();
    }
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
