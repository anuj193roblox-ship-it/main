// The migration runner (scripts/migrate-core.mjs) against PGlite. It never touches a real database.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asRole, createTestDb } from "@/test/pglite";
import {
  assertNotProduction,
  checksum,
  checkStatus,
  describeUrlProblems,
  listMigrationFiles,
  parseArgs,
  redact,
  resolveBaseline,
  runMigrations,
  runSeed,
  TRACKING_TABLE,
} from "../../scripts/migrate-core.mjs";

const realDir = path.join(process.cwd(), "supabase/migrations");
const REAL = listMigrationFiles(realDir);

/** pg-style client over PGlite. Multi-statement files go through exec, like pg's simple query. */
function clientFor(db: PGlite) {
  return {
    async query(sql: string, params?: unknown[]) {
      if (params) return { rows: (await db.query(sql, params)).rows as Record<string, unknown>[] };
      // PGlite has no pgcrypto extension; gen_random_uuid() is built in.
      const results = await db.exec(sql.replace("create extension if not exists pgcrypto;", "select 1;"));
      return { rows: (results.at(-1)?.rows ?? []) as Record<string, unknown>[] };
    },
  };
}

const tracked = async (db: PGlite) =>
  (await db.query<{ filename: string; baselined: boolean }>(`select filename, baselined from ${TRACKING_TABLE} order by filename`)).rows;
const tableExists = async (db: PGlite, name: string) =>
  (await db.query<{ ok: boolean }>(`select to_regclass($1) is not null as ok`, [name])).rows[0].ok;

let db: PGlite;
let lines: string[];
const log = (l: string) => lines.push(l);

beforeEach(async () => {
  db = await createTestDb({ migrate: false });
  lines = [];
}, 60_000);

afterEach(async () => {
  await db?.close();
});

describe("applying the real migrations", () => {
  it("applies every file in filename order, each recorded, and a second run applies nothing", async () => {
    expect(REAL).toEqual([...REAL].sort());
    const first = await runMigrations({ client: clientFor(db), dir: realDir, log });
    expect(first.ok).toBe(true);
    expect(first.applied).toEqual(REAL);
    expect(await tracked(db)).toEqual(REAL.map((filename) => ({ filename, baselined: false })));
    expect(await tableExists(db, "public.invites")).toBe(true);

    lines = [];
    const second = await runMigrations({ client: clientFor(db), dir: realDir, log });
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(REAL);
    expect(lines.every((l) => l.startsWith("skip") || l.startsWith("Done"))).toBe(true);
  });

  it("--baseline 0001 marks 0001 as applied without running it, then applies the rest", async () => {
    // 0001 is already in the database (run by hand). Running it again would fail: its tables exist.
    await clientFor(db).query(readFileSync(path.join(realDir, REAL[0]), "utf8"));
    const result = await runMigrations({ client: clientFor(db), dir: realDir, baseline: ["0001"], log });
    expect(result.ok).toBe(true);
    expect(result.baselined).toEqual([REAL[0]]);
    expect(result.applied).toEqual(REAL.slice(1));
    expect((await tracked(db))[0]).toEqual({ filename: REAL[0], baselined: true });
  });

  it("--dry-run lists what it would do and changes nothing, not even the tracking table", async () => {
    const result = await runMigrations({ client: clientFor(db), dir: realDir, dryRun: true, baseline: ["0001"], log });
    expect(result.baselined).toEqual([REAL[0]]);
    expect(result.pending).toEqual(REAL.slice(1));
    expect(await tableExists(db, TRACKING_TABLE)).toBe(false);
    expect(await tableExists(db, "public.households")).toBe(false);
    expect(lines.at(-1)).toMatch(/Nothing was changed\.$/);
  });

  it("the tracking table is in a private schema that anon and authenticated cannot read or write", async () => {
    await runMigrations({ client: clientFor(db), dir: realDir, log });
    for (const role of ["anon", "authenticated"] as const) {
      await expect(asRole(db, role, null, () => db.query(`select * from ${TRACKING_TABLE}`))).rejects.toThrow(/permission denied/);
      await expect(asRole(db, role, null, () => db.query(`insert into ${TRACKING_TABLE} (filename, checksum) values ('x', 'y')`))).rejects.toThrow(
        /permission denied/,
      );
    }
  });
});

describe("--seed", () => {
  const seedFile = path.join(process.cwd(), "supabase/seed.sql");

  it("refuses before the migrations are applied, and changes nothing", async () => {
    await expect(runSeed({ client: clientFor(db), dir: realDir, seedFile })).rejects.toThrow(/Apply the migrations first/);
    expect(await tableExists(db, "public.patients")).toBe(false);
  });

  it("after the migrations, loads the demo data, and running it twice changes nothing", async () => {
    await runMigrations({ client: clientFor(db), dir: realDir, log: () => {} });
    await runSeed({ client: clientFor(db), dir: realDir, seedFile, log });
    await runSeed({ client: clientFor(db), dir: realDir, seedFile, log });
    const count = async (t: string) => (await db.query<{ n: number }>(`select count(*)::int as n from public.${t}`)).rows[0].n;
    expect(await count("patients")).toBe(1);
    expect(await count("contacts")).toBe(2);
    expect(await count("care_plan_items")).toBe(7);
    expect(lines).toContain("seed     seed.sql (done)");
  });
});

