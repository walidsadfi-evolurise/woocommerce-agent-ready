import type { AuditReport, CheckResult } from "../types.js";

const useColor = process.stdout.isTTY && !process.env["NO_COLOR"];
const c = (code: string) => (s: string) => (useColor ? `\u001b[${code}m${s}\u001b[0m` : s);
const bold = c("1");
const dim = c("2");
const green = c("32");
const yellow = c("33");
const red = c("31");
const cyan = c("36");

const ICON: Record<CheckResult["status"], string> = {
  pass: green("PASS"),
  warn: yellow("WARN"),
  fail: red("FAIL"),
  skip: dim("SKIP"),
};

export function renderTerminal(report: AuditReport, opts: { verbose?: boolean } = {}): string {
  const lines: string[] = [];
  const pct = Math.round((report.score / report.max) * 100);
  const gradeColor = pct >= 70 ? green : pct >= 40 ? yellow : red;

  lines.push("");
  lines.push(bold(`WooCommerce agent-readiness audit`) + dim(`  v${report.toolVersion}`));
  lines.push(dim(report.baseUrl));
  lines.push("");
  lines.push(`${bold("Score")}  ${gradeColor(bold(`${report.score}/${report.max}`))}  grade ${gradeColor(bold(report.grade))}`);
  lines.push("");

  for (const check of report.checks) {
    lines.push(`${ICON[check.status]}  ${bold(check.title)}  ${dim(`${check.score}/${check.max}`)}`);
    const shown = opts.verbose ? check.findings : check.findings.filter((f) => f.severity !== "info");
    for (const f of shown) {
      const mark = f.severity === "error" ? red("x") : f.severity === "warning" ? yellow("!") : dim("-");
      lines.push(`     ${mark} ${f.message}`);
      if (f.fix) lines.push(`       ${cyan("fix:")} ${f.fix}`);
    }
  }

  lines.push("");
  lines.push(dim(`Audited in ${(report.durationMs / 1000).toFixed(1)} s at ${report.auditedAt}`));
  lines.push("");
  return lines.join("\n");
}
