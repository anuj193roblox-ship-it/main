// Migration runner core. No database driver and no environment access here: the caller passes a
// client with query(sql, params?), so tests can use PGlite and the CLI can use pg.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const TRACKING_SCHEMA = "nurra_private";
export const TRACKING_TABLE = `${TRACKING_SCHEMA}.applied_migrations`;
const LOCK_KEY = 735_201_904; // any constant: one runner at a time per database

/** @typedef {{ query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }} SqlClient */

/** Throws when NODE_ENV is production. This tool is for setting up and developing only. */
export function assertNotProduction(env) {
  if (env.NODE_ENV === "production") {
    throw new Error("Refusing to run with NODE_ENV=production. Run migrations from a development shell.");
  }
}

/** Migration files in filename order: NNNN_name.sql. */
export function listMigrationFiles(dir) {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_[A-Za-z0-9_.-]+\.sql$/.test(f))
    .sort();
}

export function checksum(text) {
  return createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
}

/**
 * Parses CLI arguments: --dry-run, --check, --baseline 0001[,0002] (repeatable, also --baseline=0001), --help.
 * @returns {{ dryRun: boolean, check: boolean, seed: boolean, baseline: string[], help: boolean }}
 */
export function parseArgs(argv) {
  const out = { dryRun: false, check: false, seed: false, baseline: [], help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--check") out.check = true;
    else if (a === "--seed") out.seed = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--baseline" || a.startsWith("--baseline=")) {
      const value = a.includes("=") ? a.slice(a.indexOf("=") + 1) : argv[++i];
      if (!value || value.startsWith("--")) throw new Error("--baseline needs a value, for example --baseline 0001");
      out.baseline.push(...value.split(",").map((v) => v.trim()).filter(Boolean));
    } else throw new Error(`Unknown option: ${a}`);
  }
  if (out.check && (out.dryRun || out.seed || out.baseline.length > 0)) {
    throw new Error("--check only reads and reports. Use it on its own, without --dry-run, --seed or --baseline.");
  }
  return out;
}

/** Tables whose presence --check reports: one from 0001 and one from 0002. */
export const CHECK_TABLES = ["public.patients", "public.invites"];

/**
 * --check: reports which migration files are recorded as applied and whether key tables exist.
 * Read only: it never creates the tracking table or changes anything.
 *
 * @param {{ client: SqlClient, dir: string, log?: (line: string) => void }} opts
 * @returns {Promise<{ tracking: boolean, applied: string[], pending: string[], changed: string[], tables: Record<string, boolean> }>}
 */
export async function checkStatus({ client, dir, log = () => {} }) {
  const files = listMigrationFiles(dir);
  const tracking = await trackingExists(client);
  const rows = tracking
    ? (await client.query(`select filename, checksum, baselined, applied_at::text as applied_at from ${TRACKING_TABLE} order by filename`)).rows
    : [];
  const byName = new Map(rows.map((r) => [r.filename, r]));
  const result = { tracking, applied: [], pending: [], changed: [], tables: {} };

  log("Migrations:");
  if (!tracking) log("  (nothing recorded yet: db:migrate has not run against this database)");
  for (const f of files) {
    const row = byName.get(f);
    if (!row) {
      result.pending.push(f);
      log(`  pending  ${f}`);
      continue;
    }
    result.applied.push(f);
    const changed = row.checksum !== checksum(readFileSync(path.join(dir, f), "utf8"));
    if (changed) result.changed.push(f);
    const how = row.baselined ? "baselined" : "applied";
    log(`  ${how.padEnd(8)} ${f} (${String(row.applied_at).slice(0, 16)})${changed ? " WARNING: file changed since" : ""}`);
  }
  for (const r of rows) if (!files.includes(r.filename)) log(`  recorded ${r.filename} (no longer in supabase/migrations)`);

  log("Tables:");
  for (const t of CHECK_TABLES) {
    const { rows: found } = await client.query("select to_regclass($1) is not null as present", [t]);
    result.tables[t] = found[0]?.present === true;
    log(`  ${result.tables[t] ? "exists " : "missing"}  ${t}`);
  }
  log(`Summary: ${result.applied.length} recorded, ${result.pending.length} pending. Nothing was changed.`);
  return result;
}

