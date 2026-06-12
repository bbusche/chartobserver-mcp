# Security

## What this server sends and where

This package makes outbound HTTPS requests to **exactly one host**: the
configured `CHARTOBSERVER_API_BASE` (default:
`https://g2uyqqluc4.execute-api.us-east-2.amazonaws.com/dev`, the ChartObserver
production API on AWS API Gateway). There is no other network egress of any
kind.

What it transmits to that host:

- your ChartObserver **UID** and **username** (to scope reads to your account)
- your **webhook credential** (as authentication on trade execution)
- the **trade parameters** the AI agent supplies (pair, action, count)
- a `User-Agent`/`X-Client` header identifying this package and version, and a
  random `Idempotency-Key` UUID on trade execution

What it never does:

- **No telemetry, analytics, or usage beacons.** Nothing is collected.
- **No other hosts** are contacted, ever.
- **No filesystem reads or writes** beyond what the MCP SDK requires for
  stdio transport.
- **No code fetched or evaluated at runtime**, no `postinstall`/`preinstall`
  scripts, no obfuscated output — the published `dist/` is readable compiled
  TypeScript, and the source is at
  https://github.com/bbusche/chartobserver-mcp.

## The webhook credential

`CHARTOBSERVER_WEBHOOK_ID` is a **trade-capable bearer secret** — anyone who
has it can place paper trades on your account (affecting your leaderboard
standing and visible portfolio, not real funds). Treat it like a password:

- Don't paste it into chats, screenshots, issues, or logs.
- This server sanitizes its error output and redacts the credential from any
  text returned to the AI agent, as defense-in-depth.
- If you suspect it leaked, regenerate it from your ChartObserver account
  settings (Settings → API & Integrations) — the old value stops working
  immediately.

## Reporting a vulnerability

Please report suspected vulnerabilities privately via GitHub's
[private vulnerability reporting](https://github.com/bbusche/chartobserver-mcp/security/advisories/new)
on this repository. Do not open a public issue for security reports. We aim to
acknowledge reports within 72 hours.
