"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { errorText, postJson } from "@/components/auth/post-json";
import { StatusChip } from "@/components/status-chip";
import { Button, Notice } from "@/components/ui/form";
import { formatDay } from "@/lib/care/format";

export type DeviceRow = { id: string; label: string; pairedAt: string; lastUsedAt: string; revoked: boolean; expired: boolean };

function Countdown({ until }: { until: number }) {
  const [left, setLeft] = useState(() => Math.max(0, until - Date.now()));
  useEffect(() => {
    const id = window.setInterval(() => setLeft(Math.max(0, until - Date.now())), 1000);
    return () => window.clearInterval(id);
  }, [until]);
  if (left === 0) return <span>This code has expired. Create a new one.</span>;
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return (
    <span>
      Works once, for {m}:{String(s).padStart(2, "0")} more.
    </span>
  );
}

export function DevicesScreen({ devices, canManage }: { devices: DeviceRow[]; canManage: boolean }) {
  const router = useRouter();
  const [code, setCode] = useState<{ code: string; until: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function newCode() {
    setBusy(true);
    setError(null);
    const res = await postJson("/api/devices/pairing");
    setBusy(false);
    if (res.ok && typeof res.data.code === "string") setCode({ code: res.data.code, until: Date.parse(String(res.data.expiresAt)) });
    else setError(errorText(res));
  }

  async function revoke(id: string) {
    setBusy(true);
    setError(null);
    const res = await postJson(`/api/devices/${id}/revoke`);
    setBusy(false);
    setConfirming(null);
    if (res.ok) router.refresh();
    else setError(errorText(res));
  }

  return (
    <div className="space-y-6">
      {error && <Notice tone="danger">{error}</Notice>}
      {canManage && (
        <section aria-labelledby="pair" className="space-y-3 rounded-card border border-line bg-primary-tint p-4">
          <h2 id="pair" className="text-xl leading-7 font-semibold">
            Pair a patient device
          </h2>
          <p>On the phone or tablet the person uses, open this site at /patient/pair, then type the code.</p>
          {code ? (
            <div className="space-y-2 text-center">
              <p className="text-[40px] leading-[48px] font-bold tracking-[0.25em] tabular-nums" aria-label={`Code ${code.code.split("").join(" ")}`}>
                {code.code.slice(0, 3)} {code.code.slice(3)}
              </p>
              <p className="text-ink-muted">
                <Countdown until={code.until} />
              </p>
              <Button variant="secondary" onClick={newCode} busy={busy}>
                Create a new code
              </Button>
            </div>
          ) : (
            <Button onClick={newCode} busy={busy}>
              {busy ? "Creating" : "Create a pairing code"}
            </Button>
          )}
        </section>
      )}

      <section aria-labelledby="devices" className="space-y-3">
        <h2 id="devices" className="text-xl leading-7 font-semibold">
          Paired devices <span className="text-base font-normal text-ink-muted">({devices.length})</span>
        </h2>
        {devices.length === 0 && <p className="text-ink-muted">No devices yet.</p>}
        <ul className="space-y-3">
          {devices.map((d) => (
            <li key={d.id} className="space-y-2 rounded-card border border-line bg-primary-tint p-4">
              <p className="text-lg font-semibold">{d.label}</p>
              <p className="text-ink-muted">
                Paired {formatDay(d.pairedAt)}
                {d.lastUsedAt ? `. Last used ${formatDay(d.lastUsedAt)}` : ""}
              </p>
              {d.revoked ? (
                <StatusChip tone="neutral" icon="clock" word="Revoked" />
              ) : d.expired ? (
                <StatusChip tone="warn" icon="alert-triangle" word="Expired" />
              ) : (
                <StatusChip tone="ok" icon="check-circle" word="Active" />
              )}
              {canManage && !d.revoked && !d.expired && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {confirming === d.id ? (
                    <>
                      <button type="button" disabled={busy} onClick={() => revoke(d.id)} className="min-h-12 rounded-input bg-danger-btn px-3 text-sm font-medium text-white">
                        Confirm revoke
                      </button>
                      <button type="button" onClick={() => setConfirming(null)} className="min-h-12 rounded-input border border-line-input bg-surface px-3 text-sm font-medium">
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setConfirming(d.id)} className="min-h-12 rounded-input border border-line-input bg-surface px-3 text-sm font-medium">
                      Revoke
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
