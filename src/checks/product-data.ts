import { parseJson } from "../http.js";
import type { Check, Finding } from "../types.js";

/** Subset of the Store API product shape that we inspect. */
interface StoreProduct {
  id?: number;
  name?: string;
  sku?: string;
  permalink?: string;
  description?: string;
  short_description?: string;
  images?: Array<{ src?: string; alt?: string }>;
  prices?: { price?: string; currency_code?: string };
  is_in_stock?: boolean;
  attributes?: Array<{ name?: string; terms?: unknown[] }>;
  categories?: Array<{ name?: string }>;
  brands?: Array<{ name?: string }>;
  extensions?: Record<string, unknown>;
}

/** Strip HTML tags for rough length measurements. */
function textLength(html: string | undefined): number {
  if (!html) return 0;
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
}

/**
 * Agents rank and compare products from structured fields, not from marketing
 * prose. Missing SKUs, empty attributes and placeholder images make a product
 * un-comparable and therefore un-recommendable.
 */
export const productDataCheck: Check = {
  id: "product-data",
  title: "Product data completeness",
  why: "Agents compare on SKU, attributes, price, stock and images. A field that is missing is a product that is never recommended.",
  max: 25,
  async run({ http, options }) {
    const findings: Finding[] = [];
    const res = await http.get(`/wp-json/wc/store/v1/products?per_page=${options.sampleSize}`);
    const products = parseJson<StoreProduct[]>(res.text);

    if (!res.ok || !Array.isArray(products)) {
      findings.push({
        severity: "error",
        message: "Could not load a product sample from the Store API.",
      });
      return { status: "skip", score: 0, findings };
    }
    if (products.length === 0) {
      findings.push({ severity: "warning", message: "Catalog is empty; nothing to assess." });
      return { status: "skip", score: 0, findings };
    }

    const n = products.length;
    const count = (pred: (p: StoreProduct) => boolean) => products.filter(pred).length;

    const withSku = count((p) => typeof p.sku === "string" && p.sku.trim().length > 0);
    const withImage = count((p) => Array.isArray(p.images) && p.images.length > 0 && !!p.images[0]?.src);
    const withAlt = count(
      (p) => Array.isArray(p.images) && p.images.length > 0 && !!p.images[0]?.alt && p.images[0].alt.trim().length > 3,
    );
    const withDesc = count((p) => textLength(p.description) >= 120);
    const withShort = count((p) => textLength(p.short_description) >= 40);
    const withAttrs = count((p) => Array.isArray(p.attributes) && p.attributes.length > 0);
    const withPrice = count((p) => !!p.prices?.price && Number(p.prices.price) > 0);
    const withCategory = count((p) => Array.isArray(p.categories) && p.categories.length > 0);
    const withBrand = count((p) => Array.isArray(p.brands) && p.brands.length > 0);

    /** Award up to `max` points proportionally to coverage, with a floor at 0. */
    const ratioPoints = (covered: number, max: number) => Math.round((covered / n) * max);

    let score = 0;
    const metric = (label: string, covered: number, max: number, fix: string, threshold = 0.9) => {
      const pts = ratioPoints(covered, max);
      score += pts;
      const pct = Math.round((covered / n) * 100);
      if (covered / n >= threshold) {
        findings.push({ severity: "info", message: `${label}: ${pct}% of sampled products.` });
      } else {
        findings.push({
          severity: covered / n < 0.5 ? "error" : "warning",
          message: `${label}: only ${pct}% of sampled products.`,
          fix,
        });
      }
    };

    metric("SKU present", withSku, 5, "Give every product and variation a unique SKU. Agents use it as the primary key across channels.");
    metric("Price present", withPrice, 3, "Products without a price cannot be offered by an agent.", 0.99);
    metric("Main image present", withImage, 3, "Add at least one image per product.");
    metric("Image alt text", withAlt, 2, "Fill image alt text with the product name and key attribute; vision models and screen readers both use it.", 0.8);
    metric("Long description (120+ chars)", withDesc, 4, "Write descriptions that state use cases, compatibility and specifications, not only marketing claims.", 0.8);
    metric("Short description (40+ chars)", withShort, 2, "Use the short description for the one-sentence pitch an agent can quote.", 0.8);
    metric("Attributes defined", withAttrs, 4, "Define global attributes (size, material, colour, capacity) and assign them. Agents filter on attributes.", 0.7);
    metric("Category assigned", withCategory, 1, "Assign every product to a category.");
    metric("Brand assigned", withBrand, 1, "Use the Brands taxonomy (WooCommerce 9.6+). Brand is one of the first filters shoppers ask agents for.", 0.5);

    findings.push({
      severity: "info",
      message: `Sampled ${n} product(s) from the Store API. GTIN/EAN is not exposed by the Store API; the structured-data check covers it.`,
    });

    const status = score >= 20 ? "pass" : score >= 13 ? "warn" : "fail";
    return { status, score: Math.min(score, 25), findings };
  },
};
