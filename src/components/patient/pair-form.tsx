"use client";

import { type FormEvent, useState } from "react";
import { errorText, goTo, postJson } from "@/components/auth/post-json";

/** On the patient's device: type the 6-digit code from the family app. */
export function PairForm() {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await postJson("/api/device/pair", { code, label });
    if (res.ok) return goTo(res.data.next, "/patient");
    setBusy(false);
    setError(errorText(res));
    setCode("");
  }

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      {error && (
        <p role="alert" className="rounded-card border-2 border-ink bg-surface p-4 text-[28px] leading-10">
          {error}
        </p>
      )}
      <div className="space-y-2">
        <label htmlFor="pair-code" className="block text-[28px] leading-10 font-semibold">
          Pairing code
        </label>
        <input
          id="pair-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={7}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))}
          className="min-h-[72px] w-full rounded-patient-button border-2 border-ink bg-surface px-5 text-center text-[40px] tracking-[0.3em] text-ink tabular-nums"
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="pair-label" className="block text-[28px] leading-10 font-semibold">
          Name for this device (optional)
        </label>
        <input
          id="pair-label"
          maxLength={60}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="min-h-[72px] w-full rounded-patient-button border-2 border-ink bg-surface px-5 text-[28px] text-ink"
        />
      </div>
      <button
        type="submit"
        disabled={busy || code.replace(/\s/g, "").length !== 6}
        className="flex min-h-[72px] w-full items-center justify-center rounded-patient-button bg-primary-pressed px-6 text-[28px] font-semibold text-white disabled:opacity-80"
      >
        {busy ? "Pairing" : "Pair this device"}
      </button>
    </form>
  );
}
