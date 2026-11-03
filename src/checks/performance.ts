import { median, parseJson } from "../http.js";
import type { Check, Finding } from "../types.js";

/**
 * Agents issue many small requests and abandon slow stores. We measure the
 * median latency of the product search endpoint and the time to first byte of
 * a product page, each over three samples.
 */
export const performanceCheck: Check = {
  id: "performance",
  title: "API and page latency",
  why: "An agent compares dozens of stores in seconds. Slow APIs are skipped, not retried.",
  max: 10,
  async run({ http }) {
    const findings: Finding[] = [];

    const apiSamples: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await http.get(`/wp-json/wc/store/v1/products?per_page=10&search=a&_=${i}`);
      if (r.ok) apiSamples.push(r.durationMs);
    }

    let pageSamples: number[] = [];
    const first = await http.get("/wp-json/wc/store/v1/products?per_page=1");
    const permalink = parseJson<Array<{ permalink?: string }>>(first.text)?.[0]?.permalink;
    if (permalink) {
      for (let i = 0; i < 3; i++) {
        const r = await http.get(permalink);
        if (r.ok) pageSamples.push(r.durationMs);
      }
    } else {
      pageSamples = [];
    }

    let score = 0;

    if (apiSamples.length === 0) {
      findings.push({ severity: "error", message: "Could not measure Store API latency." });
    } else {
      const m = median(apiSamples);
      const pts = m <= 500 ? 6 : m <= 1000 ? 4 : m <= 2000 ? 2 : 0;
      score += pts;
      findings.push({
        severity: pts >= 4 ? "info" : pts === 2 ? "warning" : "error",
        message: `Store API search: median ${Math.round(m)} ms over ${apiSamples.length} samples.`,
        ...(pts < 4
          ? { fix: "Target under 500 ms. Add Redis object cache, keep opcache warm, and audit plugins that run on every REST request." }
          : {}),
      });
    }

    if (pageSamples.length === 0) {
      findings.push({ severity: "warning", message: "Could not measure product page latency." });
    } else {
      const m = median(pageSamples);
      const pts = m <= 800 ? 4 : m <= 1500 ? 3 : m <= 3000 ? 1 : 0;
      score += pts;
      findings.push({
        severity: pts >= 3 ? "info" : pts === 1 ? "warning" : "error",
        message: `Product page: median ${Math.round(m)} ms over ${pageSamples.length} samples.`,
        ...(pts < 3
          ? { fix: "Serve product pages from a full-page cache (nginx FastCGI cache or a CDN) with a sensible TTL and stock-aware purge." }
          : {}),
      });
    }

    return { status: score >= 8 ? "pass" : score >= 4 ? "warn" : "fail", score, findings };
  },
};
