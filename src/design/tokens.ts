// Single source of truth for Nurra colours (spec section 3.1).
// globals.css mirrors these values; src/design/tokens.test.ts fails if they drift.

export const lightTokens = {
  primary: "#1F6F5C",
  primaryPressed: "#17594A",
  primaryTint: "#EEF5F3",
  primaryTint2: "#D9EAE5",
  bg: "#FFFFFF",
  bgPatient: "#FFF9F0",
  surface: "#FFFFFF",
  text: "#1B2B27",
  textMuted: "#4A5D58",
  textPlaceholder: "#5E726C",
  border: "#C9DAD5",
  borderInput: "#6F8A83",
  ok: "#2E9E6B",
  warn: "#E0A100",
  danger: "#D64545",
  info: "#2F6FB5",
  okBg: "#E6F5EE",
  okText: "#1E7A50",
  warnBg: "#FFF4D6",
  warnText: "#7A5600",
  dangerBg: "#FDECEC",
  dangerText: "#A82E2E",
  infoBg: "#E8F1FB",
  infoText: "#245A94",
  neutralBg: "#EEF1F0",
  neutralText: "#505F5B",
  destructive: "#C23A3A",
} as const;

// Dark mode applies to the family app only. Patient mode stays light.
export const darkTokens = {
  bg: "#0F1A17",
  surface: "#16241F",
  text: "#E6F0EC",
  textMuted: "#A8BDB6",
  primary: "#4FB59A",
  borderInput: "#6E8A82",
  okText: "#5FD39B",
  warnText: "#F2C14E",
  dangerText: "#FF8A8A",
  infoText: "#8AB8EA",
} as const;

export type LightTokenName = keyof typeof lightTokens;
export type DarkTokenName = keyof typeof darkTokens;

/** camelCase token name to the CSS custom property name, e.g. primaryTint2 -> --primary-tint-2 */
export function cssVarName(token: string): string {
  const kebab = token
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/([a-zA-Z])(\d)/g, "$1-$2")
    .toLowerCase();
  return `--${kebab}`;
}

/** Medicine state mapping (spec section 3.2). Each state is colour + icon + word. */
export const medicineStates = {
  taken: { tone: "ok", icon: "check-circle", word: "Taken" },
  givenBy: { tone: "info", icon: "user-check", word: "Given by" },
  pending: { tone: "neutral", icon: "clock", word: "Due" },
  missed: { tone: "danger", icon: "alert-circle", word: "Missed" },
  refused: { tone: "warn", icon: "alert-triangle", word: "Refused" },
  unverified: { tone: "warn", icon: "alert-triangle", word: "Unverified" },
  verified: { tone: "ok", icon: "check-circle", word: "Verified by" },
  // A family member or clinician confirmed the entry; a clinician has not verified it yet.
  approved: { tone: "info", icon: "user-check", word: "Approved by" },
  stopped: { tone: "neutral", icon: "clock", word: "Stopped" },
} as const;

export type MedicineState = keyof typeof medicineStates;
