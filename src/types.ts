/**
 * Shared types for the audit engine.
 *
 * A check is a self-contained probe that inspects one aspect of a store and
 * returns a scored result. The audit runs all checks, sums the scores and
 * produces a report.
 */

export type CheckStatus = "pass" | "warn" | "fail" | "skip";

export interface Finding {
  /** Short, human-readable statement of what was observed. */
  message: string;
  /** How to fix it, when applicable. */
  fix?: string;
  /** Whether this finding cost points. */
  severity: "info" | "warning" | "error";
}

export interface CheckResult {
  /** Stable identifier, e.g. "store-api". */
  id: string;
  /** Human-readable title. */
  title: string;
  /** One-line explanation of why this matters for agents. */
  why: string;
  status: CheckStatus;
  /** Points earned. */
  score: number;
  /** Maximum points for this check. */
  max: number;
  findings: Finding[];
  /** Milliseconds spent running this check. */
  durationMs: number;
}

export interface AuditOptions {
  /** Store base URL, e.g. https://shop.example.com */
  baseUrl: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
  /** How many products to sample for data-quality checks. */
  sampleSize: number;
  /** User-Agent sent with every request. */
  userAgent: string;
  /** Optional logger for verbose output. */
  log?: (line: string) => void;
}

export interface AuditReport {
  baseUrl: string;
  /** ISO timestamp of when the audit ran. */
  auditedAt: string;
  /** Tool version that produced the report. */
  toolVersion: string;
  score: number;
  max: number;
  grade: "A" | "B" | "C" | "D" | "F";
  checks: CheckResult[];
  /** Total wall-clock time in milliseconds. */
  durationMs: number;
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  headers: Headers;
  /** Response body as text. Empty string on network failure. */
  text: string;
  /** Time to complete the request, in milliseconds. */
  durationMs: number;
  /** Final URL after redirects. */
  url: string;
  /** Set when the request failed before a response arrived. */
  error?: string;
}

export interface Http {
  get(path: string, init?: { headers?: Record<string, string> }): Promise<HttpResponse>;
  post(
    path: string,
    body: unknown,
    init?: { headers?: Record<string, string> },
  ): Promise<HttpResponse>;
}

export interface CheckContext {
  options: AuditOptions;
  http: Http;
}

export interface Check {
  id: string;
  title: string;
  why: string;
  max: number;
  run(ctx: CheckContext): Promise<Omit<CheckResult, "id" | "title" | "why" | "max" | "durationMs">>;
}
