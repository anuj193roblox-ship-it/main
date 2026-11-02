// Medicine state chips (spec 3.2), always colour + icon + word, from the design token mapping.
import type { ChipIcon, ChipTone } from "@/components/status-chip";
import { medicineStates } from "@/design/tokens";
import type { Row } from "./db";

export type ChipSpec = { tone: ChipTone; icon: ChipIcon; word: string };

const chip = (state: keyof typeof medicineStates, word?: string): ChipSpec => {
  const s = medicineStates[state];
  return { tone: s.tone as ChipTone, icon: s.icon as ChipIcon, word: word ?? s.word };
};

/** Verified by a clinician > approved by a person > Unverified. Plus "Stopped" when stopped. */
export function medicineChips(med: Row, names: Record<string, string>): ChipSpec[] {
  const chips: ChipSpec[] = [];
  const name = (id: unknown) => (typeof id === "string" && names[id]) || "a household member";
  if (med.verified_by) chips.push(chip("verified", `Verified by ${name(med.verified_by)}`));
  else if (med.approved_by) chips.push(chip("approved", `Approved by ${name(med.approved_by)}`));
  else chips.push(chip("unverified"));
  if (med.status === "stopped") chips.push(chip("stopped"));
  return chips;
}

export function isUnverified(med: Row): boolean {
  return !med.verified_by && !med.approved_by;
}
