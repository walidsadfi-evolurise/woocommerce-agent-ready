import { describe, expect, it } from "vitest";
import { AI_SEARCH_CRAWLERS, groupFor, isAllowed, parseRobots } from "../src/checks/robots.js";
import { extractJsonLd } from "../src/checks/structured-data.js";
import { looksLikeHtml, median } from "../src/http.js";
import { renderHtml } from "../src/report/html.js";
import { renderTerminal, sanitize } from "../src/report/terminal.js";
import type { AuditReport } from "../src/types.js";

describe("parseRobots / isAllowed", () => {
  const txt = `
# comment
User-agent: *
Disallow: /wp-admin/
Allow: /wp-admin/admin-ajax.php

User-agent: GPTBot
User-agent: ClaudeBot
Disallow: /

User-agent: Bingbot
Disallow: /
Allow: /product/
`;
  const groups = parseRobots(txt);

  it("groups consecutive user-agents and ignores comments", () => {
    expect(groups).toHaveLength(3);
    expect(groups[1]?.agents).toEqual(["gptbot", "claudebot"]);
  });

  it("prefers the specific group over *", () => {
    expect(groupFor(groups, "ClaudeBot")?.disallow).toEqual(["/"]);
    expect(groupFor(groups, "PerplexityBot")?.disallow).toEqual(["/wp-admin/"]);
  });

  it("applies longest-match between Allow and Disallow", () => {
    const star = groupFor(groups, "*");
    expect(isAllowed(star, "/wp-admin/admin-ajax.php")).toBe(true);
    expect(isAllowed(star, "/wp-admin/options.php")).toBe(false);
    expect(isAllowed(star, "/product/kettle/")).toBe(true);

    const bing = groupFor(groups, "Bingbot");
    expect(isAllowed(bing, "/")).toBe(false);
    expect(isAllowed(bing, "/product/kettle/")).toBe(true);
  });

  it("treats an undefined group as fully open", () => {
    expect(isAllowed(undefined, "/anything")).toBe(true);
  });

  it("exports the search-crawler list used for scoring", () => {
    expect(AI_SEARCH_CRAWLERS).toContain("OAI-SearchBot");
    expect(AI_SEARCH_CRAWLERS).not.toContain("GPTBot");
  });
});

describe("extractJsonLd", () => {
  it("reads single objects, arrays and @graph", () => {
    const html = `
<script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script>
<script type='application/ld+json'>[{"@type":"BreadcrumbList"}]</script>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Product","sku":"X1"}]}</script>
<script type="application/ld+json">not json</script>`;
    const nodes = extractJsonLd(html);
    const types = nodes.map((n) => n["@type"]);
    expect(types).toContain("Organization");
    expect(types).toContain("BreadcrumbList");
    expect(types).toContain("Product");
  });

  it("returns an empty list without JSON-LD", () => {
    expect(extractJsonLd("<html><body>hi</body></html>")).toEqual([]);
  });
});

describe("helpers", () => {
  it("median handles odd, even and empty inputs", () => {
    expect(median([])).toBe(0);
    expect(median([5])).toBe(5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("looksLikeHtml detects documents, not JSON or text", () => {
    expect(looksLikeHtml("<!DOCTYPE html><html>")).toBe(true);
    expect(looksLikeHtml("  <html lang='en'>")).toBe(true);
    expect(looksLikeHtml("User-agent: *\nDisallow:")).toBe(false);
    expect(looksLikeHtml('{"a":1}')).toBe(false);
  });

  it("sanitize strips ANSI and control characters", () => {
    expect(sanitize("ok\u001b[31mred\u001b[0m\u0007bell")).toBe("okredbell");
    expect(sanitize("plain é ü")).toBe("plain é ü");
  });
});

describe("report escaping", () => {
  const malicious = "</script><script>alert(1)</script><img src=x onerror=alert(2)>";
  const report: AuditReport = {
    baseUrl: `https://evil.example/${malicious}`,
    auditedAt: "2026-11-04T00:00:00.000Z",
    toolVersion: "0.0.0",
    score: 10,
    max: 100,
    grade: "F",
    durationMs: 1,
    checks: [
      {
        id: "x",
        title: "X",
        why: "why",
        status: "fail",
        score: 10,
        max: 100,
        durationMs: 1,
        findings: [{ severity: "error", message: malicious, fix: malicious }],
      },
    ],
  };

  it("HTML report never emits the injected markup", () => {
    const html = renderHtml(report);
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("terminal report has no colour when disabled and strips escapes", () => {
    const text = renderTerminal(
      { ...report, checks: [{ ...report.checks[0]!, findings: [{ severity: "error", message: "a\u001b[2Jb" }] }] },
      { color: false },
    );
    expect(text).not.toContain("\u001b");
    expect(text).toContain("ab");
  });
});
