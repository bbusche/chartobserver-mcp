# Changelog

## 0.2.0 — 2026-06-12

Hardening & trust release. No breaking changes for users — configuration and
tool surface are unchanged.

### Security

- **Webhook credential can no longer appear in tool output.** API errors now
  carry a sanitized request label (e.g. `POST /transaction`) instead of the
  raw URL path, and all error text returned to the agent passes through a
  central secret-redaction backstop. Regression-tested.
- **Live trades now run the same validation as dry runs.** Previously,
  `place_trade` with `dry_run: false` skipped the positive-count,
  percentage-buy, sufficient-funds, and oversell checks. Execution now refuses
  any trade the dry run would flag, without calling the API.
- **Config validation at startup**: numeric UID, minimum webhook-ID length,
  `https:`-only API base. Clear, secret-free failure messages.
- An absent `dry_run` flag is treated as a dry run even if schema defaults are
  bypassed (defense-in-depth).

### Reliability

- Per-request timeout (default 15 s, override with `CHARTOBSERVER_TIMEOUT_MS`)
  so a hung backend can no longer wedge the MCP client.
- Reads (GET) retry once on HTTP 429, honoring `Retry-After`. Trade execution
  is **never** auto-retried.
- Trade execution sends a UUID `Idempotency-Key` header (forward-compat for
  backend deduplication).

### Trust & transparency

- All tools carry MCP annotations: read tools are `readOnlyHint`, and
  `place_trade` is explicitly `destructiveHint` / non-idempotent.
- `SECURITY.md` with a full egress/data-flow disclosure and vulnerability
  reporting process.
- Source published at https://github.com/bbusche/chartobserver-mcp;
  `repository`/`homepage`/`bugs` metadata added; releases published from CI
  with npm provenance.

## 0.1.0 — 2026-06-09

Initial public release: read tools (profile, balance, positions, trades,
leaderboard, prices, portfolio summary) and `place_trade` with dry-run
default.
