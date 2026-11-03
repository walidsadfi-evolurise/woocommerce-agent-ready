import { parseJson } from "../http.js";
import type { Check, Finding } from "../types.js";

/**
 * The WooCommerce Store API (/wp-json/wc/store/v1) is the public, unauthenticated
 * surface that agents use to search products and build carts. If it is blocked,
 * slow or returns garbage, no agent can shop here.
 */
export const storeApiCheck: Check = {
  id: "store-api",
  title: "Store API reachable",
  why: "Agents discover products and build carts through the public Store API. Without it, the store is invisible to them.",
  max: 20,
  async run({ http }) {
    const findings: Finding[] = [];
    let score = 0;

    // Warm the connection first so the latency figure below excludes DNS, TCP and TLS setup.
    await http.get("/wp-json/", { fresh: true });
    const res = await http.get("/wp-json/wc/store/v1/products?per_page=5", {
      headers: { origin: "https://agent.example" },
      fresh: true,
    });

    if (res.error) {
      findings.push({
        severity: "error",
        message: `Request failed: ${res.error}`,
        fix: "Check that the store is online and not behind a firewall or bot challenge that blocks non-browser clients.",
      });
      return { status: "fail", score, findings };
    }

    if (res.status === 404) {
      findings.push({
        severity: "error",
        message: "Store API not found (HTTP 404). WooCommerce may be missing or the REST API is disabled.",
        fix: "Make sure WooCommerce is active and that no plugin disables the REST API or rewrites /wp-json.",
      });
      return { status: "fail", score, findings };
    }

    if (res.status === 401 || res.status === 403) {
      findings.push({
        severity: "error",
        message: `Store API refused the request (HTTP ${res.status}).`,
        fix: "The Store API must be public for agents. Remove authentication requirements or bot-blocking rules on /wp-json/wc/store.",
      });
      return { status: "fail", score, findings };
    }

    if (!res.ok) {
      findings.push({
        severity: "error",
        message: `Unexpected HTTP ${res.status} from the Store API.`,
      });
      return { status: "fail", score, findings };
    }

    const json = parseJson<unknown>(res.text);
    if (!Array.isArray(json)) {
      findings.push({
        severity: "error",
        message: "Store API responded but the body is not a JSON array of products.",
        fix: "A caching or security layer may be rewriting API responses. Exclude /wp-json from page caching and HTML minification.",
      });
      return { status: "fail", score, findings };
    }

    score += 12;
    findings.push({ severity: "info", message: `Store API returned ${json.length} product(s).` });

    const total = res.headers.get("x-wp-total");
    if (total) {
      score += 2;
      findings.push({ severity: "info", message: `Catalog exposes ${total} products in total (X-WP-Total).` });
    } else {
      findings.push({
        severity: "warning",
        message: "Missing X-WP-Total header; agents cannot paginate reliably.",
        fix: "Do not strip X-WP-* headers at the proxy or CDN level.",
      });
    }

    const cors = res.headers.get("access-control-allow-origin");
    if (cors) {
      score += 2;
    } else {
      findings.push({
        severity: "warning",
        message: "No Access-Control-Allow-Origin header even with an Origin header sent. Browser-based agents will need a proxy.",
        fix: "WordPress sends CORS headers for REST requests by default; a proxy or security plugin is stripping them.",
      });
    }

    if (res.durationMs <= 800) {
      score += 4;
      findings.push({ severity: "info", message: `Store API answered in ${Math.round(res.durationMs)} ms on a warm connection.` });
    } else if (res.durationMs <= 2000) {
      score += 2;
      findings.push({
        severity: "warning",
        message: `Store API is slow: ${Math.round(res.durationMs)} ms for 5 products.`,
        fix: "Enable an object cache (Redis) and make sure the Store API is excluded from full-page caching but served by PHP-FPM with opcache.",
      });
    } else {
      findings.push({
        severity: "error",
        message: `Store API is very slow: ${Math.round(res.durationMs)} ms for 5 products. Agents time out.`,
        fix: "Profile the catalog queries; add Redis object cache; check for plugins hooking into every REST request.",
      });
    }

    const status = score >= 16 ? "pass" : score >= 12 ? "warn" : "fail";
    return { status, score, findings };
  },
};
