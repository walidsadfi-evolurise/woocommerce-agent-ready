import type { AuditReport, CheckResult } from "../types.js";

/** Strip C0/C1 control characters and ANSI escapes from store-controlled strings. */
export function sanitize(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
}

let useColor = false;
const c = (code: string) => (s: string) => (useColor ? `\u001b[${code}m${s}\u001b[0m` : s);
const bold = c("1");
const dim = c("2");
const green = c("32");
const yellow = c("33");
const red = c("31");
const cyan = c("36");

const icon = (status: CheckResult["status"]): string =>
  ({ pass: green("PASS"), warn: yellow("WARN"), fail: red("FAIL"), skip: dim("SKIP") })[status];

export function renderTerminal(report: AuditReport, opts: { verbose?: boolean; color?: boolean } = {}): string {
  useColor = opts.color ?? (Boolean(process.stdout.isTTY) && process.env["NO_COLOR"] === undefined);
  const lines: string[] = [];
  const pct = Math.round((report.score / report.max) * 100);
  const gradeColor = pct >= 70 ? green : pct >= 40 ? yellow : red;

  lines.push("");
  lines.push(bold(`WooCommerce agent-readiness audit`) + dim(`  v${report.toolVersion}`));
  lines.push(dim(sanitize(report.baseUrl)));
  lines.push("");
  lines.push(`${bold("Score")}  ${gradeColor(bold(`${report.score}/${report.max}`))}  grade ${gradeColor(bold(report.grade))}`);
  lines.push("");

  for (const check of report.checks) {
    lines.push(`${icon(check.status)}  ${bold(check.title)}  ${dim(`${check.score}/${check.max}`)}`);
    const shown = opts.verbose ? check.findings : check.findings.filter((f) => f.severity !== "info");
    for (const f of shown) {
      const mark = f.severity === "error" ? red("x") : f.severity === "warning" ? yellow("!") : dim("-");
      lines.push(`     ${mark} ${sanitize(f.message)}`);
      if (f.fix) lines.push(`       ${cyan("fix:")} ${sanitize(f.fix)}`);
    }
  }

  lines.push("");
  lines.push(dim(`Audited in ${(report.durationMs / 1000).toFixed(1)} s at ${report.auditedAt}`));
  lines.push("");
  return lines.join("\n");
}
