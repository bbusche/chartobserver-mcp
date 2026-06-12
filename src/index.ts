#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, PACKAGE_VERSION } from "./config.js";
import { ChartObserverClient } from "./api-client.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { registerSecret, redactSecrets } from "./redact.js";
import { registerAccountTools } from "./tools/account.js";
import { registerTradingTools } from "./tools/trading.js";
import { registerMarketTools } from "./tools/market.js";
import { registerPortfolioTools } from "./tools/portfolio.js";

async function main(): Promise<void> {
  const config = loadConfig();
  registerSecret(config.webhookId);
  const client = new ChartObserverClient(config);

  const server = new McpServer(
    {
      name: "chartobserver",
      version: PACKAGE_VERSION,
    },
    { instructions: SERVER_INSTRUCTIONS },
  );

  registerAccountTools(server, client);
  registerTradingTools(server, client);
  registerMarketTools(server, client);
  registerPortfolioTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // Stdio MCP uses stdout for protocol; errors must go to stderr.
  process.stderr.write(
    redactSecrets(`chartobserver-mcp fatal: ${err?.stack ?? err}\n`),
  );
  process.exit(1);
});
