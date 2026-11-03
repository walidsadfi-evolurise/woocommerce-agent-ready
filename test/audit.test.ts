import { afterEach, describe, expect, it } from "vitest";
import { CHECKS, gradeFor, normaliseBaseUrl, runAudit } from "../src/audit.js";
import { performanceCheck } from "../src/checks/performance.js";
import { renderHtml } from "../src/report/html.js";
import { renderTerminal } from "../src/report/terminal.js";
import { startMockStore, type MockStore } from "./mock-store.js";

let store: MockStore | undefined;
afterEach(async () => {
  await store?.close();
  store = undefined;
});

const byId = (report: Awaited<ReturnType<typeof runAudit>>, id: string) => {
  const c = report.checks.find((x) => x.id === id);
  if (!c) throw new Error(`check ${id} missing`);
  return c;
};

describe("scoring model", () => {
  it("check maxima sum to 100", () => {
    expect(CHECKS.reduce((s, c) => s + c.max, 0)).toBe(100);
  });

  it("grades map to the documented thresholds", () => {
    expect(gradeFor(100)).toBe("A");
    expect(gradeFor(85)).toBe("A");
    expect(gradeFor(84)).toBe("B");
    expect(gradeFor(70)).toBe("B");
    expect(gradeFor(55)).toBe("C");
    expect(gradeFor(40)).toBe("D");
    expect(gradeFor(39)).toBe("F");
  });

  it("normalises base URLs", () => {
    expect(normaliseBaseUrl("shop.example.com")).toBe("https://shop.example.com/");
    expect(normaliseBaseUrl("https://shop.example.com/?utm=1#x")).toBe("https://shop.example.com/");
    expect(normaliseBaseUrl("http://localhost:8080")).toBe("http://localhost:8080/");
  });
});

describe("a well-configured store", () => {
  it("scores an A with every check passing", async () => {
    store = await startMockStore();
    const report = await runAudit({ baseUrl: store.url, timeoutMs: 3000, sampleSize: 10 });

    expect(report.max).toBe(100);
    expect(report.score).toBeGreaterThanOrEqual(90);
    expect(report.grade).toBe("A");
    for (const c of report.checks) {
      expect(c.status, `${c.id} should pass`).toBe("pass");
      expect(c.score).toBeLessThanOrEqual(c.max);
    }
  });

  it("sends an identifiable User-Agent and never mutates the store", async () => {
    store = await startMockStore();
    await runAudit({ baseUrl: store.url, timeoutMs: 3000, sampleSize: 5 });
    // The only non-GET requests are the read-only MCP `initialize` probes.
    const mutating = store.requests.filter((r) => !r.startsWith("GET ") && !/mcp/i.test(r));
    expect(mutating).toEqual([]);
  });
});

describe("store-api", () => {
  it("fails when the Store API is missing", async () => {
    store = await startMockStore({ storeApi: "missing" });
    const report = await runAudit({ baseUrl: store.url, timeoutMs: 3000 });
    const c = byId(report, "store-api");
    expect(c.status).toBe("fail");
    expect(c.score).toBe(0);
    expect(c.findings.some((f) => /404/.test(f.message))).toBe(true);
  });

  it("fails when a cache returns HTML instead of JSON", async () => {
    store = await startMockStore({ storeApi: "html" });
    const report = await runAudit({ baseUrl: store.url, timeoutMs: 3000 });
    expect(byId(report, "store-api").status).toBe("fail");
    expect(byId(report, "product-data").status).toBe("skip");
  });

  it("warns when X-WP-Total is stripped", async () => {
    store = await startMockStore({ exposeTotal: false });
    const report = await runAudit({ baseUrl: store.url, timeoutMs: 3000 });
    const c = byId(report, "store-api");
    expect(c.findings.some((f) => /X-WP-Total/.test(f.message) && f.severity === "warning")).toBe(true);
    expect(c.score).toBe(18);
  });
});

describe("product-data", () => {
  it("loses SKU and attribute points when they are missing", async () => {
    store = await startMockStore({ withSku: false, withAttributes: false });
    const report = await runAudit({ baseUrl: store.url, timeoutMs: 3000, sampleSize: 10 });
    const c = byId(report, "product-data");
    expect(c.score).toBe(25 - 5 - 4);
    expect(c.findings.filter((f) => f.severity === "error").length).toBe(2);
  });

  it("respects the sample size", async () => {
    store = await startMockStore({ products: 50 });
    await runAudit({ baseUrl: store.url, timeoutMs: 3000, sampleSize: 7 });
    expect(store.requests.some((r) => r.includes("per_page=7"))).toBe(true);
  });
});

