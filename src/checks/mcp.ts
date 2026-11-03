import { parseJson } from "../http.js";
import type { Check, Finding } from "../types.js";

/**
 * Known MCP endpoints on a WordPress/WooCommerce site.
 *
 * - `mcp-adapter-default-server` is the official WordPress MCP Adapter plugin,
 *   which exposes WooCommerce abilities (products-query, orders, ...).
 * - `woocommerce/mcp` was the legacy WooCommerce endpoint, removed in 11.3 (HTTP 410).
 * - `wp/v2/wpmcp` is the community "MCP for WooCommerce" plugin.
 */
const MCP_PATHS = [
  { path: "/wp-json/mcp/mcp-adapter-default-server", label: "WordPress MCP Adapter (official)" },
  { path: "/wp-json/woocommerce/mcp", label: "Legacy WooCommerce MCP (removed in 11.3)" },
  { path: "/wp-json/wp/v2/wpmcp", label: "MCP for WooCommerce (community)" },
] as const;

interface RestIndex {
  namespaces?: string[];
}

/**
 * MCP is how agents call store capabilities (search, cart, orders) as tools
 * rather than scraping. Detecting it is best-effort and unauthenticated:
 * a 401 proves the endpoint exists, a 404 proves it does not.
 */
export const mcpCheck: Check = {
  id: "mcp",
  title: "MCP server exposed",
  why: "MCP lets agents call the store as tools (search, cart, orders) with permissions, instead of scraping HTML.",
  max: 10,
  async run({ http }) {
    const findings: Finding[] = [];

    // 1. REST index: namespaces are the cheapest, most reliable signal.
    const index = await http.get("/wp-json/");
    const namespaces = parseJson<RestIndex>(index.text)?.namespaces ?? [];
    const mcpNamespaces = namespaces.filter((n) => /mcp/i.test(n));

    // 2. Probe known endpoints. A JSON-RPC initialize is harmless and tells us
    //    whether the endpoint exists (401/400/200) or not (404).
    const probes = await Promise.all(
      MCP_PATHS.map(async (p) => {
        const res = await http.post(p.path, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
        return { ...p, status: res.status, error: res.error };
      }),
    );

    if (probes.every((p) => p.status === 0)) {
      findings.push({
        severity: "error",
        message: `Could not reach the site to probe MCP endpoints (${probes[0]?.error ?? "network error"}).`,
      });
      return { status: "skip", score: 0, findings };
    }

    const found = probes.filter((p) => p.status !== 0 && p.status !== 404 && p.status !== 410);
    const legacy = probes.find((p) => p.path.endsWith("/woocommerce/mcp") && p.status === 410);

    if (found.length === 0 && mcpNamespaces.length === 0) {
      findings.push({
        severity: "warning",
        message: "No MCP endpoint detected (probed: " + MCP_PATHS.map((p) => p.path).join(", ") + ").",
        fix: "Install and activate the WordPress MCP Adapter plugin (`wp plugin install mcp-adapter --activate`) to expose WooCommerce abilities to agents over MCP. Authenticate agents with Application Passwords.",
      });
      if (legacy) {
        findings.push({
          severity: "info",
          message: "The legacy /wp-json/woocommerce/mcp endpoint answers 410 Gone, as expected on WooCommerce 11.3+.",
        });
      }
      return { status: "warn", score: 0, findings };
    }

    let score = 6;
    for (const p of found) {
      findings.push({
        severity: "info",
        message: `${p.label} responds at ${p.path} (HTTP ${p.status}).`,
      });
    }
    if (mcpNamespaces.length > 0) {
      score += 2;
      findings.push({ severity: "info", message: `REST index advertises MCP namespace(s): ${mcpNamespaces.join(", ")}.` });
    }

    const official = found.find((p) => p.path.includes("mcp-adapter"));
    if (official) {
      score += 2;
      if (official.status === 401 || official.status === 403) {
        findings.push({
          severity: "info",
          message: "Endpoint requires authentication, which is correct: give agents an Application Password with the minimum capabilities.",
        });
      }
    } else {
      findings.push({
        severity: "info",
        message: "Only a non-official MCP endpoint was found. Consider the WordPress MCP Adapter for forward compatibility with WooCommerce abilities.",
      });
    }

    return { status: score >= 8 ? "pass" : "warn", score: Math.min(score, 10), findings };
  },
};
