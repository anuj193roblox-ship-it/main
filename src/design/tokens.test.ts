import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cssVarName, darkTokens, lightTokens } from "./tokens";

const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

function block(selector: string): string {
  const start = css.indexOf(selector + " {");
  expect(start, `${selector} block missing in globals.css`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

function cssValue(blockText: string, name: string): string | undefined {
  return blockText.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`))?.[1]?.toUpperCase();
}

describe("design tokens match globals.css", () => {
  const root = block(":root");
  const dark = block('[data-theme="dark"]');

  it.each(Object.entries(lightTokens))("light %s", (token, hex) => {
    expect(cssValue(root, cssVarName(token))).toBe(hex.toUpperCase());
  });

  it.each(Object.entries(darkTokens))("dark %s", (token, hex) => {
    expect(cssValue(dark, cssVarName(token))).toBe(hex.toUpperCase());
  });
});

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const L = lightTokens;
const D = darkTokens;
const white = "#FFFFFF";

describe("contrast (spec 3.1, 3.6)", () => {
  const textPairs: [string, string, string, number][] = [
    ["text on bg", L.text, L.bg, 4.5],
    ["muted text on bg", L.textMuted, L.bg, 4.5],
    ["muted text on tint", L.textMuted, L.primaryTint, 4.5],
    ["placeholder on bg", L.textPlaceholder, L.bg, 4.5],
    ["white on primary", white, L.primary, 4.5],
    ["white on primary pressed", white, L.primaryPressed, 4.5],
    ["white on destructive", white, L.destructive, 4.5],
    ["ok chip", L.okText, L.okBg, 4.5],
    ["warn chip", L.warnText, L.warnBg, 4.5],
    ["danger chip", L.dangerText, L.dangerBg, 4.5],
    ["info chip", L.infoText, L.infoBg, 4.5],
    ["neutral chip", L.neutralText, L.neutralBg, 4.5],
    ["patient text on cream (7:1)", L.text, L.bgPatient, 7],
    ["patient white on primary (7:1 needs large text, 4.5 min here)", white, L.primary, 4.5],
    ["dark text on bg", D.text, D.bg, 4.5],
    ["dark text on surface", D.text, D.surface, 4.5],
    ["dark muted on surface", D.textMuted, D.surface, 4.5],
    ["dark primary on bg", D.primary, D.bg, 4.5],
    ["dark button text on primary", D.bg, D.primary, 4.5],
    ["dark ok text", D.okText, D.bg, 4.5],
    ["dark warn text", D.warnText, D.bg, 4.5],
    ["dark danger text", D.dangerText, D.bg, 4.5],
    ["dark info text", D.infoText, D.bg, 4.5],
  ];

  it.each(textPairs)("%s", (_name, fg, bg, min) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(min);
  });

  it("input borders reach 3:1 on white and on the dark surface", () => {
    expect(contrast(L.borderInput, L.bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(D.borderInput, D.surface)).toBeGreaterThanOrEqual(3);
  });

  it("raw status colours are not used as text on white (they fail 4.5:1 by design)", () => {
    expect(contrast(L.ok, white)).toBeLessThan(4.5);
    expect(contrast(L.warn, white)).toBeLessThan(4.5);
    expect(contrast(L.danger, white)).toBeLessThan(4.5);
  });
});
