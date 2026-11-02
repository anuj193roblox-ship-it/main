import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migrationDir = path.join(root, "supabase/migrations");
// All migrations together, in order: later files must keep the rules too.
const migration = readdirSync(migrationDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(migrationDir, f), "utf8"))
  .join("\n");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
const srcFiles = walk(path.join(root, "src")).filter((f) => /\.(ts|tsx|css)$/.test(f));
const rel = (f: string) => path.relative(root, f).replaceAll("\\", "/");

describe("schema: RLS on every table (PLAT-1)", () => {
  const tables = [...migration.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);

  it("creates the Phase 1 tables", () => {
    for (const t of ["households", "users", "patients", "contacts", "consents", "care_plans", "care_plan_items",
      "reminders", "escalation_steps", "events", "alerts", "conversations", "messages", "daily_summaries", "media",
      "device_tokens", "ack_tokens", "audit_log", "conditions", "medications", "allergies", "providers",
      "vault_documents"]) {
      expect(tables).toContain(t);
    }
  });

  it.each(tables)("%s has RLS enabled", (t) => {
    expect(migration).toContain(`alter table public.${t} enable row level security;`);
  });

  it("every table has household_id (directly or as its primary key for households)", () => {
    for (const t of tables) {
      const body = migration.slice(migration.indexOf(`create table public.${t} (`));
      const def = body.slice(0, body.indexOf("\n);"));
      if (t === "households") continue;
      expect(def, `${t} needs household_id`).toContain("household_id");
    }
  });

  it("escalation steps are unique per reminder and step (REM-4)", () => {
    expect(migration).toMatch(/unique \(reminder_id, step\)/);
  });

  it("users has no client write policy (role and household are server-controlled)", () => {
    expect(migration).not.toMatch(/create policy \w+ on public\.users\s+for (insert|update|delete)/);
  });

  it("token and invite tables have no client policies", () => {
    expect(migration).not.toMatch(/on public\.(device_tokens|ack_tokens|invites|device_pairings)\s+for/);
  });

  it("auth functions are revoked from clients and granted to service_role only", () => {
    for (const fn of ["check_rate_limit", "reset_rate_limit", "create_household_for_user", "claim_demo_household", "accept_invite", "consume_pairing_code"]) {
      expect(migration, fn).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`));
      expect(migration, fn).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role;`));
    }
  });
});

describe("service-role key stays server-side", () => {
  // The key's variable name. (The Postgres role "service_role" in SQL tests is not the key.)
  const withKey = srcFiles.filter((f) => /SERVICE_ROLE_KEY/.test(readFileSync(f, "utf8")));

  it("is only referenced from allowed server files", () => {
    const allowed = ["src/lib/env.ts", "src/lib/supabase/admin.ts", "src/security/security.test.ts",
      "src/security/rls.live.test.ts"];
    expect(withKey.map(rel).filter((f) => !allowed.includes(f))).toEqual([]);
  });

  it("the admin client imports server-only", () => {
    expect(readFileSync(path.join(root, "src/lib/supabase/admin.ts"), "utf8")).toContain('import "server-only"');
  });

  it("no client component touches serverEnv or the admin client", () => {
    for (const f of srcFiles) {
      const text = readFileSync(f, "utf8");
      if (!text.startsWith('"use client"')) continue;
      expect(text, rel(f)).not.toMatch(/serverEnv|createAdminClient|SERVICE_ROLE/);
    }
  });

  it("no NEXT_PUBLIC_ variable carries a secret", () => {
    const envExample = readFileSync(path.join(root, ".env.example"), "utf8");
    expect(envExample).not.toMatch(/NEXT_PUBLIC_\w*(SERVICE|SECRET|PRIVATE)/i);
    for (const f of srcFiles) {
      expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/NEXT_PUBLIC_\w*(SERVICE|SECRET|PRIVATE)/i);
    }
  });

  it(".env.example holds no real values", () => {
    const lines = readFileSync(path.join(root, ".env.example"), "utf8")
      .split("\n")
      .filter((l) => /^[A-Z_]+=/.test(l));
    for (const l of lines) expect(l.split("=")[1].trim(), l).toBe("");
  });
});

describe("roles come only from public.users", () => {
  it("no source file reads user_metadata or app_metadata (clients can write user_metadata at sign-up)", () => {
    const offenders = srcFiles
      .filter((f) => !f.endsWith(".test.ts"))
      .filter((f) => /user_metadata|app_metadata|raw_user_meta_data/.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("sign-up passes no metadata to Supabase", () => {
    const route = readFileSync(path.join(root, "src/app/api/auth/signup/route.ts"), "utf8");
    expect(route).toMatch(/signUp\(\{ email, password, options: \{ emailRedirectTo, captchaToken \} \}\)/);
    expect(route).not.toMatch(/\bdata\s*:/);
  });

  it("every state-changing route handler checks the Origin first", () => {
    const routes = srcFiles.filter((f) => /src[\\/]app[\\/]api[\\/].*route\.ts$/.test(f));
    expect(routes.length).toBeGreaterThanOrEqual(23);
    let handlers = 0;
    for (const f of routes) {
      const text = readFileSync(f, "utf8");
      // Every exported state-changing handler in the file, not only the first.
      for (const m of text.matchAll(/export async function (POST|PUT|PATCH|DELETE)\([^)]*\)[^{]*\{([^]{0,120})/g)) {
        handlers++;
        expect(m[2], `${rel(f)} ${m[1]}`).toMatch(/^\s*const blocked = rejectCrossSite\(request\);\s*if \(blocked\) return blocked;/);
      }
    }
    expect(handlers).toBeGreaterThanOrEqual(33); // 13 auth (S2) + 13 care (S3) + 7 patient devices (S4)
  });
});

describe("design rules", () => {
  it("no hex colours outside src/design/tokens.ts and globals.css", () => {
    const offenders = srcFiles
      .filter((f) => !["src/design/tokens.ts", "src/app/globals.css"].includes(rel(f)))
      .filter((f) => !f.endsWith(".test.ts"))
      .filter((f) => /#[0-9a-fA-F]{6}\b/.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("the style page and layout use tokens, not literals", () => {
    expect(readFileSync(path.join(root, "src/app/layout.tsx"), "utf8")).toContain("lightTokens.primary");
  });
});

describe("PWA", () => {
  it("manifest has name, standalone display and icons that exist", async () => {
    const { default: manifest } = await import("@/app/manifest");
    const m = manifest();
    expect(m.name).toBe("Nurra");
    expect(m.display).toBe("standalone");
    expect(m.icons?.length).toBeGreaterThanOrEqual(2);
    for (const icon of m.icons ?? []) {
      expect(() => statSync(path.join(root, "public", icon.src))).not.toThrow();
    }
  });

  it("the service worker caches nothing", () => {
    const sw = readFileSync(path.join(root, "public/sw.js"), "utf8");
    expect(sw).not.toMatch(/caches\.|cache\.put|cache\.add/);
  });
});

describe("seed data", () => {
  const seed = readFileSync(path.join(root, "supabase/seed.sql"), "utf8");
  it("has Meera, Anita and Ravi and a dementia plan", () => {
    expect(seed).toContain("Meera");
    expect(seed).toContain("'Anita'");
    expect(seed).toContain("'Ravi'");
    expect(seed).toContain("'dementia'");
  });
  it("never seeds a verified medicine", () => {
    expect(seed).not.toMatch(/verified_by/);
  });
});
