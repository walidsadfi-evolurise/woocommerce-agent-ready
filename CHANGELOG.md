# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-04

### Added

- Seven read-only checks: Store API, product data completeness, product
  structured data, robots.txt, MCP detection, headless cart foundation, latency.
- Score out of 100 with grade and a fix for every finding.
- Terminal, JSON and self-contained HTML reports.
- `--min-score` exit code for CI gates.
- Library export (`runAudit`, `renderHtml`, `renderTerminal`).
- Test suite with a configurable in-process mock store and unit tests for the pure helpers.
- Control probe in the MCP check so authentication walls do not count as MCP servers.
