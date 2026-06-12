# `@chartobserver/mcp-server`

An MCP (Model Context Protocol) server that lets an AI agent — Claude Desktop, etc. — read your portfolio, place paper trades, and check the leaderboard on your [ChartObserver](https://chart.observer) account.

ChartObserver is paper trading. This server cannot move real money. It can affect your public leaderboard standing and your visible portfolio.

Source code: https://github.com/bbusche/chartobserver-mcp — see [SECURITY.md](SECURITY.md) for the full egress/data-flow disclosure.

## What this server sends and where

- Outbound HTTPS to **exactly one host**: the configured `CHARTOBSERVER_API_BASE` (default: the ChartObserver production API on AWS API Gateway, `https://g2uyqqluc4.execute-api.us-east-2.amazonaws.com/dev`).
- It transmits your UID, username, your webhook credential (as auth on trade execution), and the trade parameters the agent supplies. Nothing else.
- It reads **no** files, contacts **no** other host, collects **no** telemetry, runs **no** code fetched at runtime, and has **no** install scripts.

## Install

You don't install this package directly. You add it to your MCP client's configuration and it runs on demand via `npx`.

### Claude Desktop

Open your Claude Desktop config file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Add a `chartobserver` entry under `mcpServers`:

```json
{
  "mcpServers": {
    "chartobserver": {
      "command": "npx",
      "args": ["-y", "@chartobserver/mcp-server"],
      "env": {
        "CHARTOBSERVER_WEBHOOK_ID": "your-webhook-id-here",
        "CHARTOBSERVER_UID": "your-uid-here",
        "CHARTOBSERVER_USERNAME": "your-username-here"
      }
    }
  }
}
```

Restart Claude Desktop. The tools become available in any conversation.

### Where to find your credentials

Sign in at https://chart.observer and open **Settings → API & Integrations**. The page shows your webhook ID, UID, and username with copy buttons and a pre-filled config snippet.

(Until that settings page ships, ask Brian for your three values.)

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `CHARTOBSERVER_WEBHOOK_ID` | yes | — | Your per-user webhook secret. Same value TradingView uses to fire trades into your account. Treat like a password. |
| `CHARTOBSERVER_UID` | yes | — | Your numeric user ID. |
| `CHARTOBSERVER_USERNAME` | yes | — | Your public username. |
| `CHARTOBSERVER_API_BASE` | no | `https://g2uyqqluc4.execute-api.us-east-2.amazonaws.com/dev` | API Gateway base URL. Override to point at staging during testing. Must be `https:`. |
| `CHARTOBSERVER_TIMEOUT_MS` | no | `15000` | Per-request timeout in milliseconds (max 120000). |

## Available tools

### Account

| Tool | What it does |
|---|---|
| `get_profile` | Read your public profile and current USD balance. |

### Trading

| Tool | What it does |
|---|---|
| `place_trade` | Place a buy or sell. **Defaults to `dry_run: true`** — returns the projected impact without executing. Set `dry_run: false` only after confirming with the user. |
| `get_balance` | Current USD balance. |
| `get_open_positions` | Open positions, grouped by token pair with average cost basis. |
| `get_closed_trades` | Recent closed trades (completed buy→sell roundtrips). |
| `get_recent_transactions` | Recent raw transactions (open + closed). |

### Market

| Tool | What it does |
|---|---|
| `get_leaderboard` | 7-day rolling leaderboard: top traders by average % profit. |
| `get_my_ranking` | Your position on the leaderboard (or `null` if not ranked). |
| `get_price` | Current price for a crypto pair (e.g. `BTCUSD`). |

### Portfolio

| Tool | What it does |
|---|---|
| `get_portfolio_summary` | One-shot snapshot: balance + open positions + recent closed trades + your leaderboard rank. Designed for periodic polling — compare snapshots to detect changes. |

## Safety model

- **Paper trading only.** Trades affect your simulated portfolio and your leaderboard standing. They do not move real money.
- **`place_trade` defaults to dry-run.** The AI agent must explicitly pass `dry_run: false` to execute. You should be asked for confirmation before that happens.
- **Live trades are validated.** Execution runs the same checks as the dry run (sufficient funds, position size, well-formed quantities) and refuses trades that would fail, without calling the API.
- **Secret redaction.** Error text returned to the agent is sanitized; the webhook credential is redacted as defense-in-depth so it cannot leak into transcripts.
- **Bearer-secret auth.** The webhook ID acts as a bearer token. If it leaks, anyone can act on your account. Don't paste it into screenshots, logs, or chat messages. If you suspect compromise, regenerate it from Settings → API & Integrations.
- **No account creation.** Sign up at https://chart.observer in a browser. Web signup requires a CAPTCHA, which a headless MCP server can't solve.

## What's not in v1

- Real-time push notifications (poll `get_portfolio_summary` instead).
- Per-token rotation, multiple tokens, scoped tokens, expiry — these will come in a later revision that hardens the webhook-ID lifecycle.
- Equities/options/forex — the platform is crypto-only paper trading today.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

To test locally against staging, build then point Claude Desktop at the local file:

```json
{
  "mcpServers": {
    "chartobserver-local": {
      "command": "node",
      "args": ["/absolute/path/to/chartobserver/mcp-server/dist/index.js"],
      "env": {
        "CHARTOBSERVER_API_BASE": "https://g2uyqqluc4.execute-api.us-east-2.amazonaws.com/staging",
        "CHARTOBSERVER_WEBHOOK_ID": "...",
        "CHARTOBSERVER_UID": "...",
        "CHARTOBSERVER_USERNAME": "..."
      }
    }
  }
}
```

## Repo layout

```
src/
  index.ts          # MCP server entry, registers tools
  config.ts         # Loads + validates env vars
  api-client.ts     # HTTP client for ChartObserver API
  redact.ts         # Secret-redaction backstop for all outbound error text
  tools/
    account.ts
    trading.ts
    market.ts
    portfolio.ts
    util.ts
  __tests__/
    api-client.test.ts
    config.test.ts
    trading.test.ts
    redact.test.ts
```
