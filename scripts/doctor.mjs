#!/usr/bin/env node
/**
 * Pre-flight check for a local dev machine. `pnpm run doctor`.
 *
 * Four processes have to agree about two databases, one submodule, one shared
 * .env and one the submodule keeps for itself — and almost every way that goes
 * wrong is SILENT. The library adopts a DSN it was never meant to see; a shell
 * export beats the .env the file says is authoritative; a fresh clone leaves
 * library/ empty and the API 502s. This checks each of those and prints the
 * command that fixes it, rather than leaving them to be found one stack trace
 * at a time.
 *
 * Read-only: it connects and reads, and writes nothing anywhere.
 */
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIB = join(root, "library", "broll-engine");

let failed = 0, warned = 0;
const ok = (m, d) => console.log(`  \x1b[32mok\x1b[0m   ${m}${d ? `  \x1b[2m${d}\x1b[0m` : ""}`);
const warn = (m, fix) => { warned++; console.log(`  \x1b[33mwarn\x1b[0m ${m}`); if (fix) console.log(`       \x1b[2m${fix}\x1b[0m`); };
const bad = (m, fix) => { failed++; console.log(`  \x1b[31mFAIL\x1b[0m ${m}`); if (fix) console.log(`       \x1b[2m${fix}\x1b[0m`); };
const head = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`);

/** Parse a .env the way platform/src/lib/env.ts does. */
function readDotenv(path) {
  const out = {};
  if (!existsSync(path)) return null;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function run(cmd, args, opts = {}) {
  try {
    return { out: execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim() };
  } catch (e) {
    return { err: (e.stderr || e.stdout || e.message || "").toString().trim() };
  }
}

// ─── 1. toolchain ────────────────────────────────────────────────────────────
head("1. Toolchain");
{
  const major = Number(process.versions.node.split(".")[0]);
  major >= 22
    ? ok(`node ${process.versions.node}`)
    : bad(`node ${process.versions.node} — the platform's tests need --experimental-strip-types (node 22+)`);

  const pnpm = run("pnpm", ["--version"]);
  pnpm.out ? ok(`pnpm ${pnpm.out}`) : bad("pnpm not on PATH", 'corepack enable && export PATH="$HOME/.local/bin:$PATH"');

  existsSync(join(root, "node_modules"))
    ? ok("node_modules installed")
    : bad("node_modules missing", "pnpm install     # in the lusora repo root");

  // ffmpeg renders every video and cuts every clip; both repos shell out to it.
  const ff = run("ffmpeg", ["-version"]);
  ff.out ? ok(`ffmpeg ${ff.out.split("\n")[0].split(" ")[2]}`)
         : bad("ffmpeg not on PATH — the renderer and the library's cutter both shell out to it",
               "sudo apt-get install -y ffmpeg");
}

// ─── 2. the submodule ────────────────────────────────────────────────────────
head("2. Library submodule (library/broll-engine)");
{
  if (!existsSync(join(LIB, "api.py"))) {
    bad("library/broll-engine is empty — a clone does not fetch submodule contents",
        "git submodule update --init --recursive     # in the lusora repo root");
  } else {
    ok("checked out");
    // A pin the parent repo records but the submodule's remote does not have on
    // any branch is a clone that cannot be reproduced.
    const pin = run("git", ["-C", root, "ls-tree", "HEAD", "library/broll-engine"]).out || "";
    const want = pin.split(/\s+/)[2];
    const have = run("git", ["-C", LIB, "rev-parse", "HEAD"]).out;
    if (want && have && want !== have) {
      warn(`submodule is at ${have.slice(0, 8)}, the parent pins ${want.slice(0, 8)}`,
           "git submodule update --recursive          # or commit the new pin deliberately");
    } else if (want) {
      ok(`at the pinned commit`, want.slice(0, 8));
    }
    // A gitlink records the child's HEAD commit, never its working tree — so
    // an uncommitted edit in here is in neither repo's history. It survives
    // locally and vanishes on the next clone, taking whatever it fixed.
    const dirty = run("git", ["-C", LIB, "status", "--porcelain"]).out;
    if (dirty) warn("submodule working tree is dirty — those edits are in neither repo and are lost on re-clone",
                    "cd library/broll-engine && git checkout -b <branch> && git commit && git push   # then re-pin");
  }
}

// ─── 3. the shared .env, and what the shell is doing to it ───────────────────
head("3. Shared .env (repo root)");
const env = readDotenv(join(root, ".env"));
{
  if (!env) {
    bad(".env missing", "cp .env.example .env     # then fill DATABASE_URL and SESSION_SECRET");
  } else {
    ok(".env present");
    for (const k of ["DATABASE_URL", "SESSION_SECRET", "LIBRARY_API_URL"]) {
      if (!env[k]) bad(`${k} is not set in .env`);
    }
    if (env.SESSION_SECRET === "change-me-to-a-long-random-string")
      warn("SESSION_SECRET is still the placeholder from .env.example");

    // The trap that cost an afternoon: loadEnv() skips any key already in
    // process.env, and Next reads .env once per process. An export in the shell
    // wins over the file, forever, and nothing says so.
    for (const k of Object.keys(env)) {
      if (process.env[k] !== undefined && process.env[k] !== env[k]) {
        warn(`$${k} is exported in this shell as "${process.env[k]}" and OVERRIDES .env ("${env[k]}")`,
             `unset ${k}     # the .env value only applies to a process started without it`);
      }
    }
  }
}

// ─── 4. control-plane Postgres ───────────────────────────────────────────────
head("4. Control-plane database (lusora)");
const psql = run("psql", ["--version"]).out ? "psql" : null;
if (!psql) {
  warn("psql not on PATH — skipping the database checks", "sudo apt-get install -y postgresql-client");
} else if (env?.DATABASE_URL) {
  const q = (dsn, sql) => run("psql", [dsn, "-tAc", sql], { env: { ...process.env, PGCONNECT_TIMEOUT: "5" } });
  const r = q(env.DATABASE_URL, "select 1");
  if (r.err) {
    bad(`cannot connect: ${r.err.split("\n")[0]}`,
        "check the host/port/database in DATABASE_URL — a dev cluster on 5433 is not the system one on 5432");
  } else {
    ok("reachable", env.DATABASE_URL.replace(/:\/\/[^@]*@/, "://***@"));
    const t = q(env.DATABASE_URL, "select count(*) from information_schema.tables where table_schema='public'");
    Number(t.out) > 0
      ? ok(`schema present`, `${t.out} tables`)
      : bad("no tables — migrations have not run",
            "pnpm --filter @lusora/platform run db:migrate && pnpm --filter @lusora/platform run db:seed");
  }
}

// ─── 5. the library's own env and database ───────────────────────────────────
head("5. Library database (broll)");
{
  const libEnv = readDotenv(join(LIB, ".env"));
  const dsn = process.env.BROLL_DATABASE_URL || libEnv?.BROLL_DATABASE_URL
    || (libEnv === null ? null : "postgresql://broll:broll@localhost:5432/broll");
  if (libEnv === null) {
    bad("library/broll-engine/.env missing",
        "cp library/broll-engine/.env.example library/broll-engine/.env     # then set BROLL_DATABASE_URL");
  } else if (!libEnv.BROLL_DATABASE_URL) {
    warn("BROLL_DATABASE_URL not set — the library falls back to its default DSN",
         "set BROLL_DATABASE_URL in library/broll-engine/.env so the two databases can never be confused");
  }
  // The two databases must be DIFFERENT. They hold unrelated schemas, and the
  // library runs CREATE TABLE on connect.
  if (dsn && env?.DATABASE_URL && dsn.replace(/^postgres:/, "postgresql:") === env.DATABASE_URL.replace(/^postgres:/, "postgresql:")) {
    bad("the library and the platform are pointed at the SAME database",
        "give the library its own DSN — it runs its schema DDL on connect");
  }
  if (psql && dsn) {
    const r = run("psql", [dsn, "-tAc", "select extname from pg_extension where extname='vector'"],
                  { env: { ...process.env, PGCONNECT_TIMEOUT: "5" } });
    if (r.err) bad(`cannot connect: ${r.err.split("\n")[0]}`, "bash library/broll-engine/setup_postgres.sh     # run with sudo");
    else if (r.out !== "vector") bad("pgvector extension missing", `psql "${dsn}" -c 'CREATE EXTENSION vector;'`);
    else ok("reachable, pgvector installed", dsn.replace(/:\/\/[^@]*@/, "://***@"));
  }

  existsSync(join(LIB, ".venv", "bin", "python"))
    ? ok("library venv present")
    : bad("library/broll-engine/.venv missing — a venv is git-ignored, so it never arrives with a clone",
          "cd library/broll-engine && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt");
}

// ─── 6. worker ───────────────────────────────────────────────────────────────
head("6. Worker");
{
  existsSync(join(root, "worker", ".venv"))
    ? ok("worker venv present")
    : warn("worker/.venv missing", "cd worker && uv sync     # uv resolves the project by cwd");
}

// ─── 7. is anything actually up ──────────────────────────────────────────────
head("7. Services");
{
  const base = process.env.LIBRARY_API_URL || env?.LIBRARY_API_URL;
  if (!base) { warn("LIBRARY_API_URL unknown — skipping"); }
  else {
    const r = await fetch(`${base}/profile`, { signal: AbortSignal.timeout(3000) })
      .then((x) => x.json()).catch((e) => ({ _err: String(e) }));
    if (r._err) {
      warn(`library API not answering at ${base} (fine if you have not started it yet)`,
           "cd library/broll-engine && .venv/bin/uvicorn api:app --host 127.0.0.1 --port 8321");
    } else {
      ok(`library API up at ${base}`, `profile "${r.name ?? "?"}", embed_dim ${r.embed_dim ?? "?"}`);
      // Clip bytes under /tmp are destroyed on reboot, and the source video is
      // deleted after tagging — there is nothing to re-download from.
      if (typeof r.clip_root === "string" && r.clip_root.startsWith("/tmp"))
        bad(`clip_root is under /tmp (${r.clip_root}) — a reboot destroys the footage permanently`,
            "set BROLL_CLIP_ROOT in library/broll-engine/.env");
      else if (r.clip_root) ok("clip_root is durable", r.clip_root);
      if (r.read_only) warn("this profile is READ-ONLY — ingest is disabled and the queue will 503");
    }
  }
}

console.log(
  failed ? `\n\x1b[31m${failed} problem(s) to fix\x1b[0m` + (warned ? `, ${warned} warning(s)` : "")
         : warned ? `\n\x1b[33mready, with ${warned} warning(s)\x1b[0m`
                  : "\n\x1b[32mready\x1b[0m");
process.exit(failed ? 1 : 0);
