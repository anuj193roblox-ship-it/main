// "Apply this change to the reminders?" (CARE-6). A plan item linked to a vault medicine keeps a
// snapshot of the medicine as the plan last accepted it. When the vault entry differs, the change
// is shown before and after, and nothing in the plan moves until a person decides.
import { hhmm, str } from "./context";
import type { Row } from "./db";

export type MedicineSnapshot = {
  strength: string;
  dose: string;
  frequency: string;
  timing: string[];
  status: string;
};

const FIELDS: { key: keyof MedicineSnapshot; label: string }[] = [
  { key: "strength", label: "Strength" },
  { key: "dose", label: "Dose" },
  { key: "frequency", label: "How often" },
  { key: "timing", label: "Times" },
  { key: "status", label: "Status" },
];

export function snapshotOf(med: Row): MedicineSnapshot {
  const timing = Array.isArray(med.timing) ? med.timing.map(hhmm).filter(Boolean).sort() : [];
  return { strength: str(med.strength), dose: str(med.dose), frequency: str(med.frequency), timing, status: str(med.status) || "active" };
}

function readSnapshot(value: unknown): MedicineSnapshot | null {
  if (!value || typeof value !== "object") return null;
  return snapshotOf(value as Row);
}

const show = (v: string | string[]) => (Array.isArray(v) ? (v.length ? v.join(", ") : "No times") : v || "Not set");

export type MedicineChange = {
  changes: { field: string; label: string; before: string; after: string }[];
  /** What the plan item would become if the change is applied. */
  proposal: { times?: string[]; deactivate: boolean };
  current: MedicineSnapshot;
};

/** null when the plan already matches the medicine (or there is nothing to compare). */
export function medicineChange(snapshotValue: unknown, med: Row): MedicineChange | null {
  const before = readSnapshot(snapshotValue);
  if (!before) return null;
  const after = snapshotOf(med);
  const changes = FIELDS.filter(({ key }) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).map(({ key, label }) => ({
    field: key,
    label,
    before: show(before[key]),
    after: show(after[key]),
  }));
  if (changes.length === 0) return null;

  const timingChanged = JSON.stringify(before.timing) !== JSON.stringify(after.timing);
  return {
    changes,
    proposal: {
      times: timingChanged && after.timing.length > 0 ? after.timing : undefined,
      deactivate: after.status === "stopped" && before.status !== "stopped",
    },
    current: after,
  };
}
