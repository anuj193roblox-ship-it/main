// Display helpers. Pure, so both server and client components can use them.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-11-02..." -> "2 November 2026". Unknown input -> "". */
export function formatDay(value: unknown): string {
  const m = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  if (!m) return "";
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** [1,2,3,4,5] -> "Mon to Fri"; all seven -> "Every day". */
export function formatDays(days: number[]): string {
  const d = [...new Set(days)].sort();
  if (d.length === 7) return "Every day";
  if (d.join() === "1,2,3,4,5") return "Mon to Fri";
  if (d.join() === "0,6") return "Weekends";
  return d.map((n) => DAY_LABELS[n]).join(", ");
}

export const ITEM_TYPE_LABELS: Record<string, string> = {
  medication: "Medicine",
  meal: "Meal",
  water: "Water",
  exercise: "Exercise",
  sleep: "Sleep",
  appointment: "Appointment",
  checkin_question: "Check-in question",
  reading: "Reading",
};

export const SEVERITY_LABELS: Record<string, string> = { normal: "Normal", important: "Important", critical: "Critical" };
