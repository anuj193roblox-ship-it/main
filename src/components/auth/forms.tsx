"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { Button, Notice, TextField } from "@/components/ui/form";
import { errorText, goTo, postJson } from "./post-json";
import { Turnstile } from "./turnstile";

const NEED_CHECK = "Complete the check below first.";

/** Shared state for a form that posts JSON and shows one error. */
function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return { busy, setBusy, error, setError };
}

export function LoginForm({ siteKey, next }: { siteKey: string; next: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [reset, setReset] = useState(0);
  const { busy, setBusy, error, setError } = useSubmit();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token) return setError(NEED_CHECK);
    setBusy(true);
    setError(null);
    const res = await postJson("/api/auth/login", { email, password, captchaToken: token, next });
    if (res.ok) return goTo(res.data.next);
    setBusy(false);
    setError(errorText(res));
    setReset((n) => n + 1);
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Notice tone="danger">{error}</Notice>}
      <TextField label="Email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <TextField label="Password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      <Turnstile siteKey={siteKey} onToken={setToken} resetSignal={reset} />
      <Button type="submit" busy={busy}>
        {busy ? "Logging in" : "Log in"}
      </Button>
    </form>
  );
}

export function SignupForm({ siteKey, invite }: { siteKey: string; invite?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [reset, setReset] = useState(0);
  const [sent, setSent] = useState<string | null>(null);
  const { busy, setBusy, error, setError } = useSubmit();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token) return setError(NEED_CHECK);
    setBusy(true);
    setError(null);
    const res = await postJson("/api/auth/signup", { email, password, captchaToken: token, invite });
    setBusy(false);
    if (res.ok) return setSent(typeof res.data.message === "string" ? res.data.message : "Check your email.");
    setError(errorText(res));
    setReset((n) => n + 1);
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <Notice tone="ok">{sent}</Notice>
        <p className="text-ink-muted">
          No email after a few minutes? Check your spam folder, or{" "}
          <Link href="/verify-email" className="text-primary underline">
            send a new link
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Notice tone="danger">{error}</Notice>}
      <TextField label="Email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={12}
        hint="At least 12 characters. A short sentence works well."
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Turnstile siteKey={siteKey} onToken={setToken} resetSignal={reset} />
      <Button type="submit" busy={busy}>
        {busy ? "Creating account" : "Create account"}
      </Button>
    </form>
  );
}

/** Forgot password and resend verification: email + check, generic answer. */
export function EmailLinkForm({ siteKey, endpoint, submitLabel }: { siteKey: string; endpoint: string; submitLabel: string }) {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [reset, setReset] = useState(0);
  const [sent, setSent] = useState<string | null>(null);
  const { busy, setBusy, error, setError } = useSubmit();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token) return setError(NEED_CHECK);
    setBusy(true);
    setError(null);
    const res = await postJson(endpoint, { email, captchaToken: token });
    setBusy(false);
    if (res.ok) return setSent(typeof res.data.message === "string" ? res.data.message : "Check your email.");
    setError(errorText(res));
    setReset((n) => n + 1);
  }

  if (sent) return <Notice tone="ok">{sent}</Notice>;
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Notice tone="danger">{error}</Notice>}
      <TextField label="Email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <Turnstile siteKey={siteKey} onToken={setToken} resetSignal={reset} />
      <Button type="submit" busy={busy}>
        {submitLabel}
      </Button>
    </form>
  );
}

export function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const { busy, setBusy, error, setError } = useSubmit();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("The two passwords do not match.");
    setBusy(true);
    setError(null);
    const res = await postJson("/api/auth/reset-password", { password });
    setBusy(false);
    if (res.ok) return setDone(typeof res.data.message === "string" ? res.data.message : "Your password has changed.");
    if (res.data.mfa === true) return goTo("/mfa/verify");
    setError(errorText(res));
  }

  if (done) {
    return (
      <div className="space-y-4">
        <Notice tone="ok">{done}</Notice>
        <Link href="/app/today" className="inline-flex min-h-12 w-full items-center justify-center rounded-input bg-primary px-4 font-medium text-white hover:bg-primary-pressed">
          Continue
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Notice tone="danger">{error}</Notice>}
      <TextField
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={12}
        hint="At least 12 characters."
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <TextField label="New password again" name="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      <Button type="submit" busy={busy}>
        {busy ? "Saving" : "Save new password"}
      </Button>
    </form>
  );
}

