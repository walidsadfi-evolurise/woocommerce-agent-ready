import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A tiny fake WooCommerce store for tests.
 *
 * Every behaviour that the checks look at can be toggled through `MockConfig`,
 * so each test describes a store profile ("perfect", "no SKUs", "blocked
 * robots") rather than hand-writing HTTP responses.
 */
export interface MockConfig {
  storeApi: "ok" | "missing" | "forbidden" | "html";
  products: number;
  withSku: boolean;
  withAttributes: boolean;
  withBrand: boolean;
  withAlt: boolean;
  jsonLd: "full" | "no-gtin" | "none";
  robots: "none" | "open" | "block-all" | "block-ai" | "block-wpjson" | "html" | "block-all-allow-products" | "block-training";
  mcp: "official" | "community" | "legacy-gone" | "none";
  cartToken: boolean;
  paymentMethods: string[];
  /** Artificial delay added to every response, in ms. */
  delayMs: number;
  exposeTotal: boolean;
  /** Echo Access-Control-Allow-Origin when an Origin header is sent (WordPress default). */
  cors: boolean;
  /** Answer 401 to every REST route, like a "require auth for REST" plugin. */
  authWallAll: boolean;
}

export const DEFAULT_MOCK: MockConfig = {
  storeApi: "ok",
  products: 20,
  withSku: true,
  withAttributes: true,
  withBrand: true,
  withAlt: true,
  jsonLd: "full",
  robots: "open",
  mcp: "official",
  cartToken: true,
  paymentMethods: ["stripe", "cod"],
  delayMs: 0,
  exposeTotal: true,
  cors: true,
  authWallAll: false,
};

function product(i: number, cfg: MockConfig, base: string) {
  return {
    id: i,
    name: `Product ${i}`,
    sku: cfg.withSku ? `SKU-${String(i).padStart(4, "0")}` : "",
    permalink: `${base}/product/product-${i}/`,
    description: "<p>" + "A durable, repairable product with full specifications listed. ".repeat(3) + "</p>",
    short_description: "<p>One-sentence pitch that an agent can quote verbatim.</p>",
    images: [{ src: `${base}/wp-content/uploads/p${i}.jpg`, alt: cfg.withAlt ? `Product ${i} front view` : "" }],
    prices: { price: "1999", currency_code: "EUR" },
    is_in_stock: true,
    attributes: cfg.withAttributes ? [{ name: "Colour", terms: [{ name: "Blue" }] }] : [],
    categories: [{ name: "Gadgets" }],
    brands: cfg.withBrand ? [{ name: "Acme" }] : [],
  };
}

function productPage(i: number, cfg: MockConfig): string {
  const ld =
    cfg.jsonLd === "none"
      ? ""
      : `<script type="application/ld+json">${JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Product",
          name: `Product ${i}`,
          sku: `SKU-${String(i).padStart(4, "0")}`,
          ...(cfg.jsonLd === "full" ? { gtin13: "4006381333931" } : {}),
          brand: { "@type": "Brand", name: "Acme" },
          image: "https://example.test/p.jpg",
          offers: { "@type": "Offer", price: "19.99", priceCurrency: "EUR", availability: "https://schema.org/InStock" },
        })}</script>`;
  return `<!doctype html><html><head><title>Product ${i}</title>${ld}</head><body><h1>Product ${i}</h1></body></html>`;
}

function robots(cfg: MockConfig): string | null {
  switch (cfg.robots) {
    case "none":
      return null;
    case "open":
      return "User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n";
    case "block-all":
      return "User-agent: *\nDisallow: /\n";
    case "block-ai":
      return "User-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: PerplexityBot\nDisallow: /\n\nUser-agent: *\nDisallow: /wp-admin/\n";
    case "block-wpjson":
      return "User-agent: *\nDisallow: /wp-json/\n";
    case "html":
      return "<!doctype html><html><body>Not found</body></html>";
    case "block-all-allow-products":
      return "User-agent: *\nDisallow: /\nAllow: /product/\nAllow: /wp-json/wc/store/\n";
    case "block-training":
      return "User-agent: GPTBot\nDisallow: /\n\nUser-agent: Google-Extended\nDisallow: /\n\nUser-agent: ChatGPT-User\nDisallow: /\n\nUser-agent: *\nDisallow: /wp-admin/\n";
  }
}

export interface MockStore {
  url: string;
  config: MockConfig;
  /** Every request path received, in order. */
  requests: string[];
  close(): Promise<void>;
}

export async function startMockStore(overrides: Partial<MockConfig> = {}): Promise<MockStore> {
  const config: MockConfig = { ...DEFAULT_MOCK, ...overrides };
  const requests: string[] = [];
  let base = "";

  const handler = (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", base);
    requests.push(`${req.method} ${url.pathname}${url.search}`);

    const send = (status: number, body: string, headers: Record<string, string> = {}) => {
      const finish = () => {
        res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
        res.end(body);
      };
      if (config.delayMs > 0) setTimeout(finish, config.delayMs);
      else finish();
    };
    const json = (status: number, data: unknown, headers: Record<string, string> = {}) =>
      send(status, JSON.stringify(data), headers);

    const p = url.pathname;

    if (config.authWallAll && p.startsWith("/wp-json")) {
      return json(401, { code: "rest_not_logged_in", message: "You are not currently logged in." });
    }

    if (p === "/wp-json/" || p === "/wp-json") {
      const namespaces = ["wp/v2", "wc/store/v1"];
      if (config.mcp === "official") namespaces.push("mcp");
      return json(200, { namespaces });
    }

    if (p.startsWith("/wp-json/wc/store/v1/products")) {
      if (config.storeApi === "missing") return json(404, { code: "rest_no_route" });
      if (config.storeApi === "forbidden") return json(403, { code: "rest_forbidden" });
      if (config.storeApi === "html") return send(200, "<html>cached page</html>", { "content-type": "text/html" });
      const perPage = Math.min(Number(url.searchParams.get("per_page") ?? "10"), config.products);
      const list = Array.from({ length: perPage }, (_, i) => product(i + 1, config, base));
      const headers: Record<string, string> = {};
      const origin = req.headers["origin"];
      if (config.cors && typeof origin === "string") headers["access-control-allow-origin"] = origin;
      if (config.exposeTotal) headers["x-wp-total"] = String(config.products);
      return json(200, list, headers);
    }

    if (p === "/wp-json/wc/store/v1/cart") {
      const headers: Record<string, string> = { nonce: "abc123" };
      if (config.cartToken) headers["cart-token"] = "eyJ.fake.token";
      return json(200, { items: [], payment_methods: config.paymentMethods, totals: { currency_code: "EUR" } }, headers);
    }

    if (p === "/wp-json/mcp/mcp-adapter-default-server") {
      if (config.mcp === "official") return json(401, { code: "rest_not_logged_in" });
      return json(404, { code: "rest_no_route" });
    }
    if (p.startsWith("/wp-json/mcp/")) return json(404, { code: "rest_no_route" });
    if (p === "/wp-json/woocommerce/mcp") {
      if (config.mcp === "legacy-gone") return json(410, { code: "gone" });
      return json(404, { code: "rest_no_route" });
    }
    if (p === "/wp-json/wp/v2/wpmcp") {
      if (config.mcp === "community") return json(401, { code: "rest_not_logged_in" });
      return json(404, { code: "rest_no_route" });
    }

    if (p === "/robots.txt") {
      const body = robots(config);
      if (body === null) return send(404, "not found", { "content-type": "text/plain" });
      const type = config.robots === "html" ? "text/html" : "text/plain";
      return send(200, body, { "content-type": type });
    }

    const m = /^\/product\/product-(\d+)\/$/.exec(p);
    if (m) return send(200, productPage(Number(m[1]), config), { "content-type": "text/html; charset=utf-8" });

    return json(404, { code: "not_found" });
  };

  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;

  return {
    url: base,
    config,
    requests,
    close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
