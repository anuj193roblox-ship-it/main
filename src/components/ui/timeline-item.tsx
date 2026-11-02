import type { ReactNode } from "react";

export type TimelineTone = "ok" | "warn" | "danger" | "info" | "neutral";

// Status colours are only for the dot (spec 3.1); the words carry the meaning.
const DOT: Record<TimelineTone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-line-input",
};

/**
 * Timeline item (spec 3.5): dot, time, title, one-line outcome, chevron.
 * The whole row is one target; pass `action` to make it a link or button.
 */
export function TimelineItem({
  tone,
  time,
  title,
  outcome,
  chip,
  action,
}: {
  tone: TimelineTone;
  time: string;
  title: string;
  outcome: string;
  chip?: ReactNode;
  action: (content: ReactNode) => ReactNode;
}) {
  const content = (
    <span className="flex min-h-12 w-full items-start gap-3 py-3 text-left">
      <span aria-hidden="true" className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${DOT[tone]}`} />
      <span className="min-w-0 flex-1 space-y-1">
        <span className="block text-sm leading-5 text-ink-muted">{time}</span>
        <span className="block font-semibold">{title}</span>
        {chip}
        <span className="block text-sm leading-5 text-ink-muted">{outcome}</span>
      </span>
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-1 shrink-0 text-ink-muted">
        <path d="m9 6 6 6-6 6" />
      </svg>
    </span>
  );
  return <li className="border-b border-line last:border-b-0">{action(content)}</li>;
}
