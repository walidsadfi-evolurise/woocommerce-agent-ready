import { parseJson } from "../http.js";
import type { Check, Finding } from "../types.js";

/**
 * Known MCP endpoints on a WordPress/WooCommerce site.
 *
 * - `mcp/mcp-adapter-default-server`: the WordPress MCP Adapter plugin, which
 *   exposes WooCommerce abilities (products-query, orders, ...) to MCP clients.
 *   This is the path WooCommerce documents.
 * - `woocommerce/mcp`: the former WooCommerce endpoint, documented as removed
 *   (HTTP 410 Gone) on current versions.
 * - `wp/v2/wpmcp`: Automattic's earlier "WordPress MCP" plugin, superseded by
 *   the adapter but still deployed.
 */
export const MCP_PATHS = [
  { path: "/wp-json/mcp/mcp-adapter-default-server", label: "WordPress MCP Adapter", official: true },
  { path: "/wp-json/woocommerce/mcp", label: "Former WooCommerce MCP endpoint", official: false },
  { path: "/wp-json/wp/v2/wpmcp", label: "WordPress MCP (Automattic, legacy)", official: false },
] as const;

/** A route that cannot exist; used to learn how the site answers unknown POSTs. */
const CONTROL_PATH = "/wp-json/mcp/__agent_ready_control__";

interface RestIndex {
  namespaces?: string[];
}

interface Probe {
  path: string;
  label: string;
  official: boolean;
  status: number;
  error: string | undefined;
  /** The body parses as a JSON-RPC response or a WP REST error object. */
  jsonRpc: boolean;
  wpRestError: string | undefined;
}

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "woocommerce-agent-ready", version: "0.1.0" },
  },
};

/**
 * MCP is how agents call store capabilities (search, cart, orders) as tools
 * rather than scraping. Detection is unauthenticated and best-effort, so it
 * must not be fooled by sites that answer 401/403 to *every* REST route: a
 * control request to a route that cannot exist tells us what "not found"
 * looks like on this host, and only endpoints that behave differently count.
 */
export const mcpCheck: Check = {
  id: "mcp",
  title: "MCP server exposed",
  why: "MCP lets agents call the store as tools (search, cart, orders) with permissions, instead of scraping HTML.",
  max: 5,
  async run({ http }) {
    const findings: Finding[] = [];

    const index = await http.get("/wp-json/");
    const namespaces = parseJson<RestIndex>(index.text)?.namespaces ?? [];
    const mcpNamespaces = namespaces.filter((n) => /^mcp(\/|$)|mcp-adapter/i.test(n));

    const probeOne = async (p: { path: string; label: string; official: boolean }): Promise<Probe> => {
      const res = await http.post(p.path, INITIALIZE, {
        headers: { accept: "application/json, text/event-stream" },
      });
      const body = parseJson<{ jsonrpc?: string; code?: string }>(res.text);
      return {
        ...p,
        status: res.status,
        error: res.error,
        jsonRpc: body?.jsonrpc === "2.0",
        wpRestError: typeof body?.code === "string" ? body.code : undefined,
      };
    };

    const [control, ...probes] = await Promise.all([
      probeOne({ path: CONTROL_PATH, label: "control", official: false }),
      ...MCP_PATHS.map(probeOne),
    ]);

    if (control.status === 0 && probes.every((p) => p.status === 0)) {
      findings.push({
        severity: "error",
        message: `Could not reach the site to probe MCP endpoints (${control.error ?? "network error"}).`,
      });
      return { status: "skip", score: 0, findings };
    }

    /**
     * An endpoint "exists" when it answers unlike the control route. A real
     * JSON-RPC body is proof; a WP REST error other than rest_no_route on a
     * host whose control route *does* say rest_no_route is strong evidence.
     */
    const controlSignature = `${control.status}:${control.wpRestError ?? ""}`;
    const exists = (p: Probe): boolean => {
      if (p.status === 0 || p.status === 404 || p.status === 410) return false;
      if (p.jsonRpc) return true;
      if (p.wpRestError === "rest_no_route") return false;
      const signature = `${p.status}:${p.wpRestError ?? ""}`;
      return signature !== controlSignature;
    };

    const found = probes.filter(exists);
    const gone = probes.find((p) => p.path.endsWith("/woocommerce/mcp") && p.status === 410);
    const uniformAuthWall =
      found.length === 0 && (control.status === 401 || control.status === 403) && probes.every((p) => p.status === control.status);

    if (found.length === 0 && mcpNamespaces.length === 0) {
      findings.push({
        severity: "warning",
        message: `No MCP endpoint detected (probed ${MCP_PATHS.map((p) => p.path).join(", ")}).`,
        fix: "Install the WordPress MCP Adapter plugin to expose WooCommerce abilities to agents over MCP, then give agents an Application Password with the minimum capabilities.",
      });
      if (uniformAuthWall) {
        findings.push({
          severity: "info",
          message: `Every REST route answers HTTP ${control.status}, including routes that do not exist; MCP cannot be detected through this authentication wall.`,
        });
      }
      if (gone) {
        findings.push({ severity: "info", message: "The former /wp-json/woocommerce/mcp endpoint answers 410 Gone, as documented for current WooCommerce versions." });
      }
      return { status: "warn", score: 0, findings };
    }

    let score = 0;
    for (const p of found) {
      findings.push({ severity: "info", message: `${p.label} responds at ${p.path} (HTTP ${p.status}${p.jsonRpc ? ", JSON-RPC" : ""}).` });
    }
    if (mcpNamespaces.length > 0) {
      findings.push({ severity: "info", message: `REST index advertises MCP namespace(s): ${mcpNamespaces.join(", ")}.` });
    }

    const official = found.find((p) => p.official);
    if (official) {
      score = 5;
      if (official.status === 401 || official.status === 403) {
        findings.push({ severity: "info", message: "Endpoint requires authentication, which is correct for write-capable tools." });
      }
    } else {
      score = 3;
      findings.push({
        severity: "info",
        message: "Only a legacy MCP endpoint was found. The WordPress MCP Adapter is the path WooCommerce documents for its abilities.",
      });
    }

    return { status: score >= 5 ? "pass" : "warn", score, findings };
  },
};
