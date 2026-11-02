import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { lightTokens } from "@/design/tokens";
import { PatientScreen } from "./patient-screen";
import { getRecognitionCtor } from "./speech";

const root = process.cwd();
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, b2] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const props = {
  preferredName: "Meera",
  language: "en" as const,
  timezone: "Asia/Kolkata",
  contact: { name: "Anita", phone: "+919876543210" },
  reminder: null,
  demoMode: false,
};

describe("typed fallback when there is no speech recognition", () => {
  it("detects speech recognition only when the browser has it", () => {
    expect(getRecognitionCtor(undefined)).toBeNull();
    expect(getRecognitionCtor({})).toBeNull();
    class Fake {}
    expect(getRecognitionCtor({ webkitSpeechRecognition: Fake })).toBe(Fake);
    expect(getRecognitionCtor({ SpeechRecognition: Fake })).toBe(Fake);
  });

  it("without speech recognition the screen offers typing, and no microphone button", () => {
    const html = renderToStaticMarkup(createElement(PatientScreen, props));
    expect(html).toMatch(/<form[^>]*aria-label="Type to Nurra"/);
    expect(html).toContain(">Type to Nurra</label>");
    expect(html).toContain(">Send</button>");
    expect(html).not.toContain('aria-label="Talk to Nurra"');
    expect(html).toContain('href="tel:+919876543210"');
    expect(html).toContain("Call my family");
  });

  it("with a reminder due, the card shows the two answers", () => {
    const html = renderToStaticMarkup(createElement(PatientScreen, { ...props, reminder: { id: "r1", title: "Morning medicines" } }));
    expect(html).toContain("Yes, I took them");
    expect(html).toContain("Not yet");
  });

  it("the demo button appears only in demo mode", () => {
    expect(renderToStaticMarkup(createElement(PatientScreen, props))).not.toContain("Demo:");
    expect(renderToStaticMarkup(createElement(PatientScreen, { ...props, demoMode: true }))).toContain("Demo: show a reminder now");
  });
});

describe("patient screen stays light in dark mode and keeps 7:1 contrast", () => {
  const css = read("src/app/globals.css");

  it("the patient layout wraps everything in .theme-light on the cream background", () => {
    const layout = read("src/app/patient/layout.tsx");
    expect(layout).toMatch(/className="theme-light [^"]*bg-patient[^"]*font-patient/);
  });

  it(".theme-light resets every dark-mode variable to its light value", () => {
    const block = css.slice(css.indexOf(".theme-light {"), css.indexOf("}", css.indexOf(".theme-light {")));
    const dark = css.slice(css.indexOf('[data-theme="dark"] {'), css.indexOf("}", css.indexOf('[data-theme="dark"] {')));
    const darkVars = [...dark.matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1]);
    expect(darkVars.length).toBeGreaterThan(5);
    const toToken = (v: string) => v.slice(2).replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase()) as keyof typeof lightTokens;
    for (const v of darkVars) {
      const value = new RegExp(`${v}:\\s*(#[0-9a-f]{6})`, "i").exec(block)?.[1];
      expect(value?.toUpperCase(), v).toBe(lightTokens[toToken(v)]);
    }
  });

  it("dark: utilities do not apply inside .theme-light", () => {
    expect(css).toMatch(/@custom-variant dark \(&:where\(\[data-theme="dark"\], \[data-theme="dark"\] \*\):not\(:where\(\.theme-light, \.theme-light \*\)\)\);/);
  });

  it("patient text and buttons reach 7:1", () => {
    expect(contrast(lightTokens.text, lightTokens.bgPatient)).toBeGreaterThanOrEqual(7);
    expect(contrast("#FFFFFF", lightTokens.primaryPressed)).toBeGreaterThanOrEqual(7);
    expect(contrast(lightTokens.text, lightTokens.surface)).toBeGreaterThanOrEqual(7);
  });

  it("patient components use only 7:1 colours (no muted, status or plain-primary text, no dark: classes)", () => {
    const files = [
      "src/components/patient/patient-screen.tsx",
      "src/components/patient/pair-form.tsx",
      "src/app/patient/page.tsx",
      "src/app/patient/pair/page.tsx",
      "src/app/patient/layout.tsx",
    ];
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toMatch(/text-ink-muted|text-ink-placeholder|text-(ok|warn|danger|info|neutral)-text|text-primary\b|bg-primary\b(?!-)|bg-danger-btn|\bdark:/);
    }
  });
});

describe("no audio is recorded, uploaded or stored", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const f = path.join(dir, n);
      return statSync(f).isDirectory() ? walk(f) : [f];
    });

  it("no code records or uploads audio", () => {
    const offenders = walk(path.join(root, "src"))
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts"))
      .filter((f) => /MediaRecorder|getUserMedia|AudioContext|audio\/(webm|wav|ogg|mp4)|new Blob\(/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(root, f));
    expect(offenders).toEqual([]);
  });

  it("the check-in request accepts only text", async () => {
    const { checkinSchema } = await import("@/lib/patient/services/checkin");
    const parsed = checkinSchema.parse({ text: "hello", audio: "UklGRg==", recording: "x" });
    expect(Object.keys(parsed).sort()).toEqual(["source", "text"]);
  });

  it("no migration creates an audio or binary column", () => {
    const sql = readdirSync(path.join(root, "supabase/migrations"))
      .map((f) => read(`supabase/migrations/${f}`))
      .join("\n");
    expect(sql).not.toMatch(/\bbytea\b|\baudio\b\s+(text|bytea|jsonb)|recording\s+(text|bytea)/i);
  });
});
