import { looksLikeHtml } from "../http.js";
import type { Check, Finding } from "../types.js";

/**
 * Crawlers that index content for AI search and shopping surfaces. These do
 * honour robots.txt, so blocking them removes the store from the index.
 */
export const AI_SEARCH_CRAWLERS = ["OAI-SearchBot", "ClaudeBot", "PerplexityBot", "Amazonbot", "Bingbot"] as const;

/**
 * User-initiated fetchers: the agent fetches a page because a person asked
 * about it. Their operators state that robots.txt is generally not applied
 * to these fetches, so a rule here is mostly a statement of intent.
 */
export const AI_USER_FETCHERS = ["ChatGPT-User", "Claude-User", "Perplexity-User"] as const;

/**
 * Tokens that control whether an existing crawler's data may be used for
 * model training. Blocking them does not remove a store from search or
 * shopping results.
 */
export const AI_TRAINING_TOKENS = ["GPTBot", "Google-Extended", "Applebot-Extended"] as const;

interface RobotsGroup {
  agents: string[];
  disallow: string[];
  allow: string[];
}

/** Parse robots.txt into user-agent groups. Comments and unknown directives are ignored. */
export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], disallow: [], allow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "disallow") current.disallow.push(value);
    if (key === "allow") current.allow.push(value);
  }
  return groups;
}

/** The most specific group applying to `agent` (exact match beats `*`). */
export function groupFor(groups: RobotsGroup[], agent: string): RobotsGroup | undefined {
  const lower = agent.toLowerCase();
  return groups.find((g) => g.agents.includes(lower)) ?? groups.find((g) => g.agents.includes("*"));
}

/** Longest-match rule evaluation, as Google and Bing implement it. */
export function isAllowed(group: RobotsGroup | undefined, path: string): boolean {
  if (!group) return true;
  const matchLen = (rule: string): number => {
    if (rule === "") return -1;
    const prefix = rule.endsWith("*") ? rule.slice(0, -1) : rule;
    const anchored = rule.endsWith("$");
    const body = anchored ? rule.slice(0, -1) : prefix;
    if (anchored ? path === body : path.startsWith(body)) return body.length;
    return -1;
  };
  const bestAllow = Math.max(-1, ...group.allow.map(matchLen));
  const bestDisallow = Math.max(-1, ...group.disallow.map(matchLen));
  if (bestDisallow === -1) return true;
  return bestAllow >= bestDisallow;
}

/** Paths an agent must reach to find and buy a product. */
const AGENT_PATHS = ["/", "/product/", "/wp-json/wc/store/v1/products", "/wp-json/wc/store/v1/cart"] as const;

/**
 * A store can be perfect and still invisible if robots.txt tells AI crawlers
 * to stay out, whether on purpose or because a template did it.
 */
export const robotsCheck: Check = {
  id: "robots",
  title: "robots.txt open to AI agents",
  why: "AI search and shopping crawlers honour robots.txt. A blanket block removes the store from every agent-driven search.",
  max: 10,
  async run({ http }) {
    const findings: Finding[] = [];
    const res = await http.get("/robots.txt");

    if (res.error) {
      findings.push({ severity: "error", message: `Could not fetch robots.txt: ${res.error}.` });
      return { status: "skip", score: 0, findings };
    }
    if (res.status === 404 || (res.ok && res.text.trim().length === 0)) {
      findings.push({ severity: "info", message: "No robots.txt (or empty): nothing is blocked." });
      return { status: "pass", score: 10, findings };
    }
    if (!res.ok) {
      findings.push({ severity: "warning", message: `robots.txt returned HTTP ${res.status}; treated as absent.` });
      return { status: "warn", score: 8, findings };
    }
    if (looksLikeHtml(res.text) || /text\/html/i.test(res.headers.get("content-type") ?? "")) {
      findings.push({
        severity: "warning",
        message: "/robots.txt returns an HTML page instead of a robots file. Crawlers treat it as unparseable.",
        fix: "Serve a real text/plain robots.txt; a CDN or SPA fallback is answering for it.",
      });
      return { status: "warn", score: 7, findings };
    }

    const groups = parseRobots(res.text);
    let score = 10;

    const star = groupFor(groups, "*");
    const blockedForAll = AGENT_PATHS.filter((p) => !isAllowed(star, p));
    if (blockedForAll.includes("/") && blockedForAll.includes("/product/")) {
      findings.push({
        severity: "error",
        message: "robots.txt disallows the whole site for all user agents.",
        fix: "Remove `Disallow: /` for `*`, or add `Allow: /product/` and `Allow: /wp-json/wc/store/` so agents can reach products and the Store API.",
      });
      return { status: "fail", score: 0, findings };
    }

    // What matters is reaching product pages; a closed homepage with open products still converts.
    const blockedCrawlers = AI_SEARCH_CRAWLERS.filter((a) => !isAllowed(groupFor(groups, a), "/product/"));
    if (blockedCrawlers.length > 0) {
      score -= Math.min(8, blockedCrawlers.length * 2);
      findings.push({
        severity: blockedCrawlers.length >= 3 ? "error" : "warning",
        message: `AI search crawlers blocked from products: ${blockedCrawlers.join(", ")}.`,
        fix: "These crawlers feed AI search and shopping answers. Allow at least `/product/` and `/wp-json/wc/store/` for them.",
      });
    } else {
      findings.push({ severity: "info", message: "No AI search crawler is blocked from product pages." });
    }

    const blockedFetchers = AI_USER_FETCHERS.filter((a) => !isAllowed(groupFor(groups, a), "/product/"));
    if (blockedFetchers.length > 0) {
      findings.push({
        severity: "info",
        message: `User-initiated fetchers listed as blocked: ${blockedFetchers.join(", ")}. Their operators state these fetches generally do not apply robots.txt, so this rule has little effect.`,
      });
    }

    const blockedTraining = AI_TRAINING_TOKENS.filter((a) => !isAllowed(groupFor(groups, a), "/"));
    if (blockedTraining.length > 0) {
      findings.push({
        severity: "info",
        message: `Training opt-outs in place: ${blockedTraining.join(", ")}. This is a policy choice and does not affect agent search or purchases.`,
      });
    }

    const storeApiBlocked = !isAllowed(star, "/wp-json/wc/store/v1/products");
    if (storeApiBlocked) {
      score -= 2;
      findings.push({
        severity: "warning",
        message: "The Store API path is disallowed for `*`.",
        fix: "Add `Allow: /wp-json/wc/store/` so agents can use the Store API even if the rest of /wp-json/ stays blocked.",
      });
    }

    const status = score >= 8 ? "pass" : score >= 5 ? "warn" : "fail";
    return { status, score: Math.max(0, score), findings };
  },
};
