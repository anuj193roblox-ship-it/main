"use client";

import { type FormEvent, useState } from "react";
import { Button, Notice, TextField } from "@/components/ui/form";
import { errorText, goTo, postJson } from "./post-json";

function CodeForm({ factorId, submitLabel }: { factorId: string; submitLabel: string }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await postJson("/api/auth/mfa/verify", { factorId, code: code.replace(/\s/g, "") });
    if (res.ok) return goTo(res.data.next);
    setBusy(false);
    setError(errorText(res));
    setCode("");
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Notice tone="danger">{error}</Notice>}
      <TextField
        label="6-digit code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={7}
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <Button type="submit" busy={busy}>
        {busy ? "Checking" : submitLabel}
      </Button>
    </form>
  );
}

export function MfaEnrollForm() {
  const [factor, setFactor] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    const res = await postJson("/api/auth/mfa/enroll");
    setBusy(false);
    const { factorId, qrCode, secret } = res.data;
    if (res.ok && typeof factorId === "string" && typeof qrCode === "string" && typeof secret === "string") {
      return setFactor({ factorId, qrCode, secret });
    }
    setError(errorText(res));
  }

  if (!factor) {
    return (
      <div className="space-y-4">
        {error && <Notice tone="danger">{error}</Notice>}
        <Button onClick={start} busy={busy}>
          {busy ? "Preparing" : "Set up two-step sign-in"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ol className="list-decimal space-y-2 pl-5">
        <li>Open an authenticator app on your phone, such as Google Authenticator or Microsoft Authenticator.</li>
        <li>Scan this code, or type the key below.</li>
        <li>Enter the 6-digit code the app shows.</li>
      </ol>
      <div className="flex justify-center rounded-card border border-line bg-white p-4">
        {/* Supabase returns the QR code as an SVG data URL; next/image adds nothing here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={factor.qrCode} alt="QR code to add Nurra to your authenticator app" width={200} height={200} />
      </div>
      <div>
        <p className="text-sm font-medium">Key for typing in</p>
        <p className="mt-1 rounded-input border border-line bg-primary-tint p-3 font-mono text-sm break-all">{factor.secret}</p>
      </div>
      <CodeForm factorId={factor.factorId} submitLabel="Turn on two-step sign-in" />
    </div>
  );
}

export function MfaVerifyForm({ factorId }: { factorId: string }) {
  return <CodeForm factorId={factorId} submitLabel="Continue" />;
}
