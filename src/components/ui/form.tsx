import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./icons";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  name: string;
  hint?: string;
};

/** Labelled input. 48px tall, input border token, visible focus ring. */
export function TextField({ label, name, hint, id, ...input }: FieldProps) {
  const fieldId = id ?? `field-${name}`;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  return (
    <div className="space-y-1">
      <label htmlFor={fieldId} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={fieldId}
        name={name}
        aria-describedby={hintId}
        className="min-h-12 w-full rounded-input border border-line-input bg-surface px-3 text-base text-ink placeholder:text-ink-placeholder focus:outline-2 focus:outline-offset-2 focus:outline-primary"
        {...input}
      />
      {hint && (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
  busy?: boolean;
};

const variants = {
  primary: "bg-primary text-white hover:bg-primary-pressed",
  secondary: "border border-line-input bg-surface text-ink hover:bg-primary-tint",
  danger: "bg-danger-btn text-white",
};

export function Button({ variant = "primary", busy, disabled, children, className = "", ...rest }: ButtonProps) {
  return (
    <button
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-input px-4 font-medium transition-colors duration-200 focus:outline-2 focus:outline-offset-2 focus:outline-primary disabled:opacity-60 ${variants[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

const tones: Record<"ok" | "danger" | "info" | "neutral", { cls: string; icon: IconName }> = {
  ok: { cls: "bg-ok-bg text-ok-text", icon: "check" },
  danger: { cls: "bg-danger-bg text-danger-text", icon: "alert" },
  info: { cls: "bg-info-bg text-info-text", icon: "info" },
  neutral: { cls: "bg-neutral-bg text-neutral-text", icon: "info" },
};

/** Message box: tinted background, dark text, icon and words (never colour alone). */
export function Notice({ tone, children }: { tone: keyof typeof tones; children: ReactNode }) {
  const t = tones[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`flex gap-2 rounded-input p-3 text-sm ${t.cls}`}>
      <Icon name={t.icon} />
      <div>{children}</div>
    </div>
  );
}

/** Page frame for the public and account pages: one column, mobile first, room for the corner button. */
export function PageShell({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-[420px] flex-1 px-6 pt-20 pb-12">
      <h1 className="text-[28px] leading-9 font-bold">{title}</h1>
      {intro && <div className="mt-2 text-ink-muted">{intro}</div>}
      <div className="mt-6 space-y-6">{children}</div>
    </main>
  );
}
