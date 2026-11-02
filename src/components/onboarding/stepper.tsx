import Link from "next/link";
import { Icon } from "@/components/ui/icons";

const STEPS = [
  { href: "/onboarding/patient", label: "Person" },
  { href: "/onboarding/consent", label: "Consent" },
  { href: "/onboarding/contacts", label: "Contacts" },
  { href: "/onboarding/review", label: "Review" },
];

/** Mobile-first stepper. Earlier steps stay reachable so details can be corrected. */
export function Stepper({ current }: { current: 0 | 1 | 2 | 3 }) {
  return (
    <nav aria-label="Setup steps">
      <ol className="grid grid-cols-4 gap-1">
        {STEPS.map((s, i) => {
          const state = i < current ? "done" : i === current ? "current" : "todo";
          const bar = state === "todo" ? "bg-line" : "bg-primary";
          const content = (
            <>
              <span className={`block h-1.5 rounded-chip ${bar}`} />
              <span className={`mt-1 flex items-center gap-1 text-xs font-medium ${state === "todo" ? "text-ink-muted" : "text-primary"}`}>
                {state === "done" && <Icon name="check" size={14} />}
                {s.label}
              </span>
            </>
          );
          return (
            <li key={s.href} aria-current={state === "current" ? "step" : undefined}>
              {state === "done" ? (
                <Link href={s.href} className="block min-h-12 pt-2">
                  {content}
                  <span className="sr-only"> (done, go back to this step)</span>
                </Link>
              ) : (
                <div className="min-h-12 pt-2">{content}</div>
              )}
            </li>
          );
        })}
      </ol>
      <p className="mt-1 text-sm text-ink-muted">
        Step {current + 1} of {STEPS.length}
      </p>
    </nav>
  );
}
