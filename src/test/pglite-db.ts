// The care data layer on PGlite, for tests. Same interface as supabaseDb(), and it runs every call
// as the signed-in user (role "authenticated" with their id), so RLS and every trigger apply exactly
// as they do through the Supabase API.
import type { PGlite } from "@electric-sql/pglite";
import { CARE_FUNCTIONS, CARE_TABLES, type CareTable, type Db, DbError, type Order, type Row } from "@/lib/care/db";
import { asRole } from "./pglite";

const IDENT = /^[a-z_]+$/;
// Dates and timestamps come back as text, like the Supabase API returns them.
const RAW = (v: string) => v;
const parsers = { 1082: RAW, 1114: RAW, 1184: RAW };

function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`bad identifier ${name}`);
  return name;
}

function table(t: CareTable): string {
  if (!CARE_TABLES.includes(t)) throw new Error(`table not allowed: ${t}`);
  return `public.${t}`;
}

/** PGlite serializes arrays and JSON by the column's type, like PostgREST does. */
function param(value: unknown): unknown {
  return value === undefined ? null : value;
}

function whereClause(where: Row, offset: number): { sql: string; values: unknown[] } {
  const keys = Object.keys(where);
  if (keys.length === 0) return { sql: "true", values: [] };
  return {
    sql: keys.map((k, i) => `${ident(k)} = $${i + 1 + offset}`).join(" and "),
    values: keys.map((k) => param(where[k])),
  };
}

/** As the signed-in user (RLS applies). */
export function pgliteDb(db: PGlite, userId: string): Db {
  return makeDb(db, "authenticated", userId);
}

/** As the server with the service role (RLS bypassed), like the device routes. */
export function pgliteServiceDb(db: PGlite): Db {
  return makeDb(db, "service_role", null);
}

function makeDb(db: PGlite, role: "authenticated" | "service_role", userId: string | null): Db {
  const run = async (sql: string, values: unknown[]): Promise<Row[]> => {
    try {
      return await asRole(db, role, userId, async () => (await db.query<Row>(sql, values, { parsers })).rows);
    } catch (e) {
      const err = e as { code?: string; message?: string };
      throw new DbError(err.code ?? "unknown", err.message ?? "error");
    }
  };

  return {
    async select(t, where, order?: Order) {
      const w = whereClause(where, 0);
      const orderBy = order ? ` order by ${ident(order.column)} ${order.ascending === false ? "desc" : "asc"}` : "";
      return run(`select * from ${table(t)} where ${w.sql}${orderBy}`, w.values);
    },
    async insert(t, row) {
      const keys = Object.keys(row);
      const rows = await run(
        `insert into ${table(t)} (${keys.map(ident).join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`,
        keys.map((k) => param(row[k])),
      );
      return rows[0];
    },
    async update(t, where, patch) {
      const keys = Object.keys(patch);
      const w = whereClause(where, keys.length);
      return run(
        `update ${table(t)} set ${keys.map((k, i) => `${ident(k)} = $${i + 1}`).join(", ")} where ${w.sql} returning *`,
        [...keys.map((k) => param(patch[k])), ...w.values],
      );
    },
    async remove(t, where) {
      const w = whereClause(where, 0);
      return (await run(`delete from ${table(t)} where ${w.sql} returning id`, w.values)).length;
    },
    async rpc(fn, args) {
      if (!CARE_FUNCTIONS.includes(fn)) throw new Error(`function not allowed: ${fn}`);
      const keys = Object.keys(args);
      return run(`select * from public.${ident(fn)}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(", ")})`, keys.map((k) => param(args[k])));
    },
  };
}
