// Shared test database: in-memory Postgres (PGlite) with stand-ins for Supabase's auth schema and
// roles, and every migration in supabase/migrations applied in order.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const migrationsDir = path.join(process.cwd(), "supabase/migrations");

export function migrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();
}

export function readSeed(): string {
  return readFileSync(path.join(process.cwd(), "supabase/seed.sql"), "utf8");
}

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
  `);
  for (const file of migrationFiles()) {
    const sql = readFileSync(path.join(migrationsDir, file), "utf8").replace(
      "create extension if not exists pgcrypto;",
      "-- pgcrypto skipped in PGlite: gen_random_uuid() is built in",
    );
    await db.exec(sql);
  }
  // Supabase's default grants: table privileges exist, RLS decides what rows are visible.
  await db.exec(`
    grant all on all tables in schema public to authenticated, service_role;
    grant all on all sequences in schema public to authenticated, service_role;
  `);
  return db;
}

/** Run fn as a role. uid null means signed out. RLS and function privileges apply. */
export async function asRole<T>(
  db: PGlite,
  role: "authenticated" | "anon" | "service_role",
  uid: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role;`);
  }
}
