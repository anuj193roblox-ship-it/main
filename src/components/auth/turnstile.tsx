"use client";

import { useEffect, useRef, useState } from "react";

type TurnstileApi = {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<void> | null = null;

// Loaded by our own (nonce-trusted) bundle, so the CSP's 'strict-dynamic' allows it.
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      reject(new Error("turnstile"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Cloudflare Turnstile check. Calls onToken with a token when passed, and with "" when it expires.
 * Change resetSignal to get a fresh token (each token can be used once).
 */
export function Turnstile({
  siteKey,
  onToken,
  resetSignal = 0,
}: {
  siteKey: string;
  onToken: (token: string) => void;
  resetSignal?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const callback = useRef(onToken);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    callback.current = onToken;
  });

  useEffect(() => {
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return;
        widgetId.current = window.turnstile.render(container.current, {
          sitekey: siteKey,
          theme: "light",
          size: "flexible",
          callback: (token: string) => callback.current(token),
          "expired-callback": () => callback.current(""),
          "error-callback": () => callback.current(""),
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey]);

  useEffect(() => {
    if (resetSignal > 0 && widgetId.current && window.turnstile) {
      window.turnstile.reset(widgetId.current);
      callback.current("");
    }
  }, [resetSignal]);

  return (
    <div>
      <div ref={container} className="min-h-[65px]" />
      {failed && (
        <p role="alert" className="text-sm text-danger-text">
          The security check could not load. Check your connection and reload the page.
        </p>
      )}
    </div>
  );
}
