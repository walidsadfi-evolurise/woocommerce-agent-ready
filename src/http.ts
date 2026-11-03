import type { Http, HttpResponse } from "./types.js";

/** Extract a useful reason from an undici/fetch failure. */
function describeError(err: unknown, timeoutMs: number): string {
  if (err instanceof Error && err.name === "AbortError") return `timeout after ${timeoutMs} ms`;
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: unknown }).cause;
    if (cause && typeof cause === "object") {
      const c = cause as { code?: string; message?: string };
      if (c.code) return `${c.code}${c.message ? ` (${c.message})` : ""}`;
      if (c.message) return c.message;
    }
    return err.message;
  }
  return String(err);
}

/**
 * Minimal HTTP client built on the global fetch (Node >= 20).
 *
 * - Resolves paths against the store base URL.
 * - Applies a hard timeout per request.
 * - Never throws: network failures are returned as a response with `error`.
 * - Measures wall-clock duration so checks can score latency.
 * - Caches GET responses for the lifetime of the client so checks can share
 *   the same product list or page without re-fetching. Pass `fresh: true`
 *   to bypass the cache (latency sampling).
 */
export function createHttp(baseUrl: string, timeoutMs: number, userAgent: string): Http {
  const base = new URL(baseUrl);
  const cache = new Map<string, Promise<HttpResponse>>();

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
      return {
        status: 0,
        ok: false,
        headers: new Headers(),
        text: "",
        durationMs: performance.now() - started,
        url,
        error: describeError(err, timeoutMs),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    get(path, init) {
      const headers = init?.headers ?? {};
      if (init?.fresh) return request("GET", path, undefined, headers);
      const key = `${path}|${JSON.stringify(headers)}`;
      let pending = cache.get(key);
      if (!pending) {
        pending = request("GET", path, undefined, headers);
        cache.set(key, pending);
      }
      return pending;
    },
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

/** True when a body that should be plain text or JSON is actually an HTML document. */
export function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 512).trimStart().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html") || /<head[\s>]/.test(head);
}
