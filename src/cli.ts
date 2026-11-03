#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { Command, InvalidArgumentError } from "commander";
import { runAudit } from "./audit.js";
import { renderHtml } from "./report/html.js";
import { renderTerminal } from "./report/terminal.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

interface CliOptions {
  json?: string | true;
  html?: string;
  timeout: number;
  sample: number;
  minScore?: number;
  verbose?: boolean;
  quiet?: boolean;
  color?: boolean;
}

function integer(min: number, max: number, label: string) {
  return (raw: string): number => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
      throw new InvalidArgumentError(`${label} must be an integer between ${min} and ${max}.`);
    }
    return n;
  };
}

/** Writing to a closed pipe (`| head`) must not crash with a stack trace. */
function ignoreEpipe(stream: NodeJS.WriteStream): void {
  stream.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") process.exit(process.exitCode ?? 0);
    throw err;
  });
}
ignoreEpipe(process.stdout);
ignoreEpipe(process.stderr);

const program = new Command();

program
  .name("woo-agent-ready")
  .description("Audit a WooCommerce store for agentic commerce readiness.")
  .version(pkg.version)
  .argument("<url>", "store URL, e.g. https://shop.example.com")
  .option("-j, --json [file]", "print the report as JSON to stdout (terminal report goes to stderr), or write it to a file")
  .option("-H, --html <file>", "write a self-contained HTML report")
  .option("-t, --timeout <ms>", "per-request timeout in milliseconds", integer(100, 120_000, "--timeout"), 10_000)
  .option("-n, --sample <count>", "products to sample for data checks", integer(1, 100, "--sample"), 20)
  .option("-m, --min-score <score>", "exit with code 1 if the score is below this value", integer(0, 100, "--min-score"))
  .option("-v, --verbose", "show informational findings too")
  .option("-q, --quiet", "no terminal report (use with --json/--html)")
  .option("--no-color", "disable ANSI colours")
  .action(async (url: string, opts: CliOptions) => {
    const report = await runAudit({
      baseUrl: url,
      timeoutMs: opts.timeout,
      sampleSize: opts.sample,
      ...(opts.verbose ? { log: (line: string) => process.stderr.write(`· ${line}\n`) } : {}),
    }).catch((err: unknown): never => {
      // commander's error() exits the process; the throw satisfies the type checker.
      program.error(`Could not audit ${url}: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    });

    const jsonToStdout = opts.json === true;
    if (!opts.quiet) {
      const text = renderTerminal(report, {
        verbose: Boolean(opts.verbose),
        ...(opts.color === false ? { color: false } : {}),
      });
      // Keep stdout clean for `--json | jq`: the human report moves to stderr.
      (jsonToStdout ? process.stderr : process.stdout).write(text);
    }

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

    if (opts.minScore !== undefined && report.score < opts.minScore) {
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 2;
});