describe("--check", () => {
  it("on a fresh database: nothing recorded, tables missing, and it creates nothing", async () => {
    const result = await checkStatus({ client: clientFor(db), dir: realDir, log });
    expect(result).toEqual({
      tracking: false,
      applied: [],
      pending: REAL,
      changed: [],
      tables: { "public.patients": false, "public.invites": false },
    });
    expect(await tableExists(db, TRACKING_TABLE)).toBe(false);
    expect(lines).toContain("  (nothing recorded yet: db:migrate has not run against this database)");
    expect(lines).toContain("  missing  public.invites");
    expect(lines.at(-1)).toMatch(/Nothing was changed\.$/);
  });

  it("only 0001 in the database (the situation before db:migrate): patients exists, invites does not", async () => {
    await clientFor(db).query(readFileSync(path.join(realDir, REAL[0]), "utf8"));
    const result = await checkStatus({ client: clientFor(db), dir: realDir, log });
    expect(result.tables).toEqual({ "public.patients": true, "public.invites": false });
    expect(result.pending).toEqual(REAL);
  });

  it("after baselining 0001 and applying the rest, everything is listed and both tables exist", async () => {
    await clientFor(db).query(readFileSync(path.join(realDir, REAL[0]), "utf8"));
    await runMigrations({ client: clientFor(db), dir: realDir, baseline: ["0001"], log: () => {} });
    const result = await checkStatus({ client: clientFor(db), dir: realDir, log });
    expect(result.tracking).toBe(true);
    expect(result.applied).toEqual(REAL);
    expect(result.pending).toEqual([]);
    expect(result.tables).toEqual({ "public.patients": true, "public.invites": true });
    expect(lines.some((l) => l.startsWith(`  baselined ${REAL[0]}`))).toBe(true);
    expect(lines.some((l) => l.startsWith(`  applied  ${REAL[1]}`))).toBe(true);
  });

  it("changes nothing, even when run repeatedly", async () => {
    await runMigrations({ client: clientFor(db), dir: realDir, log: () => {} });
    const before = JSON.stringify(await tracked(db));
    await checkStatus({ client: clientFor(db), dir: realDir, log });
    await checkStatus({ client: clientFor(db), dir: realDir, log });
    expect(JSON.stringify(await tracked(db))).toBe(before);
  });
});

describe("failures", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "nurra-migrations-"));
    writeFileSync(path.join(dir, "0001_first.sql"), "create table public.first_ok (id int);");
    writeFileSync(path.join(dir, "0002_broken.sql"), "create table public.half_done (id int);\ninsert into public.no_such_table values (1);");
    writeFileSync(path.join(dir, "0003_later.sql"), "create table public.later (id int);");
    writeFileSync(path.join(dir, "README.md"), "not a migration");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("stops at the first error, rolls that file back, reports the file and message, and runs nothing after it", async () => {
    const result = await runMigrations({ client: clientFor(db), dir, log });
    expect(result.ok).toBe(false);
    expect(result.applied).toEqual(["0001_first.sql"]);
    expect(result.failed?.file).toBe("0002_broken.sql");
    expect(result.failed?.message).toMatch(/no_such_table/);
    expect(result.pending).toEqual(["0002_broken.sql", "0003_later.sql"]);
    expect(await tableExists(db, "public.first_ok")).toBe(true);
    expect(await tableExists(db, "public.half_done")).toBe(false); // rolled back
    expect(await tableExists(db, "public.later")).toBe(false); // never run
    expect((await tracked(db)).map((r) => r.filename)).toEqual(["0001_first.sql"]);
    expect(lines.some((l) => l.startsWith("FAILED   0002_broken.sql:") && l.includes("no_such_table"))).toBe(true);
  });

  it("each file and its tracking row share one transaction: begin, file, record, commit (or rollback)", async () => {
    const sent: string[] = [];
    const base = clientFor(db);
    const spy = {
      async query(sql: string, params?: unknown[]) {
        const s = sql.trim();
        if (s === "begin" || s === "commit" || s === "rollback") sent.push(s);
        else if (s.startsWith(`insert into ${TRACKING_TABLE}`)) sent.push("record");
        else if (s.startsWith("create table public.") || s.startsWith("insert into public.no_such")) sent.push(`file:${s.split(/[\s(;]+/)[2]}`);
        return base.query(sql, params);
      },
    };
    await runMigrations({ client: spy, dir, log });
    expect(sent).toEqual(["begin", "file:public.first_ok", "record", "commit", "begin", "file:public.half_done", "rollback"]);
  });

  it("after fixing the file, the next run continues where it stopped", async () => {
    await runMigrations({ client: clientFor(db), dir, log });
    writeFileSync(path.join(dir, "0002_broken.sql"), "create table public.half_done (id int);");
    const result = await runMigrations({ client: clientFor(db), dir, log });
    expect(result.ok).toBe(true);
    expect(result.skipped).toEqual(["0001_first.sql"]);
    expect(result.applied).toEqual(["0002_broken.sql", "0003_later.sql"]);
  });

  it("warns when an applied file was edited afterwards, without re-running it", async () => {
    writeFileSync(path.join(dir, "0002_broken.sql"), "select 1;");
    await runMigrations({ client: clientFor(db), dir, log });
    writeFileSync(path.join(dir, "0001_first.sql"), "create table public.first_ok (id int, extra int);");
    lines = [];
    await runMigrations({ client: clientFor(db), dir, log });
    expect(lines[0]).toBe("skip     0001_first.sql (already applied; WARNING: the file changed since it was applied)");
  });

  it("a baseline that matches no file is refused before anything changes", async () => {
    await expect(runMigrations({ client: clientFor(db), dir, baseline: ["0009"], log })).rejects.toThrow(/does not match exactly one/);
    expect(await tableExists(db, TRACKING_TABLE)).toBe(false);
  });
});

