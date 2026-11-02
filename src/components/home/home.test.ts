import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SessionState } from "@/lib/auth/access";
import { homeRedirect } from "@/lib/home";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

const { SAMPLE_LABEL, SampleDashboard } = await import("./sample-dashboard");
const { Logo, MARK_HEAD, MARK_PATH } = await import("@/components/brand/logo");

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
const signedIn = (over: Partial<{ verified: boolean; active: boolean; household: boolean }> = {}): SessionState => {
  const o = { verified: true, active: true, household: true, ...over };
  return {
    user: { id: "u1", email: null, emailVerified: o.verified },
    activityValid: o.active,
    profile: o.household ? { householdId: "h1", role: "family" } : null,
    aal: { current: "aal1", next: "aal1" },
  };
};

describe("home page redirect", () => {
  it("signed-out, unverified or timed-out visitors stay on the sample", () => {
    expect(homeRedirect({ user: null })).toBeNull();
    expect(homeRedirect(signedIn({ verified: false }))).toBeNull();
    expect(homeRedirect(signedIn({ active: false }))).toBeNull();
  });
  it("a verified session goes to Today, or to start when there is no household yet", () => {
    expect(homeRedirect(signedIn())).toBe("/app/today");
    expect(homeRedirect(signedIn({ household: false }))).toBe("/app/start");
  });
});

describe("sample dashboard", () => {
  const html = renderToStaticMarkup(createElement(SampleDashboard));

  it("is clearly labelled as sample data and shows the agreed parts", () => {
    expect(html).toContain(SAMPLE_LABEL);
    expect(SAMPLE_LABEL).toBe("Sample data. Not a real person. Log in to see your own.");
    expect(html).toContain("Sample patient");
    for (const word of ["Taken", "Given by family", "Due 20:00", "Urgent", "Check"]) expect(html, word).toContain(word);
    expect(html).toMatch(/took the morning tablets/);
  });

  it("every tab goes to log in first, and nothing links into the app directly", () => {
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThanOrEqual(5);
    for (const h of hrefs) expect(h, h).toMatch(/^\/login\?next=\/app\//);
  });

  it("contains no real names, medicines or doses", () => {
    expect(html).not.toMatch(/Meera|Anita|Ravi|Rao|Aricept|Amlodac|\d+\s*mg/i);
  });

  it("never calls the database or any API", () => {
    const src = read("src/components/home/sample-dashboard.tsx");
    expect(src).not.toMatch(/fetch\(|postJson|sendJson|supabase|serverDeps|createAdminClient|@\/lib\/(care|patient|auth)\//);
    const page = read("src/app/(public)/page.tsx");
    expect(page).not.toMatch(/fetch\(|supabase|serverDeps|createAdminClient|@\/lib\/(care|patient)\//);
  });

  it("the login and sign-up pages are unchanged by this task", () => {
    expect(read("src/app/(public)/login/page.tsx")).toContain("<LoginForm siteKey={authConfig().turnstileSiteKey} next={next} />");
    expect(read("src/app/(public)/signup/page.tsx")).toContain("<SignupForm siteKey={authConfig().turnstileSiteKey} invite={invite} />");
  });
});

describe("logo", () => {
  it("mark only is one image named Nurra; the full logo adds the wordmark in the text colour", () => {
    const mark = renderToStaticMarkup(createElement(Logo, { variant: "mark" }));
    expect(mark).toMatch(/role="img"[^>]*aria-label="Nurra"|aria-label="Nurra"[^>]*role="img"/);
    const full = renderToStaticMarkup(createElement(Logo, { variant: "full" }));
    expect(full).toContain('aria-hidden="true"');
    expect(full).toMatch(/class="[^"]*font-patient[^"]*text-ink[^"]*"[^>]*>Nurra</);
  });

  it("uses design tokens, so it follows light and dark mode", () => {
    const src = read("src/components/brand/logo.tsx");
    expect(src).toContain("var(--primary)");
    expect(src).toContain("var(--surface)");
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });

  it("the brand files use the same drawing as the component, with no cross or heart", () => {
    for (const f of ["public/brand/nurra-mark.svg", "public/brand/nurra-logo.svg"]) {
      const svg = read(f);
      expect(svg, f).toContain(`d="${MARK_PATH}"`);
      expect(svg, f).toContain(`cx="${MARK_HEAD.cx}" cy="${MARK_HEAD.cy}" r="${MARK_HEAD.r}"`);
      expect(svg, f).toContain('aria-label="Nurra"');
      expect(svg.toLowerCase(), f).not.toMatch(/cross|heart/);
    }
  });
});
