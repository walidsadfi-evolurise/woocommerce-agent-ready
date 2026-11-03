#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { Command } from "commander";
import { runAudit } from "./audit.js";
import { renderHtml } from "./report/html.js";
import { renderTerminal } from "./report/terminal.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const program = new Command();

program
  .name("woo-agent-ready")
  .description("Audit a WooCommerce store for agentic commerce readiness.")
  .version(pkg.version)
  .argument("<url>", "store URL, e.g. https://shop.example.com")
  .option("-j, --json [file]", "print the report as JSON (optionally to a file)")
  .option("-H, --html <file>", "write a self-contained HTML report")
  .option("-t, --timeout <ms>", "per-request timeout in milliseconds", "10000")
  .option("-n, --sample <count>", "products to sample for data checks (1-100)", "20")
  .option("-m, --min-score <score>", "exit with code 1 if the score is below this value")
  .option("-v, --verbose", "show informational findings too")
  .option("-q, --quiet", "no terminal report (use with --json/--html)")
  .action(async (url: string, opts) => {
    const timeoutMs = Number(opts.timeout);
    const sampleSize = Math.min(100, Math.max(1, Number(opts.sample)));
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      program.error("--timeout must be a positive number of milliseconds");
    }

    const report = await runAudit({
      baseUrl: url,
      timeoutMs,
      sampleSize,
      ...(opts.verbose ? { log: (line: string) => process.stderr.write(`· ${line}\n`) } : {}),
    }).catch((err: unknown): never => {
      // commander's error() exits the process; the throw satisfies the type checker.
      program.error(`Could not audit ${url}: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    });

    if (!opts.quiet) process.stdout.write(renderTerminal(report, { verbose: Boolean(opts.verbose) }));

    if (opts.json !== undefined) {
      const json = JSON.stringify(report, null, 2);
      if (typeof opts.json === "string") {
        await writeFile(opts.json, json, "utf8");
        if (!opts.quiet) process.stderr.write(`JSON report written to ${opts.json}\n`);
      } else {
        process.stdout.write(json + "\n");
      }
    }

    if (opts.html) {
      await writeFile(opts.html, renderHtml(report), "utf8");
      if (!opts.quiet) process.stderr.write(`HTML report written to ${opts.html}\n`);
    }

    if (opts.minScore !== undefined && report.score < Number(opts.minScore)) {
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 2;
});
