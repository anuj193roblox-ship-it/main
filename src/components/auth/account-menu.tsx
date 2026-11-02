"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icons";
import { goTo, postJson } from "./post-json";

/** Signed-in corner menu: Account, Switch patient (later), Log out. */
export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  async function logOut() {
    setBusy(true);
    await postJson("/api/auth/logout");
    goTo("/");
  }

  const item = "flex min-h-12 w-full items-center gap-3 px-4 text-left text-base";

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-12 items-center gap-2 rounded-input border border-line-input bg-surface px-4 font-medium text-ink hover:bg-primary-tint focus:outline-2 focus:outline-offset-2 focus:outline-primary"
      >
        <Icon name="user" />
        Account
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-60 overflow-hidden rounded-card border border-line-input bg-surface py-1">
          <Link role="menuitem" href="/app/account" className={`${item} hover:bg-primary-tint`}>
            <Icon name="user" />
            Account
          </Link>
          <div role="menuitem" aria-disabled="true" className={`${item} text-ink-muted`}>
            <Icon name="users" />
            <span>
              Switch patient
              <span className="block text-sm">Coming later</span>
            </span>
          </div>
          <button role="menuitem" type="button" onClick={logOut} disabled={busy} className={`${item} hover:bg-primary-tint`}>
            <Icon name="logout" />
            {busy ? "Logging out" : "Log out"}
          </button>
        </div>
      )}
    </div>
  );
}
