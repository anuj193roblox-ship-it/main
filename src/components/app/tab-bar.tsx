"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/icons";

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: "/app/today", label: "Today", icon: "home" },
  { href: "/app/medicines", label: "Medicines", icon: "pill" },
  { href: "/app/vault", label: "Vault", icon: "vault" },
  { href: "/app/plan", label: "Plan", icon: "plan" },
  { href: "/app/more", label: "More", icon: "more" },
];

/**
 * Family app bottom tab bar (spec 3.5): 5 tabs, icon and label, active tab in primary.
 * sample: on the signed-out home page every tab goes to log in first, and Today is shown active.
 */
export function TabBar({ sample = false }: { sample?: boolean }) {
  const current = usePathname();
  const path = sample ? "/app/today" : current;
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto grid max-w-[560px] grid-cols-5">
        {TABS.map((t) => {
          const active = path === t.href || path.startsWith(`${t.href}/`);
          return (
            <li key={t.href}>
              <Link
                href={sample ? `/login?next=${t.href}` : t.href}
                aria-label={sample ? `${t.label}: log in to use this` : undefined}
                aria-current={active && !sample ? "page" : undefined}
                className={`flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium focus:outline-2 focus:-outline-offset-2 focus:outline-primary ${
                  active ? "text-primary" : "text-ink-muted"
                }`}
              >
                <Icon name={t.icon} size={24} />
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
