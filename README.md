# woocommerce-agent-ready

[![CI](https://github.com/walidsadfi-evolurise/woocommerce-agent-ready/actions/workflows/ci.yml/badge.svg)](https://github.com/walidsadfi-evolurise/woocommerce-agent-ready/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**Can AI shopping agents find, compare and buy from your WooCommerce store?**

`woo-agent-ready` audits a store the way an agent sees it: through the public Store API, product structured data, `robots.txt`, MCP, the headless cart and latency. It returns a score out of 100 with a concrete fix for every point lost.

```
$ woo-agent-ready https://shop.example.com

WooCommerce agent-readiness audit  v0.1.0
https://shop.example.com/

Score  72/100  grade B

PASS  Store API reachable  20/20
WARN  Product data completeness  16/25
     x SKU present: only 0% of sampled products.
       fix: Give every product and variation a unique SKU. Agents use it as the primary key across channels.
     x Attributes defined: only 0% of sampled products.
       fix: Define global attributes (size, material, colour, capacity) and assign them. Agents filter on attributes.
WARN  Product structured data (schema.org)  14/20
     x GTIN / MPN: missing.
       fix: Fill the GTIN field (WooCommerce 9.2+: Inventory > GTIN, UPC, EAN or ISBN) and make sure your SEO plugin outputs it.
WARN  robots.txt open to AI agents  6/10
     ! AI search crawlers blocked from products: ClaudeBot, PerplexityBot.
       fix: These crawlers feed AI search and shopping answers. Allow at least `/product/` and `/wp-json/wc/store/` for them.
WARN  MCP server exposed  0/5
     ! No MCP endpoint detected (probed /wp-json/mcp/mcp-adapter-default-server, ...).
       fix: Install the WordPress MCP Adapter plugin to expose WooCommerce abilities to agents over MCP, then give agents an Application Password with the minimum capabilities.
WARN  Headless cart & checkout foundation  6/10
     ! Only a Nonce header is exposed; no Cart-Token. Agents must keep cookies to persist a cart.
     ! Payment methods found (cod, bacs) but none is a known API-first gateway.
       fix: Add WooPayments, Stripe, PayPal Payments or another gateway with a tokenised server-side API.
PASS  API and page latency  10/10
```

*Output produced by the test suite's mock store with SKUs, attributes, GTIN, Cart-Token and an API gateway removed, and two AI crawlers blocked.*

## Why this exists

Agentic commerce arrived faster than most catalogs were ready for it. AI search and shopping agents discover products through structured data and APIs, and protocols such as **MCP** (tools), **ACP** (the Agentic Commerce Protocol from OpenAI and Stripe) and **UCP** (the Universal Commerce Protocol led by Google) define how an agent calls a store and pays. WooCommerce documents MCP through the WordPress MCP Adapter; checkout protocols land through payment gateways. A store that looks fine in a browser can be invisible, un-comparable or un-purchasable for an agent. This tool makes that gap measurable.

## Install

Requires Node.js 20 or newer.

```bash
git clone https://github.com/walidsadfi-evolurise/woocommerce-agent-ready.git
cd woocommerce-agent-ready
npm install && npm run build
node dist/cli.js https://shop.example.com
```

`npx woocommerce-agent-ready` and the `ghcr.io/walidsadfi-evolurise/woocommerce-agent-ready` image become available with the first tagged release (see the Release workflow).

With Docker (the report is written to the mounted directory):

```bash
docker build -t woo-agent-ready .
docker run --rm -v "$PWD:/work" woo-agent-ready https://shop.example.com --html report.html
```

## Usage

```
woo-agent-ready <url> [options]

  -j, --json [file]         JSON report to stdout (terminal report moves to stderr), or to a file
  -H, --html <file>         write a self-contained HTML report
  -t, --timeout <ms>        per-request timeout (default 10000)
  -n, --sample <count>      products to sample for data checks, 1-100 (default 20)
  -m, --min-score <score>   exit 1 if the score is below this value (CI gate)
  -v, --verbose             show informational findings
  -q, --quiet               no terminal output (use with --json/--html)
      --no-color            disable ANSI colours (NO_COLOR is honoured too)
```

Examples:

```bash
# HTML report to send to a client
woo-agent-ready https://shop.example.com --html report.html

# Fail a deployment pipeline if readiness drops under 70
woo-agent-ready https://staging.example.com --min-score 70 --quiet

# Machine-readable output, pipe-safe
woo-agent-ready https://shop.example.com --json | jq .score

# Larger sample on a big catalog
woo-agent-ready https://shop.example.com --sample 100
```

## What is checked

| Check | Points | What agents need |
| --- | --- | --- |
| Store API reachable | 20 | `/wp-json/wc/store/v1/products` answers JSON, exposes `X-WP-Total`, sends CORS headers, responds under 800 ms on a warm connection |
| Product data completeness | 25 | SKU, price, image + alt, long and short descriptions, attributes, category, brand on a sample of products |
| Product structured data | 20 | schema.org `Product` JSON-LD on the product page with GTIN/MPN, SKU, brand, image and an `Offer` (price, currency, availability) |
| robots.txt open to AI agents | 10 | Product pages reachable by AI search crawlers (OAI-SearchBot, ClaudeBot, PerplexityBot, Amazonbot, Bingbot) and the Store API path allowed. Training opt-outs (GPTBot, Google-Extended…) are reported, not penalised: they do not affect search or purchases. |
| MCP server exposed | 5 | WordPress MCP Adapter (`/wp-json/mcp/mcp-adapter-default-server`) detected, with a control probe so sites that answer 401 to every route are not counted |
| Headless cart & checkout | 10 | Store API cart reachable, `Cart-Token` header present, an API-first gateway (WooPayments, Stripe, PayPal Payments, Mollie, Adyen…) available |
| API and page latency | 10 | Median Store API search under 500 ms, product page under 800 ms, three warm samples each |

Grades: **A** ≥ 85, **B** ≥ 70, **C** ≥ 55, **D** ≥ 40, **F** below.

All probes are **public and read-only**. The tool never authenticates, never adds to a cart and never places an order. The only non-GET requests are JSON-RPC `initialize` handshakes used to detect MCP endpoints (plus one to a route that cannot exist, as a control).

MCP weighs 5 points because adoption is still early; a store without it is marked *warn*, not *fail*.

## Use as a library

```ts
import { runAudit, renderHtml } from "woocommerce-agent-ready";

const report = await runAudit({ baseUrl: "https://shop.example.com", sampleSize: 50 });
console.log(report.score, report.grade);
await fs.writeFile("report.html", renderHtml(report));
```

`report.checks[]` carries every finding with its severity and fix, ready to pipe into a ticketing system.

## How scoring works

Each check owns a fixed number of points and scores independently, so a store can be excellent on data and terrible on infrastructure, and the report says so. Thresholds are deliberately strict: they reflect what a shopping agent needs to recommend a product with confidence, not what a human shopper tolerates.

Scores are **indicative**. A GTIN that exists in WooCommerce but is not printed in the page markup counts as missing, because that is what the agent sees.

## Limits

- Detection of MCP is best-effort and unauthenticated. Sites that answer the same status to every REST route (an authentication wall) cannot be assessed and are reported as such.
- The GTIN and Brands fields exist in WooCommerce core since 9.2 and 9.6 respectively; what the audit measures is whether they reach the page markup.
- GTIN is read from page JSON-LD only; the Store API does not expose it.
- Stores behind aggressive bot protection (Cloudflare challenge, Sucuri) fail the first check by design: an agent would be blocked the same way.
- One product page is inspected for structured data. Run with `--verbose` and check the permalink used. A headless storefront on another host is audited at that host, which is what an agent sees.

## Development

```bash
npm install
npm run check        # typecheck + lint + tests
npm run dev -- https://shop.example.com --verbose
```

Tests run against an in-process mock store (`test/mock-store.ts`) whose behaviour is configured per test (missing SKUs, auth walls, robots variants, gateway ids…), so the suite needs no network. Pure functions (`parseRobots`, `isAllowed`, `extractJsonLd`, report escaping) have their own unit tests.

## Roadmap

- `v0.2` ACP readiness: detect Stripe Agentic Commerce support and shared payment tokens
- `v0.2` UCP discovery file check
- `v0.3` Variation-level audit (SKU and GTIN per variation)
- `v0.3` GitHub Action with a readiness badge

Issues and PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT © [Walid Sadfi](https://github.com/walidsadfi-evolurise)

---

### En français

Cet outil audite une boutique WooCommerce telle qu'un agent IA la voit : Store API, données produit, balisage schema.org, `robots.txt`, MCP, panier headless et latence. Il rend un score sur 100 et une correction concrète pour chaque point perdu. Toutes les requêtes sont publiques et en lecture seule.

Vous voulez corriger ce que le rapport remonte ? Je déploie des agents IA dans les boutiques WooCommerce et les outils métier des PME : [profil Malt](https://www.malt.fr/profile/walidsadfi).