export function AcceptInviteForm({ token }: { token: string }) {
  const [name, setName] = useState("");
  const { busy, setBusy, error, setError } = useSubmit();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await postJson("/api/invites/accept", { token, displayName: name });
    if (res.ok) return goTo(res.data.next);
    setBusy(false);
    setError(errorText(res));
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Notice tone="danger">{error}</Notice>}
      <TextField label="Your name" name="displayName" autoComplete="name" hint="This is how the household will see you." value={name} onChange={(e) => setName(e.target.value)} />
      <Button type="submit" busy={busy}>
        {busy ? "Joining" : "Accept invite"}
      </Button>
    </form>
  );
}

export function StartHouseholdForm() {
  const [name, setName] = useState("");
  const [household, setHousehold] = useState("");
  const { busy, setBusy, error, setError } = useSubmit();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await postJson("/api/household/create", { displayName: name, householdName: household });
    if (res.ok) return goTo(res.data.next);
    setBusy(false);
    setError(errorText(res));
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Notice tone="danger">{error}</Notice>}
      <TextField label="Your name" name="displayName" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
      <TextField label="Household name" name="householdName" hint="For example, the Rao family." value={household} onChange={(e) => setHousehold(e.target.value)} />
      <Button type="submit" busy={busy}>
        {busy ? "Starting" : "Start household"}
      </Button>
    </form>
  );
}

export function ClaimDemoForm() {
  const [name, setName] = useState("");
  const { busy, setBusy, error, setError } = useSubmit();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await postJson("/api/household/claim-demo", { displayName: name });
    if (res.ok) return goTo(res.data.next);
    setBusy(false);
    setError(errorText(res));
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Notice tone="danger">{error}</Notice>}
      <TextField label="Your name" name="demoDisplayName" id="field-demo-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
      <Button type="submit" variant="secondary" busy={busy}>
        {busy ? "Claiming" : "Use the demo household"}
      </Button>
    </form>
  );
}

export function CreateInviteForm() {
  const [role, setRole] = useState<"family" | "clinician">("family");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { busy, setBusy, error, setError } = useSubmit();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCopied(false);
    const res = await postJson("/api/invites", { role });
    setBusy(false);
    if (res.ok && typeof res.data.link === "string") return setLink(res.data.link);
    setError(errorText(res));
  }

  async function copy() {
    if (!link) return;
    await navigator.clipboard.writeText(link).then(() => setCopied(true), () => setCopied(false));
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Notice tone="danger">{error}</Notice>}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">They will join as</legend>
        {(["family", "clinician"] as const).map((r) => (
          <label key={r} className="flex min-h-12 items-center gap-3 rounded-input border border-line-input px-3">
            <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} className="h-5 w-5 accent-primary" />
            {r === "family" ? "Family member" : "Clinician (doctor or nurse)"}
          </label>
        ))}
      </fieldset>
      <Button type="submit" busy={busy}>
        {busy ? "Creating link" : "Create invite link"}
      </Button>
      {link && (
        <div className="space-y-2">
          <Notice tone="info">This link works once, for 24 hours. Send it only to the person you are inviting.</Notice>
          <p className="rounded-input border border-line bg-primary-tint p-3 font-mono text-sm break-all">{link}</p>
          <Button type="button" variant="secondary" onClick={copy}>
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
      )}
    </form>
  );
}

export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      busy={busy}
      onClick={async () => {
        setBusy(true);
        await postJson("/api/auth/logout");
        goTo("/");
      }}
    >
      {busy ? "Logging out" : "Log out"}
    </Button>
  );
}