/** "0001" or "0001_init" or "0001_init.sql" -> the matching file names. Every ref must match one file. */
export function resolveBaseline(refs, files) {
  const chosen = [];
  for (const ref of refs) {
    const matches = files.filter((f) => f === ref || f === `${ref}.sql` || f.startsWith(`${ref}_`));
    if (matches.length !== 1) throw new Error(`--baseline ${ref} does not match exactly one migration file`);
    if (!chosen.includes(matches[0])) chosen.push(matches[0]);
  }
  return chosen;
}

/** Hides secrets in text that is about to be printed (e.g. a driver error that echoes the URL). */
export function redact(text, secrets) {
  let out = String(text);
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join("[redacted]");
  return out;
}

async function trackingExists(client) {
  const { rows } = await client.query(`select to_regclass('${TRACKING_TABLE}') is not null as present`);
  return rows[0]?.present === true;
}

/** Creates the private schema and table. Clients (anon, authenticated) get no access at all. */
async function ensureTracking(client) {
  await client.query(`
    create schema if not exists ${TRACKING_SCHEMA};
    create table if not exists ${TRACKING_TABLE} (
      filename text primary key,
      checksum text not null,
      baselined boolean not null default false,
      applied_at timestamptz not null default now()
    );
    alter table ${TRACKING_TABLE} enable row level security;
    revoke all on schema ${TRACKING_SCHEMA} from public;
    revoke all on all tables in schema ${TRACKING_SCHEMA} from public;
    do $$
    declare r text;
    begin
      foreach r in array array['anon', 'authenticated'] loop
        if exists (select 1 from pg_roles where rolname = r) then
          execute format('revoke all on schema ${TRACKING_SCHEMA} from %I', r);
          execute format('revoke all on all tables in schema ${TRACKING_SCHEMA} from %I', r);
        end if;
      end loop;
    end
    $$;
  `);
}

async function appliedFiles(client) {
  if (!(await trackingExists(client))) return new Map();
  const { rows } = await client.query(`select filename, checksum from ${TRACKING_TABLE}`);
  return new Map(rows.map((r) => [r.filename, r.checksum]));
}

/**
 * Applies pending migrations in filename order, each in its own transaction, recording each one.
 * Stops at the first failure: that file is rolled back and nothing after it runs.
 *
 * @param {{ client: SqlClient, dir: string, dryRun?: boolean, baseline?: string[], log?: (line: string) => void }} opts
 * @returns {Promise<{ ok: boolean, applied: string[], baselined: string[], skipped: string[], pending: string[], failed?: { file: string, message: string } }>}
 */