describe("command-line guards and helpers", () => {
  it("refuses to run when NODE_ENV is production", () => {
    expect(() => assertNotProduction({ NODE_ENV: "production" })).toThrow(/Refusing to run with NODE_ENV=production/);
    expect(() => assertNotProduction({ NODE_ENV: "development" })).not.toThrow();
    expect(() => assertNotProduction({})).not.toThrow();
  });

  it("parses --dry-run and --baseline in all its forms, and rejects anything else", () => {
    expect(parseArgs([])).toEqual({ dryRun: false, check: false, seed: false, baseline: [], help: false });
    expect(parseArgs(["--dry-run", "--baseline", "0001"])).toEqual({ dryRun: true, check: false, seed: false, baseline: ["0001"], help: false });
    expect(parseArgs(["--seed"]).seed).toBe(true);
    expect(() => parseArgs(["--check", "--seed"])).toThrow(/on its own/);
    expect(parseArgs(["--check"]).check).toBe(true);
    expect(() => parseArgs(["--check", "--dry-run"])).toThrow(/on its own/);
    expect(() => parseArgs(["--check", "--baseline", "0001"])).toThrow(/on its own/);
    expect(parseArgs(["--baseline=0001,0002", "--baseline", "0003"]).baseline).toEqual(["0001", "0002", "0003"]);
    expect(() => parseArgs(["--baseline"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--baseline", "--dry-run"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--force"])).toThrow(/Unknown option/);
  });

  it("resolves baseline references to exactly one file", () => {
    expect(resolveBaseline(["0001"], REAL)).toEqual([REAL[0]]);
    expect(resolveBaseline([REAL[0]], REAL)).toEqual([REAL[0]]);
    expect(() => resolveBaseline(["000"], REAL)).toThrow();
  });

  it("never prints the database URL or its password", () => {
    const url = "postgresql://postgres.abcd:S3cr3t%21pass@aws-0.pooler.supabase.com:5432/postgres";
    const parsed = new URL(url);
    const secrets = [url, decodeURIComponent(parsed.password), parsed.password];
    const message = `connect failed for ${url} (password S3cr3t!pass)`;
    const out = redact(message, secrets);
    expect(out).not.toContain("S3cr3t");
    expect(out).not.toContain(url);
  });

  it("explains a bad DATABASE_URL by shape only, never echoing it", () => {
    const secret = "Pa55w0rd";
    const cases: [string, RegExp][] = [
      [`postgresql://postgres.ref:[${secret}]@aws-0-x.pooler.supabase.com:5432/postgres`, /[ or ]/],
      [`postgresql://postgres.ref:${secret}@x@aws-0-x.pooler.supabase.com:5432/postgres`, /2 @ signs/],
      [`postgresql://postgres.<project-ref>:${secret}@aws-0-<region>.pooler.supabase.com:5432/postgres`, /< or >/],
      [`postgresql://postgres:${secret}@db.ref.supabase.co:5432/postgres`, /not the Session pooler/],
      [`"postgresql://postgres.ref:${secret}@aws-0-x.pooler.supabase.com:5432/postgres"`, /wrapped in quotes/],
      [`postgresql://postgres.ref:${secret} x@aws-0-x.pooler.supabase.com:5432/postgres`, /space/],
    ];
    for (const [url, expected] of cases) {
      const problems = describeUrlProblems(url);
      expect(problems.join(" | "), url).toMatch(expected);
      expect(problems.join(" "), url).not.toContain(secret);
    }
    expect(describeUrlProblems(`postgresql://postgres.ref:${secret}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`)).toEqual([]);
  });

  it("checksums ignore Windows line endings", () => {
    expect(checksum("a\r\nb")).toBe(checksum("a\nb"));
  });

  it("the CLI loads .env.local into a private object and never logs DATABASE_URL", () => {
    const cli = readFileSync(path.join(process.cwd(), "scripts/apply-migrations.mjs"), "utf8");
    expect(cli).toMatch(/processEnv: env, quiet: true/);
    expect(cli).not.toMatch(/console\.(log|error|warn)\([^)]*\burl\b/);
    expect(cli).not.toMatch(/process\.env\.DATABASE_URL/);
  });
});
