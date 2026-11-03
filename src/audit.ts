import { createRequire } from "node:module";
import { cartCheck } from "./checks/cart.js";
import { mcpCheck } from "./checks/mcp.js";
import { performanceCheck } from "./checks/performance.js";
import { productDataCheck } from "./checks/product-data.js";
import { robotsCheck } from "./checks/robots.js";
import { storeApiCheck } from "./checks/store-api.js";
import { structuredDataCheck } from "./checks/structured-data.js";
import { createHttp } from "./http.js";
import type { AuditOptions, AuditReport, Check, CheckResult } from "./types.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

/** All checks, in display order. Max points sum to 100. */
export const CHECKS: Check[] = [
  storeApiCheck,
  productDataCheck,
  structuredDataCheck,
  robotsCheck,
  mcpCheck,
  cartCheck,
  performanceCheck,
];

export const DEFAULT_OPTIONS: Omit<AuditOptions, "baseUrl"> = {
  timeoutMs: 10_000,
  sampleSize: 20,
  userAgent: `woocommerce-agent-ready/${pkg.version} (+https://github.com/walidsadfi-evolurise/woocommerce-agent-ready)`,
};

export function gradeFor(score: number): AuditReport["grade"] {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

/** Normalise user input into an absolute https URL without a trailing path. */
export function normaliseBaseUrl(input: string): string {
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(withScheme);
  url.hash = "";
  url.search = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.toString();
}

export async function runAudit(
  partial: Partial<AuditOptions> & { baseUrl: string },
  checks: Check[] = CHECKS,
): Promise<AuditReport> {
  const options: AuditOptions = { ...DEFAULT_OPTIONS, ...partial, baseUrl: normaliseBaseUrl(partial.baseUrl) };
  const http = createHttp(options.baseUrl, options.timeoutMs, options.userAgent);
  const started = performance.now();
  const results: CheckResult[] = [];

  for (const check of checks) {
    const t0 = performance.now();
    options.log?.(`running ${check.id}`);
    let partialResult: Awaited<ReturnType<Check["run"]>>;
    try {
      partialResult = await check.run({ options, http });
    } catch (err) {
      partialResult = {
        status: "skip",
        score: 0,
        findings: [
          {
            severity: "error",
            message: `Check crashed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
    results.push({
      id: check.id,
      title: check.title,
      why: check.why,
      max: check.max,
      durationMs: performance.now() - t0,
      ...partialResult,
      score: Math.max(0, Math.min(check.max, Math.round(partialResult.score))),
    });
  }

  const max = results.reduce((s, r) => s + r.max, 0);
  const score = results.reduce((s, r) => s + r.score, 0);

  return {
    baseUrl: options.baseUrl,
    auditedAt: new Date().toISOString(),
    toolVersion: pkg.version,
    score,
    max,
    grade: gradeFor(Math.round((score / max) * 100)),
    checks: results,
    durationMs: performance.now() - started,
  };
}
