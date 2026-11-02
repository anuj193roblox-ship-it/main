"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/form";
import {
  ACTIVITY_PING_INTERVAL_MS,
  ACTIVITY_STORAGE_KEY,
  INACTIVITY_LIMIT_MS,
  INACTIVITY_WARNING_MS,
} from "@/lib/auth/session-timing";
import { goTo, postJson } from "./post-json";

const EVENTS = ["pointerdown", "keydown", "scroll", "touchstart"] as const;

function readShared(): number {
  const v = Number(window.localStorage.getItem(ACTIVITY_STORAGE_KEY));
  return Number.isFinite(v) ? v : 0;
}

/**
 * Signs the user out after 30 minutes without activity, with a warning at 28 minutes.
 * All open tabs share one timer through localStorage (a timestamp only). The server enforces the
 * same limit with a signed cookie, so this is the friendly half of the rule, not the only half.
 */
export function InactivityGuard() {
  const [warning, setWarning] = useState(false);
  const lastActivity = useRef(0);
  const lastPing = useRef(0);
  const signingOut = useRef(false);

  const markActive = useCallback(() => {
    const now = Date.now();
    if (now - lastActivity.current < 5000) return;
    lastActivity.current = now;
    window.localStorage.setItem(ACTIVITY_STORAGE_KEY, String(now));
    if (now - lastPing.current > ACTIVITY_PING_INTERVAL_MS) {
      lastPing.current = now;
      void postJson("/api/auth/activity");
    }
  }, []);

  const stay = useCallback(async () => {
    const now = Date.now();
    lastActivity.current = now;
    lastPing.current = now;
    window.localStorage.setItem(ACTIVITY_STORAGE_KEY, String(now));
    setWarning(false);
    const res = await postJson("/api/auth/activity");
    if (res.status === 401) goTo("/login?reason=timeout");
  }, []);

  useEffect(() => {
    const now = Date.now();
    lastActivity.current = now;
    lastPing.current = now;
    window.localStorage.setItem(ACTIVITY_STORAGE_KEY, String(now));

    for (const e of EVENTS) window.addEventListener(e, markActive, { passive: true });
    const timer = window.setInterval(async () => {
      const idle = Date.now() - Math.max(lastActivity.current, readShared());
      if (idle >= INACTIVITY_LIMIT_MS && !signingOut.current) {
        signingOut.current = true;
        await postJson("/api/auth/logout", { reason: "timeout" });
        goTo("/login?reason=timeout");
      } else {
        setWarning(idle >= INACTIVITY_WARNING_MS);
      }
    }, 10_000);

    return () => {
      for (const e of EVENTS) window.removeEventListener(e, markActive);
      window.clearInterval(timer);
    };
  }, [markActive]);

  if (!warning) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="idle-title"
        aria-describedby="idle-body"
        className="w-full max-w-[390px] space-y-4 rounded-card bg-surface p-6 shadow-lg"
      >
        <h2 id="idle-title" className="text-xl leading-7 font-semibold">
          Still there?
        </h2>
        <p id="idle-body">You will be signed out in 2 minutes because there has been no activity.</p>
        <Button autoFocus onClick={stay}>
          Stay signed in
        </Button>
      </div>
    </div>
  );
}
