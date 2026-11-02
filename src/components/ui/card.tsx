import type { ReactNode } from "react";

/** Card (spec 3.5): tint background, 16px radius, 1px border. No shadow. */
export function Card({ children, className = "", as: Tag = "section", labelledBy }: { children: ReactNode; className?: string; as?: "section" | "div" | "li"; labelledBy?: string }) {
  return (
    <Tag aria-labelledby={labelledBy} className={`rounded-card border border-line bg-primary-tint p-4 ${className}`}>
      {children}
    </Tag>
  );
}
