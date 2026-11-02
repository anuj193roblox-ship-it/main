// A small data layer for the care services. Every call is scoped by the caller (the services always
// put household_id in `where`), and runs with the signed-in user's session, so row-level security
// and the database triggers (audit, medicine verification, activation) apply to every write.
import type { SupabaseClient } from "@supabase/supabase-js";

export type Row = Record<string, unknown>;

export const CARE_TABLES = [
  "patients",
  "conditions",
  "medications",
  "allergies",
  "contacts",
  "consents",
  "care_plans",
  "care_plan_items",
  "users",
  // Stage S4 (patient devices and check-ins). Written by the server with the device context.
  "reminders",
  "conversations",
  "messages",
  "alerts",
  "events",
  "device_tokens",
  "device_pairings",
  // Stage S5 (reminder engine). Read by the server; written only through the functions below.
  "escalation_steps",
] as const;
export type CareTable = (typeof CARE_TABLES)[number];

/** Database functions the server may call. */
export const CARE_FUNCTIONS = [
  "consume_pairing_code",
  // Stage S5: the reminder engine (service role only).
  "generate_reminders",
  "claim_due_reminders",
  "apply_reminder_step",
  "confirm_reminder",
  "acknowledge_alert",
] as const;
export type CareFunction = (typeof CARE_FUNCTIONS)[number];

export class DbError extends Error {
  constructor(
    /** Postgres SQLSTATE (e.g. 23503) or PostgREST code. */
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type Order = { column: string; ascending?: boolean };

export interface Db {
  select(table: CareTable, where: Row, order?: Order): Promise<Row[]>;
  insert(table: CareTable, row: Row): Promise<Row>;
  /** Returns the updated rows. An empty array means nothing matched (or RLS hid it). */
  update(table: CareTable, where: Row, patch: Row): Promise<Row[]>;
  /** Returns how many rows were deleted. */
  remove(table: CareTable, where: Row): Promise<number>;
  /** Calls a server-only database function. Returns its rows. */
  rpc(fn: CareFunction, args: Row): Promise<Row[]>;
}

function fail(error: { code?: string; message: string }): never {
  throw new DbError(error.code || "unknown", error.message);
}

/** Production implementation on the Supabase client of the signed-in user (anon key + session). */
export function supabaseDb(client: SupabaseClient): Db {
  return {
    async select(table, where, order) {
      let q = client.from(table).select("*").match(where);
      if (order) q = q.order(order.column, { ascending: order.ascending ?? true });
      const { data, error } = await q;
      if (error) fail(error);
      return (data ?? []) as Row[];
    },
    async insert(table, row) {
      const { data, error } = await client.from(table).insert(row).select("*").single();
      if (error) fail(error);
      return data as Row;
    },
    async update(table, where, patch) {
      const { data, error } = await client.from(table).update(patch).match(where).select("*");
      if (error) fail(error);
      return (data ?? []) as Row[];
    },
    async remove(table, where) {
      const { data, error } = await client.from(table).delete().match(where).select("id");
      if (error) fail(error);
      return (data ?? []).length;
    },
    async rpc(fn, args) {
      const { data, error } = await client.rpc(fn, args);
      if (error) fail(error);
      return (Array.isArray(data) ? data : data ? [data] : []) as Row[];
    },
  };
}
