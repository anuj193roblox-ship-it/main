import type { ReactElement } from "react";

export type ChipTone = "ok" | "warn" | "danger" | "info" | "neutral";
export type ChipIcon = "check-circle" | "alert-triangle" | "alert-circle" | "user-check" | "clock";

// Status is always colour + icon + word, never colour alone (spec 3.1).
// Light: tinted background with dark text. Dark: outlined, transparent background.
const toneClasses: Record<ChipTone, string> = {
  ok: "bg-ok-bg text-ok-text dark:border-ok",
  warn: "bg-warn-bg text-warn-text dark:border-warn",
  danger: "bg-danger-bg text-danger-text dark:border-danger",
  info: "bg-info-bg text-info-text dark:border-info",
  neutral: "bg-neutral-bg text-neutral-text dark:border-line-input",
};

const iconPaths: Record<ChipIcon, ReactElement> = {
  "check-circle": (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  "alert-triangle": (
    <>
      <path d="M12 4 3 19.5h18L12 4Z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </>
  ),
  "alert-circle": (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </>
  ),
  "user-check": (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20v-1a5 5 0 0 1 5-5h2" />
      <path d="m15 18 2 2 4-4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
};

export function StatusChip({ tone, icon, word }: { tone: ChipTone; icon: ChipIcon; word: string }) {
  return (
    <span
      className={`inline-flex min-h-8 items-center gap-1 rounded-chip border border-transparent px-3 py-1 text-sm font-medium dark:bg-transparent ${toneClasses[tone]}`}
    >
      <svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {iconPaths[icon]}
      </svg>
      {word}
    </span>
  );
}