describe("structured-data", () => {
  it("fails without Product JSON-LD", async () => {
    store = await startMockStore({ jsonLd: "none" });
    const report = await runAudit({ baseUrl: store.url, timeoutMs: 3000 });
    const c = byId(report, "structured-data");
    expect(c.status).toBe("fail");
    expect(c.score).toBe(0);
  });

  it("flags a missing GTIN as an error but keeps the other points", async () => {
    store = await startMockStore({ jsonLd: "no-gtin" });
    const report = await runAudit({ baseUrl: store.url, timeoutMs: 3000 });
    const c = byId(report, "structured-data");
    expect(c.score).toBe(15 - 4);
    expect(c.findings.some((f) => /GTIN/.test(f.message) && f.severity === "error")).toBe(true);
  });
});

describe("robots", () => {
  it("treats a missing robots.txt as fully open", async () => {
    store = await startMockStore({ robots: "none" });
    const report = await runAudit({ baseUrl: store.url, timeoutMs: 3000 });
    expect(byId(report, "robots").score).toBe(10);
  });

  it("fails a blanket Disallow: /", async () => {
    store = await startMockStore({ robots: "block-all" });
    const report = await runAudit({ baseUrl: store.url, timeoutMs: 3000 });
    expect(byId(report, "robots").status).toBe("fail");
  });

  it("penalises per-agent blocks of AI crawlers", async () => {
    store = await startMockStore({ robots: "block-ai" });
    const report = await runAudit({ baseUrl: store.url, timeoutMs: 3000 });
    const c = byId(report, "robots");
    expect(c.score).toBe(4);
    expect(c.findings.some((f) => /GPTBot, ClaudeBot, PerplexityBot/.test(f.message))).toBe(true);
  });

  it("warns when /wp-json/ is disallowed", async () => {
    store = await startMockStore({ robots: "block-wpjson" });
    const report = await runAudit({ baseUrl: store.url, timeoutMs: 3000 });
    expect(byId(report, "robots").score).toBe(8);
  });
});

describe("mcp", () => {
  it("detects the official adapter behind a 401", async () => {
    store = await startMockStore({ mcp: "official" });
    const report = await runAudit({ baseUrl: store.url, timeoutMs: 3000 });
    const c = byId(report, "mcp");
    expect(c.status).toBe("pass");
    expect(c.score).toBe(10);
  });

  it("detects a community server with a lower score", async () => {
    store = await startMockStore({ mcp: "community" });
    const report = await runAudit({ baseUrl: store.url, timeoutMs: 3000 });
    const c = byId(report, "mcp");
    expect(c.status).toBe("warn");
    expect(c.score).toBe(6);
  });

  it("reports no MCP and mentions the legacy 410", async () => {
    store = await startMockStore({ mcp: "legacy-gone" });
    const report = await runAudit({ baseUrl: store.url, timeoutMs: 3000 });
    const c = byId(report, "mcp");
    expect(c.score).toBe(0);
    expect(c.findings.some((f) => /410/.test(f.message))).toBe(true);
  });
});

describe("cart", () => {
  it("rewards Cart-Token and an API-first gateway", async () => {
    store = await startMockStore();
    const report = await runAudit({ baseUrl: store.url, timeoutMs: 3000 });
    expect(byId(report, "cart").score).toBe(10);
  });

  it("warns without Cart-Token and without an API gateway", async () => {
    store = await startMockStore({ cartToken: false, paymentMethods: ["cod", "bacs"] });
    const report = await runAudit({ baseUrl: store.url, timeoutMs: 3000 });
    const c = byId(report, "cart");
    expect(c.status).toBe("warn");
    expect(c.score).toBe(6);
  });
});

describe("performance", () => {
  it("loses points on a slow store", async () => {
    // 1100 ms puts the API in the 1-2 s band (2 pts) and the page in the 0.8-1.5 s band (3 pts).
    store = await startMockStore({ delayMs: 1100 });
    const report = await runAudit({ baseUrl: store.url, timeoutMs: 5000, sampleSize: 3 }, [performanceCheck]);
    const c = byId(report, "performance");
    expect(c.score).toBe(5);
    expect(c.status).toBe("warn");
  }, 30_000);
});

describe("resilience", () => {
  it("never throws when the host is unreachable", async () => {
    const report = await runAudit({ baseUrl: "http://127.0.0.1:1", timeoutMs: 1500 });
    expect(report.score).toBeLessThanOrEqual(10);
    expect(report.grade).toBe("F");
    expect(byId(report, "store-api").status).toBe("fail");
  });
});

describe("reports", () => {
  it("renders terminal and HTML without leaking raw HTML", async () => {
    store = await startMockStore({ withSku: false });
    const report = await runAudit({ baseUrl: store.url, timeoutMs: 3000, sampleSize: 5 });

    const text = renderTerminal(report, { verbose: true });
    expect(text).toContain("Score");
    expect(text).toContain("SKU present");

    const html = renderHtml(report);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Product data completeness");
    expect(html).not.toContain("<script>");
  });
});
