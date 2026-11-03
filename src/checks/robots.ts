import type { Check, Finding } from "../types.js";

/** Crawlers operated by the main AI shopping and answer engines (late 2026). */
export const AI_AGENTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Amazonbot",
  "Applebot-Extended",
] as const;

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

/** Return the most specific group applying to `agent` (exact match beats `*`). */
function groupFor(groups: RobotsGroup[], agent: string): RobotsGroup | undefined {
  const lower = agent.toLowerCase();
  return groups.find((g) => g.agents.includes(lower)) ?? groups.find((g) => g.agents.includes("*"));
}

function blocksEverything(group: RobotsGroup | undefined): boolean {
  if (!group) return false;
  return group.disallow.some((d) => d === "/") && !group.allow.some((a) => a === "/");
}

function blocksPath(group: RobotsGroup | undefined, path: string): boolean {
  if (!group) return false;
  const disallowed = group.disallow.some((d) => d !== "" && path.startsWith(d.replace(/\*$/, "")));
  const allowed = group.allow.some((a) => a !== "" && path.startsWith(a.replace(/\*$/, "")));
  return disallowed && !allowed;
}

/**
 * A store can be perfect and still invisible if robots.txt tells AI crawlers to
 * stay out. Many security plugins ship such rules by default.
 */
export const robotsCheck: Check = {
  id: "robots",
  title: "robots.txt open to AI agents",
  why: "AI shopping engines respect robots.txt. A blanket block removes the store from every agent-driven search.",
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
      findings.push({ severity: "warning", message: `robots.txt returned HTTP ${res.status || "error"}; treated as absent.` });
      return { status: "warn", score: 8, findings };
    }

    const groups = parseRobots(res.text);
    let score = 10;

    const star = groups.find((g) => g.agents.includes("*"));
    if (blocksEverything(star)) {
      findings.push({
        severity: "error",
        message: "robots.txt disallows everything for all user agents.",
        fix: "Remove `Disallow: /` for `*` or add explicit Allow rules for product pages and /wp-json/wc/store.",
      });
      return { status: "fail", score: 0, findings };
    }

    const blockedAgents = AI_AGENTS.filter((a) => blocksEverything(groupFor(groups, a)));
    if (blockedAgents.length > 0) {
      const penalty = Math.min(8, blockedAgents.length * 2);
      score -= penalty;
      findings.push({
        severity: blockedAgents.length >= 3 ? "error" : "warning",
        message: `AI crawlers fully blocked: ${blockedAgents.join(", ")}.`,
        fix: "Decide deliberately. Blocking training bots (GPTBot, Google-Extended) is a policy choice; blocking shopping agents (OAI-SearchBot, ChatGPT-User, Claude-User, Perplexity-User) removes you from agent-driven purchases.",
      });
    } else {
      findings.push({ severity: "info", message: "No AI crawler is fully blocked." });
    }

    if (blocksPath(star, "/wp-json/")) {
      score -= 2;
      findings.push({
        severity: "warning",
        message: "/wp-json/ is disallowed for `*`.",
        fix: "Allow /wp-json/wc/store/ explicitly so agents can use the Store API.",
      });
    }

    const status = score >= 8 ? "pass" : score >= 5 ? "warn" : "fail";
    return { status, score: Math.max(0, score), findings };
  },
};
