// The Nurra logo. An original mark: a rounded tile in the primary green with a soft "N" whose last
// stroke rises and curves into a small circle, like a person leaning in to care. No cross, no heart.
// Colours come from the design tokens (CSS variables), so it follows light and dark mode.

/** Geometry shared with public/brand/*.svg (64 x 64 grid). */
export const MARK_PATH = "M20 45 V22 L39 42 V31 Q39 26 42 24";
export const MARK_HEAD = { cx: 47.5, cy: 15.5, r: 4.75 };

function Mark({ size, title }: { size: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      className="shrink-0"
    >
      <rect width="64" height="64" rx="18" style={{ fill: "var(--primary)" }} />
      <path
        d={MARK_PATH}
        fill="none"
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ stroke: "var(--surface)" }}
      />
      <circle {...MARK_HEAD} style={{ fill: "var(--surface)" }} />
    </svg>
  );
}

/**
 * variant "mark": the tile only (named "Nurra" for screen readers).
 * variant "full": tile plus the word "Nurra" in Nunito, in the text colour.
 */
export function Logo({ variant = "full", size = 40 }: { variant?: "mark" | "full"; size?: number }) {
  if (variant === "mark") return <Mark size={size} title="Nurra" />;
  return (
    <span className="inline-flex items-center gap-2">
      <Mark size={size} />
      <span className="font-patient font-bold text-ink" style={{ fontSize: Math.round(size * 0.7), lineHeight: 1 }}>
        Nurra
      </span>
    </span>
  );
}
