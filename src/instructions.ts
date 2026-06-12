/**
 * Server-level instructions surfaced to the AI agent at MCP initialization.
 * This is the agent-visible counterpart of the README: it must carry any fact
 * the model needs to relay to the user, because the agent never sees npm or
 * website documentation.
 */
export const SERVER_INSTRUCTIONS = [
  "ChartObserver is a crypto paper-trading platform (https://chart.observer).",
  "This server requires an EXISTING chart.observer account — accounts cannot",
  "be created through this server or by any agent (signup is CAPTCHA-protected",
  "and must be done by the user in a browser at https://chart.observer).",
  "If the configured credentials are missing or invalid, tell the user to:",
  "(1) create an account at https://chart.observer in their browser, then",
  "(2) copy their webhook ID, UID, and username from",
  "https://chart.observer/integrations/mcp into this server's environment",
  "variables (see the package",
  "README). All trading is simulated paper trading — no real funds move — but",
  "trades do affect the user's public leaderboard standing, so always confirm",
  "with the user before executing a trade (place_trade defaults to dry_run).",
].join(" ");
