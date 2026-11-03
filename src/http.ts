import type { Http, HttpResponse } from "./types.js";

/**
 * Minimal HTTP client built on the global fetch (Node >= 20).
 *
 * - Resolves paths against the store base URL.
 * - Applies a hard timeout per request.
 * - Never throws: network failures are returned as a response with `error`.
 * - Measures wall-clock duration so checks can score latency.
 */
export function createHttp(baseUrl: string, timeoutMs: number, userAgent: string): Http {
  const base = new URL(baseUrl);

  async function request(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<HttpResponse> {
    const url = new URL(path, base).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = performance.now();

    const headers: Record<string, string> = {
      "user-agent": userAgent,
      accept: "application/json, text/html;q=0.9, */*;q=0.8",
      ...extraHeaders,
    };
    if (body !== undefined) headers["content-type"] = "application/json";

    try {
      const init: RequestInit = { method, headers, redirect: "follow", signal: controller.signal };
      if (body !== undefined) init.body = JSON.stringify(body);
      const res = await fetch(url, init);
      const text = await res.text();
      return {
        status: res.status,
        ok: res.ok,
        headers: res.headers,
        text,
        durationMs: performance.now() - started,
        url: res.url || url,
      };
    } catch (err) {
      const message =
        err instanceof Error && err.name === "AbortError"
          ? `timeout after ${timeoutMs} ms`
          : err instanceof Error
            ? err.message
            : String(err);
      return {
        status: 0,
        ok: false,
        headers: new Headers(),
        text: "",
        durationMs: performance.now() - started,
        url,
        error: message,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    get: (path, init) => request("GET", path, undefined, init?.headers),
    post: (path, body, init) => request("POST", path, body, init?.headers),
  };
}

/** Parse JSON defensively. Returns `undefined` on any failure. */
export function parseJson<T = unknown>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/** Median of a list of numbers; 0 for an empty list. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}
