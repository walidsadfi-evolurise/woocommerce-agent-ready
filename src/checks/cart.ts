import { parseJson } from "../http.js";
import type { Check, Finding } from "../types.js";

interface StoreCart {
  items?: unknown[];
  payment_methods?: string[];
  payment_requirements?: string[];
  needs_payment?: boolean;
  shipping_rates?: unknown[];
  totals?: { currency_code?: string };
}

/**
 * Agentic checkout (ACP from Stripe/OpenAI, UCP from Shopify/Google) sits on top
 * of a working headless cart. The Store API cart endpoints are the foundation;
 * if they are blocked or empty, no checkout protocol can be layered on.
 */
export const cartCheck: Check = {
  id: "cart",
  title: "Headless cart & checkout foundation",
  why: "Agentic checkout protocols (ACP, UCP) need a working headless cart and at least one API-capable payment method.",
  max: 10,
  async run({ http }) {
    const findings: Finding[] = [];
    const res = await http.get("/wp-json/wc/store/v1/cart");

    if (!res.ok) {
      findings.push({
        severity: "error",
        message: `Cart endpoint unavailable (HTTP ${res.status || "error"}).`,
        fix: "The Store API cart must be reachable without a browser session. Check security plugins and WAF rules on /wp-json/wc/store/v1/cart.",
      });
      return { status: "fail", score: 0, findings };
    }

    const cart = parseJson<StoreCart>(res.text);
    if (!cart || typeof cart !== "object") {
      findings.push({ severity: "error", message: "Cart endpoint returned a non-JSON body." });
      return { status: "fail", score: 0, findings };
    }

    let score = 4;
    findings.push({ severity: "info", message: "Store API cart is reachable." });

    const nonce = res.headers.get("nonce") ?? res.headers.get("x-wc-store-api-nonce");
    const cartToken = res.headers.get("cart-token");
    if (cartToken) {
      score += 3;
      findings.push({ severity: "info", message: "Cart-Token header present: stateless carts work for agents (no cookies needed)." });
    } else if (nonce) {
      score += 1;
      findings.push({
        severity: "warning",
        message: "Only a Nonce header is exposed; no Cart-Token. Agents must keep cookies to persist a cart.",
        fix: "Update WooCommerce (Cart-Token is available since 7.2) and make sure the proxy forwards the Cart-Token header.",
      });
    } else {
      findings.push({
        severity: "warning",
        message: "Neither Cart-Token nor Nonce header exposed; cart mutations will fail for agents.",
        fix: "Do not strip custom response headers at the CDN/proxy. Allow `Cart-Token` and `Nonce` in Access-Control-Expose-Headers.",
      });
    }

    const methods = cart.payment_methods ?? [];
    const apiCapable = methods.filter((m) => /stripe|paypal|mollie|adyen|square|checkout_com|payplug/i.test(m));
    if (methods.length === 0) {
      findings.push({
        severity: "warning",
        message: "No payment method advertised on an empty cart (normal on some setups; re-check with an item in the cart).",
      });
      score += 1;
    } else if (apiCapable.length > 0) {
      score += 3;
      findings.push({
        severity: "info",
        message: `API-capable payment method(s): ${apiCapable.join(", ")}. ACP-style tokenised checkout is feasible.`,
      });
    } else {
      score += 1;
      findings.push({
        severity: "warning",
        message: `Payment methods found (${methods.join(", ")}) but none is a known API-first gateway.`,
        fix: "Add Stripe (ACP reference implementation) or another gateway with a tokenised server-side API.",
      });
    }

    return { status: score >= 8 ? "pass" : score >= 5 ? "warn" : "fail", score: Math.min(score, 10), findings };
  },
};
