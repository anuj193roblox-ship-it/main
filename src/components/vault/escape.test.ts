// User text (notes, names, titles) must be shown as text. A script tag in a notes field is
// displayed, never run.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }), usePathname: () => "/app/vault" }));

const { ConditionCard } = await import("./vault-screen");

const attack = `<script>alert("x")</script><img src=x onerror=alert(1)>`;

describe("user text is escaped", () => {
  it("a script tag in condition notes and name is rendered as text", () => {
    const html = renderToStaticMarkup(
      createElement(ConditionCard, {
        c: { id: "1", name: attack, since: "", treatingDoctor: attack, notes: attack },
        onEdit: () => undefined,
        onDelete: () => undefined,
        busy: false,
      }),
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("no component uses dangerouslySetInnerHTML", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const f = path.join(dir, n);
        return statSync(f).isDirectory() ? walk(f) : [f];
      });
    const offenders = walk(path.join(process.cwd(), "src"))
      .filter((f) => /\.(tsx|ts)$/.test(f) && !f.endsWith(".test.ts"))
      .filter((f) => readFileSync(f, "utf8").includes("dangerouslySetInnerHTML"));
    expect(offenders).toEqual([]);
  });
});