export async function runMigrations({ client, dir, dryRun = false, baseline = [], log = () => {} }) {
  const files = listMigrationFiles(dir);
  const toBaseline = resolveBaseline(baseline, files);
  const result = { ok: true, applied: [], baselined: [], skipped: [], pending: [] };

  // Dry run: read only. It does not even create the tracking table.
  if (dryRun) {
    const done = await appliedFiles(client);
    for (const f of files) {
      if (done.has(f)) {
        result.skipped.push(f);
        log(`skip     ${f} (already applied)`);
      } else if (toBaseline.includes(f)) {
        result.baselined.push(f);
        log(`baseline ${f} (would mark as applied without running it)`);
      } else {
        result.pending.push(f);
        log(`apply    ${f} (would run)`);
      }
    }
    log(`Dry run: ${result.pending.length} to apply, ${result.baselined.length} to baseline, ${result.skipped.length} already applied. Nothing was changed.`);
    return result;
  }

  await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
  try {
    await ensureTracking(client);
    const done = await appliedFiles(client);

    for (const f of files) {
      const sql = readFileSync(path.join(dir, f), "utf8");
      const sum = checksum(sql);

      if (done.has(f)) {
        result.skipped.push(f);
        const changed = done.get(f) !== sum;
        log(`skip     ${f} (already applied${changed ? "; WARNING: the file changed since it was applied" : ""})`);
        continue;
      }

      if (toBaseline.includes(f)) {
        await client.query(`insert into ${TRACKING_TABLE} (filename, checksum, baselined) values ($1, $2, true)`, [f, sum]);
        result.baselined.push(f);
        log(`baseline ${f} (marked as applied, not run)`);
        continue;
      }

      const started = Date.now();
      try {
        await client.query("begin");
        await client.query(sql);
        await client.query(`insert into ${TRACKING_TABLE} (filename, checksum) values ($1, $2)`, [f, sum]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => {});
        const message = error instanceof Error ? error.message : String(error);
        result.ok = false;
        result.failed = { file: f, message };
        result.pending = files.slice(files.indexOf(f));
        log(`FAILED   ${f}: ${message}`);
        log(`Rolled back ${f}. Nothing after it was run.`);
        return result;
      }
      result.applied.push(f);
      log(`apply    ${f} (done in ${Date.now() - started} ms)`);
    }
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
  }

  log(`Done: ${result.applied.length} applied, ${result.baselined.length} baselined, ${result.skipped.length} already applied.`);
  return result;
}

/**
 * Explains what is wrong with a database URL WITHOUT revealing any of it: only yes/no facts about
 * its shape. Safe to print.
 * @returns {string[]}
 */
export function describeUrlProblems(url) {
  const problems = [];
  const value = String(url ?? "");
  if (value.trim() !== value) problems.push("it has spaces at the start or end");
  if (/^["']|["']$/.test(value.trim())) problems.push("it is wrapped in quotes");
  if (!/^postgres(ql)?:\/\//.test(value.trim().replace(/^["']/, ""))) problems.push("it does not start with postgresql://");
  if (/\s/.test(value.trim())) problems.push("it contains a space or line break");
  if (/[<>]/.test(value)) problems.push("it still contains < or > (a placeholder such as <region>)");
  if (/\[|\]/.test(value)) problems.push("it still contains [ or ] (for example [YOUR-PASSWORD])");
  const ats = (value.match(/@/g) ?? []).length;
  if (ats === 0) problems.push("it has no @ between the password and the host");
  if (ats > 1) problems.push(`it has ${ats} @ signs: the password contains @ (use %40, or a password of letters and numbers)`);
  if (value.includes("#")) problems.push("it contains # (in a password, use %23, or a password of letters and numbers)");
  if (/%(?![0-9A-Fa-f]{2})/.test(value)) problems.push("it contains a % that is not followed by two hex digits");
  if (!/pooler\.supabase\.com/.test(value)) problems.push("the host is not the Session pooler (…pooler.supabase.com)");
  if (!/:\d{4}\//.test(value)) problems.push("it has no port such as :5432/ before the database name");
  return problems;
}

/**
 * Runs supabase/seed.sql (demo data) in one transaction. The seed is idempotent (on conflict do
 * nothing), so running it twice changes nothing. Refuses unless every migration is applied.
 *
 * @param {{ client: SqlClient, dir: string, seedFile: string, log?: (line: string) => void }} opts
 */
export async function runSeed({ client, dir, seedFile, log = () => {} }) {
  const files = listMigrationFiles(dir);
  const done = await appliedFiles(client);
  const missing = files.filter((f) => !done.has(f));
  if (missing.length) throw new Error(`Apply the migrations first: ${missing.join(", ")} not applied.`);
  const sql = readFileSync(seedFile, "utf8");
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw new Error(`Seed failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`);
  }
  log(`seed     ${path.basename(seedFile)} (done)`);
}
