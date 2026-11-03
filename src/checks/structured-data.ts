import { parseJson } from "../http.js";
import type { Check, Finding } from "../types.js";

interface JsonLdNode {
  "@type"?: string | string[];
  "@graph"?: JsonLdNode[];
  [key: string]: unknown;
}

/** Collect every JSON-LD node found in <script type="application/ld+json"> blocks. */
export function extractJsonLd(html: string): JsonLdNode[] {
  const nodes: JsonLdNode[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = (m[1] ?? "").trim();
    const parsed = parseJson<JsonLdNode | JsonLdNode[]>(raw);
    if (!parsed) continue;
    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const node of list) {
      nodes.push(node);
      if (Array.isArray(node["@graph"])) nodes.push(...node["@graph"]);
    }
  }
  return nodes;
}

function hasType(node: JsonLdNode, type: string): boolean {
  const t = node["@type"];
  if (typeof t === "string") return t === type;
  if (Array.isArray(t)) return t.includes(type);
  return false;
}

function nonEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/**
 * Shopping agents (ChatGPT shopping, Google, Perplexity) read schema.org Product
 * markup on the product page. A GTIN is the single strongest identifier for
 * matching an item across the web.
 */
export const structuredDataCheck: Check = {
  id: "structured-data",
  title: "Product structured data (schema.org)",
  why: "Shopping agents match products across the web by GTIN and read price and availability from schema.org markup.",
  max: 15,
  async run({ http }) {
    const findings: Finding[] = [];

    const list = await http.get("/wp-json/wc/store/v1/products?per_page=1");
    const products = parseJson<Array<{ permalink?: string; name?: string }>>(list.text);
    const permalink = Array.isArray(products) ? products[0]?.permalink : undefined;

    if (!permalink) {
      findings.push({ severity: "error", message: "No product permalink available to inspect." });
      return { status: "skip", score: 0, findings };
    }

    const page = await http.get(permalink);
    if (!page.ok) {
      findings.push({
        severity: "error",
        message: `Product page returned HTTP ${page.status || "error"} (${page.error ?? "no body"}).`,
        fix: "Product pages must be publicly reachable by non-browser clients. Check bot protection rules.",
      });
      return { status: "fail", score: 0, findings };
    }

    const nodes = extractJsonLd(page.text);
    const product = nodes.find((n) => hasType(n, "Product"));

    if (!product) {
      findings.push({
        severity: "error",
        message: `No schema.org Product JSON-LD found on ${permalink}.`,
        fix: "Enable product schema output (WooCommerce core, Yoast WooCommerce SEO or Rank Math) and make sure the theme prints it.",
      });
      return { status: "fail", score: 0, findings };
    }

    let score = 4;
    findings.push({ severity: "info", message: "schema.org Product markup present." });

    const field = (keys: string[], pts: number, label: string, fix: string) => {
      const present = keys.some((k) => nonEmpty(product[k]));
      if (present) {
        score += pts;
        findings.push({ severity: "info", message: `${label}: present.` });
      } else {
        findings.push({ severity: pts >= 3 ? "error" : "warning", message: `${label}: missing.`, fix });
      }
    };

    field(["gtin", "gtin8", "gtin12", "gtin13", "gtin14", "isbn", "mpn"], 4, "GTIN / MPN",
      "Fill the GTIN field (WooCommerce 9.2+: Inventory > GTIN, UPC, EAN or ISBN) and make sure your SEO plugin outputs it.");
    field(["sku"], 2, "SKU in markup", "Expose the SKU in the Product schema.");
    field(["brand"], 1, "Brand", "Set a brand and output it as schema.org Brand.");
    field(["image"], 1, "Image", "Add a product image to the schema.");

    const offers = product["offers"];
    const offer = Array.isArray(offers) ? (offers[0] as JsonLdNode | undefined) : (offers as JsonLdNode | undefined);
    if (offer && typeof offer === "object") {
      const price = nonEmpty(offer["price"]) || nonEmpty(offer["lowPrice"]);
      const currency = nonEmpty(offer["priceCurrency"]);
      const availability = nonEmpty(offer["availability"]);
      if (price && currency) {
        score += 2;
        findings.push({ severity: "info", message: "Offer price and currency: present." });
      } else {
        findings.push({ severity: "error", message: "Offer price or currency missing.", fix: "Output offers.price and offers.priceCurrency." });
      }
      if (availability) {
        score += 1;
        findings.push({ severity: "info", message: "Offer availability: present." });
      } else {
        findings.push({ severity: "warning", message: "Offer availability missing.", fix: "Output offers.availability (schema.org/InStock etc.)." });
      }
    } else {
      findings.push({ severity: "error", message: "No Offer in Product schema.", fix: "Output an Offer with price, priceCurrency and availability." });
    }

    const status = score >= 12 ? "pass" : score >= 7 ? "warn" : "fail";
    return { status, score: Math.min(score, 15), findings };
  },
};
