# woocommerce-agent-ready

[![CI](https://github.com/walidsadfi-evolurise/woocommerce-agent-ready/actions/workflows/ci.yml/badge.svg)](https://github.com/walidsadfi-evolurise/woocommerce-agent-ready/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/woocommerce-agent-ready)](https://www.npmjs.com/package/woocommerce-agent-ready)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**Can AI shopping agents find, compare and buy from your WooCommerce store?**

`woo-agent-ready` audits a store the way an agent sees it: through the public Store API, product structured data, `robots.txt`, MCP, the headless cart and latency. It returns a score out of 100 with a concrete fix for every point lost.

```
$ npx woocommerce-agent-ready https://shop.example.com

WooCommerce agent-readiness audit  v0.1.0
https://shop.example.com/

Score  41/100  grade D

PASS  Store API reachable  18/20
WARN  Product data completeness  13/25
     ! SKU present: only 35% of sampled products.
       fix: Give every product and variation a unique SKU. Agents use it as the primary key across channels.
     ! Attributes defined: only 20% of sampled products.
       fix: Define global attributes (size, material, colour, capacity) and assign them. Agents filter on attributes.
FAIL  Product structured data (schema.org)  0/15
     x No schema.org Product JSON-LD found on https://shop.example.com/product/blue-kettle/.
       fix: Enable product schema output (WooCommerce core, Yoast WooCommerce SEO or Rank Math) and make sure the theme prints it.
WARN  robots.txt open to AI agents  6/10
     ! AI crawlers fully blocked: OAI-SearchBot, ClaudeBot.
WARN  MCP server exposed  0/10
     ! No MCP endpoint detected ...
PASS  Headless cart & checkout foundation  10/10
FAIL  API and page latency  2/10
     x Store API search: median 2 340 ms over 3 samples.
```

## Why this exists

Agentic commerce arrived faster than most catalogs were ready for it. ChatGPT, Perplexity, Google and Claude-based agents now discover products through structured data and APIs, and protocols such as **MCP** (tools), **ACP** (Stripe/OpenAI checkout) and **UCP** (Shopify/Google) are being wired into WooCommerce. A store that looks fine in a browser can be invisible, un-comparable or un-purchasable for an agent. This tool makes that gap measurable.

## Install

Requires Node.js 20 or newer.

```bash
npx woocommerce-agent-ready https://shop.example.com
# or
npm install -g woocommerce-agent-ready
woo-agent-ready https://shop.example.com
```

With Docker:

```bash
docker run --rm ghcr.io/walidsadfi-evolurise/woocommerce-agent-ready https://shop.example.com
```

## Usage

```
woo-agent-ready <url> [options]

  -j, --json [file]         print the report as JSON (optionally to a file)
  -H, --html <file>         write a self-contained HTML report
  -t, --timeout <ms>        per-request timeout (default 10000)
  -n, --sample <count>      products to sample for data checks, 1-100 (default 20)
  -m, --min-score <score>   exit 1 if the score is below this value (CI gate)
  -v, --verbose             show informational findings
  -q, --quiet               no terminal output (use with --json/--html)
```

Examples:

```bash
# HTML report to send to a client
woo-agent-ready https://shop.example.com --html report.html

# Fail a deployment pipeline if readiness drops under 70
woo-agent-ready https://staging.example.com --min-score 70 --quiet --json

# Larger sample on a big catalog
woo-agent-ready https://shop.example.com --sample 100
```

## What is checked

| Check | Points | What agents need |
| --- | --- | --- |
| Store API reachable | 20 | `/wp-json/wc/store/v1/products` answers JSON, exposes `X-WP-Total`, responds under 800 ms |
| Product data completeness | 25 | SKU, price, image + alt, long and short descriptions, attributes, category, brand on a sample of products |
| Product structured data | 15 | schema.org `Product` JSON-LD on the product page with GTIN/MPN, SKU, brand, image and an `Offer` (price, currency, availability) |
| robots.txt open to AI agents | 10 | No blanket `Disallow: /`; shopping agents (OAI-SearchBot, ChatGPT-User, Claude-User, Perplexity-User…) not blocked; `/wp-json/` allowed |
| MCP server exposed | 10 | WordPress MCP Adapter (`/wp-json/mcp/mcp-adapter-default-server`) or a community server detected |
| Headless cart & checkout | 10 | Store API cart reachable, `Cart-Token` header present, an API-first payment gateway (Stripe, PayPal, Mollie, Adyen…) available |
| API and page latency | 10 | Median Store API search under 500 ms, product page under 800 ms |

Grades: **A** ≥ 85, **B** ≥ 70, **C** ≥ 55, **D** ≥ 40, **F** below.

All probes are **public and read-only**. The tool never authenticates, never adds to a cart and never places an order. The only non-GET requests are JSON-RPC `initialize` handshakes used to detect MCP endpoints.

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

- Detection of MCP is best-effort and unauthenticated: a `401` proves the endpoint exists, a `404` proves it does not.
- GTIN is read from page JSON-LD only; the Store API does not expose it.
- Stores behind aggressive bot protection (Cloudflare challenge, Sucuri) fail the first check by design: an agent would be blocked the same way.
- One product page is inspected for structured data. Run with `--verbose` and check the permalink used.

## Development

```bash
npm install
npm run check        # typecheck + lint + tests
npm run dev -- https://shop.example.com --verbose
```

Tests run against an in-process mock store (`test/mock-store.ts`) whose behaviour is configured per test, so the suite needs no network.

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
