// Time helpers for the patient's own timezone.

/** Accepts "2026-11-02T10:00:00+00:00" (Supabase) and "2026-11-02 10:00:00+00" (Postgres text). */
export function toMillis(value: unknown): number {
  if (typeof value !== "string") return Number.NaN;
  let v = value.trim().replace(" ", "T");
  if (/[+-]\d{2}$/.test(v)) v += ":00";
  return Date.parse(v);
}

export type LocalParts = {
  /** "Sunday 2 November 2026, 10:05" for the model. */
  label: string;
  /** "2026-11-02" in the patient's timezone. */
  isoDate: string;
  /** 0 = Sunday. */
  weekday: number;
  /** "10:05". */
  hhmm: string;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function localParts(date: Date, timeZone: string): LocalParts {
  let tz = timeZone;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
  } catch {
    tz = "Asia/Kolkata";
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const numeric = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const hhmm = `${parts.hour}:${parts.minute}`;
  return {
    label: `${parts.weekday} ${parts.day} ${parts.month} ${parts.year}, ${hhmm}`,
    isoDate: `${numeric.year}-${numeric.month}-${numeric.day}`,
    weekday: WEEKDAYS.indexOf(parts.weekday),
    hhmm,
  };
}
