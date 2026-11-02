#!/usr/bin/env node
// Applies supabase/migrations/*.sql to the database in DATABASE_URL (from .env.local).
//
//   npm run db:migrate                     apply everything not applied yet
//   npm run db:migrate -- --dry-run        list what would happen, change nothing
//   npm run db:migrate -- --baseline 0001  mark 0001 as applied without running it
//   npm run db:migrate -- --check          show what is applied and whether key tables exist
//
// Development tool. It never prints DATABASE_URL and refuses to run with NODE_ENV=production.
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";
import { assertNotProduction, checkStatus, describeUrlProblems, parseArgs, redact, runMigrations, runSeed } from "./migrate-core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HELP = `Usage: npm run db:migrate -- [--dry-run] [--seed] [--baseline 0001[,0002]] | --check

  --check            Show which migrations are recorded as applied, and whether the
                     tables public.patients and public.invites exist. Changes nothing.
  --dry-run          List what would be applied. Changes nothing.
  --seed             After the migrations, load supabase/seed.sql (demo data). Safe to repeat.
  --baseline NNNN    Mark these files as applied WITHOUT running them
                     (for files you already ran by hand in the SQL editor).
`;

function fail(message, secrets = []) {
  console.error(redact(message, secrets));
  process.exit(1);
}

async function main() {
  assertNotProduction(process.env);

  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    fail(`${e.message}\n\n${HELP}`);
  }
  if (args.help) {
    console.log(HELP);
    return;
  }

  // Load .env.local into a private object: DATABASE_URL never enters process.env and is never printed.
  const env = {};
  const loaded = dotenv.config({ path: path.join(root, ".env.local"), processEnv: env, quiet: true });
  if (loaded.error) fail("Could not read .env.local. Create it from .env.example.");
  assertNotProduction({ NODE_ENV: env.NODE_ENV ?? process.env.NODE_ENV });

  const url = env.DATABASE_URL;
  if (!url) fail("DATABASE_URL is not set in .env.local. See the README section on database migrations.");

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    const hints = describeUrlProblems(url);
    const lines = ["DATABASE_URL in .env.local is not a valid postgres:// URL."];
    if (hints.length) lines.push("What looks wrong (the value itself is not shown):", ...hints.map((h) => `  - ${h}`));
    fail(lines.join("\n"));
  }
  let decoded = parsed.password;
  try {
    decoded = decodeURIComponent(parsed.password);
  } catch {
    // a stray % in the password: keep the raw form for redaction
  }
  const secrets = [url, decoded, parsed.password];
  const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);

  const client = new pg.Client({
    connectionString: url,
    // Supabase needs TLS. The connection is encrypted; certificate checking is on when
    // DATABASE_SSL_CA points to the CA certificate from the Supabase dashboard.
    ssl: local ? false : env.DATABASE_SSL_CA ? { ca: readFileSync(env.DATABASE_SSL_CA, "utf8") } : { rejectUnauthorized: false },
  });

  try {
    await client.connect();
  } catch (e) {
    // Facts that help fix the setting, none of them secret: file, save time, line count, host type.
    const envPath = path.join(root, ".env.local");
    const raw = readFileSync(envPath, "utf8");
    const count = raw.split(/\r?\n/).filter((l) => /^\s*(export\s+)?DATABASE_URL\s*=/.test(l)).length;
    const kind = parsed.hostname.endsWith("pooler.supabase.com")
      ? "Session/Transaction pooler (good)"
      : /^db\.[a-z0-9]+\.supabase\.co$/.test(parsed.hostname)
        ? "Direct connection (IPv6 only: use the Session pooler string instead)"
        : "not a Supabase host";
    fail(
      [
        `Could not connect to the database: ${e.message}`,
        `  file read:       ${envPath} (saved ${statSync(envPath).mtime.toLocaleString()})`,
        `  DATABASE_URL lines in it: ${count}${count > 1 ? " (the LAST one is used: delete the others)" : ""}`,
        `  host type:       ${kind}`,
      ].join("\n"),
      secrets,
    );
  }

  try {
    const log = (line) => console.log(redact(line, secrets));
    const dir = path.join(root, "supabase", "migrations");
    if (args.check) {
      await checkStatus({ client, dir, log });
      return;
    }
    const result = await runMigrations({ client, dir, dryRun: args.dryRun, baseline: args.baseline, log });
    if (!result.ok) process.exitCode = 1;
    else if (args.seed && !args.dryRun) await runSeed({ client, dir, seedFile: path.join(root, "supabase", "seed.sql"), log });
  } catch (e) {
    console.error(redact(`Migration run stopped: ${e.message}`, secrets));
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((e) => {
  // One clean line, no stack trace. Messages here never contain the database URL.
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
