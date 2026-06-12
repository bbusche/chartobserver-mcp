import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ChartObserverClient } from "../api-client.js";
import { registerTradingTools } from "../tools/trading.js";
import { registerAccountTools } from "../tools/account.js";
import { registerMarketTools } from "../tools/market.js";
import { registerPortfolioTools } from "../tools/portfolio.js";
import { registerSecret, clearSecrets } from "../redact.js";
import type { Config } from "../config.js";
import type { ToolResult } from "../tools/util.js";

const WEBHOOK = "wh_test_secret_abc123";

const testConfig: Config = {
  apiBase: "https://api.example.test",
  webhookId: WEBHOOK,
  uid: "1700000000000",
  username: "alice",
  userAgent: "chartobserver-mcp/test",
  timeoutMs: 15_000,
};

interface RegisteredTool {
  config: { annotations?: Record<string, boolean> };
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

function makeServer() {
  const tools: Record<string, RegisteredTool> = {};
  const server = {
    registerTool: (name: string, config: unknown, handler: unknown) => {
      tools[name] = { config, handler } as RegisteredTool;
    },
  } as unknown as McpServer;
  return { server, tools };
}

function jsonResponse(status: number, body: string | object) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () =>
      typeof body === "string" ? body : JSON.stringify(body),
    headers: { get: () => null },
  };
}

/** Mock API: BTCUSD at $100, $1000 balance, optional open positions. */
function makeClient(opts: {
  balance?: number;
  positions?: object[];
  tradeStatus?: number;
  tradeBody?: string | object;
} = {}) {
  const tradeCalls: Array<{ url: string; init?: any }> = [];
  const fetchFn = vi.fn(async (url: string, init?: any) => {
    if (url.includes("/token/price/"))
      return jsonResponse(200, { data: { amount: 100 } });
    if (url.includes("/users/balance/"))
      return jsonResponse(200, [{ usdBalance: opts.balance ?? 1000 }]);
    if (url.includes("/positions/open/"))
      return jsonResponse(200, opts.positions ?? []);
    if (url.includes("/transaction/")) {
      tradeCalls.push({ url, init });
      return jsonResponse(
        opts.tradeStatus ?? 200,
        opts.tradeBody ?? { message: "Data successfully added" },
      );
    }
    return jsonResponse(404, "not found");
  });
  const client = new ChartObserverClient(testConfig, fetchFn as any);
  return { client, tradeCalls };
}

const BTC_POSITION = {
  isOpen: true,
  tokenPair: "BTCUSD",
  amount: 2,
  txnPrice: 50,
};

function text(result: ToolResult): string {
  return result.content.map((c) => c.text).join("\n");
}

beforeEach(() => registerSecret(WEBHOOK));
afterEach(() => clearSecrets());

describe("tool annotations", () => {
  it("marks place_trade destructive and non-idempotent", () => {
    const { server, tools } = makeServer();
    registerTradingTools(server, makeClient().client);
    const a = tools.place_trade.config.annotations!;
    expect(a.readOnlyHint).toBe(false);
    expect(a.destructiveHint).toBe(true);
    expect(a.idempotentHint).toBe(false);
    expect(a.openWorldHint).toBe(true);
  });

  it("marks every read tool read-only and open-world", () => {
    const { server, tools } = makeServer();
    const { client } = makeClient();
    registerTradingTools(server, client);
    registerAccountTools(server, client);
    registerMarketTools(server, client);
    registerPortfolioTools(server, client);
    const readTools = Object.keys(tools).filter((t) => t !== "place_trade");
    expect(readTools.length).toBe(9);
    for (const name of readTools) {
      const a = tools[name].config.annotations!;
      expect(a.readOnlyHint, name).toBe(true);
      expect(a.openWorldHint, name).toBe(true);
    }
  });
});

describe("place_trade dry-run safety", () => {
  it("treats an absent dry_run flag as a dry run (defense-in-depth)", async () => {
    const { server, tools } = makeServer();
    const { client, tradeCalls } = makeClient();
    registerTradingTools(server, client);
    const result = await tools.place_trade.handler({
      tokenpair: "BTCUSD",
      action: "buy",
      count: 1,
    });
    expect(tradeCalls).toHaveLength(0);
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain('"dry_run": true');
  });

  it("dry-run buy reports projected impact without executing", async () => {
    const { server, tools } = makeServer();
    const { client, tradeCalls } = makeClient({ balance: 1000 });
    registerTradingTools(server, client);
    const result = await tools.place_trade.handler({
      tokenpair: "BTCUSD",
      action: "buy",
      count: 2,
      dry_run: true,
    });
    expect(tradeCalls).toHaveLength(0);
    const payload = JSON.parse(text(result));
    expect(payload.estimatedCost).toBe(200);
    expect(payload.projectedBalance).toBe(800);
    expect(payload.wouldSucceed).toBe(true);
  });

  it("dry-run flags insufficient funds", async () => {
    const { server, tools } = makeServer();
    const { client } = makeClient({ balance: 50 });
    registerTradingTools(server, client);
    const result = await tools.place_trade.handler({
      tokenpair: "BTCUSD",
      action: "buy",
      count: 2,
      dry_run: true,
    });
    const payload = JSON.parse(text(result));
    expect(payload.wouldSucceed).toBe(false);
    expect(payload.note).toMatch(/Insufficient funds/);
  });
});

describe("place_trade live execution validation", () => {
  const invalidInputs: Array<{ name: string; args: Record<string, unknown> }> =
    [
      {
        name: "percentage buy",
        args: { tokenpair: "BTCUSD", action: "buy", count: "50%" },
      },
      {
        name: "negative count",
        args: { tokenpair: "BTCUSD", action: "buy", count: -1 },
      },
      {
        name: "non-numeric count",
        args: { tokenpair: "BTCUSD", action: "sell", count: "lots" },
      },
      {
        name: "zero-quantity sell",
        args: { tokenpair: "BTCUSD", action: "sell", count: "0" },
      },
    ];

  for (const { name, args } of invalidInputs) {
    it(`rejects ${name} without calling the API`, async () => {
      const { server, tools } = makeServer();
      const { client, tradeCalls } = makeClient({
        positions: [BTC_POSITION],
      });
      registerTradingTools(server, client);
      const result = await tools.place_trade.handler({
        ...args,
        dry_run: false,
      });
      expect(result.isError).toBe(true);
      expect(tradeCalls).toHaveLength(0);
    });
  }

  it("refuses an insufficient-funds buy without calling the API", async () => {
    const { server, tools } = makeServer();
    const { client, tradeCalls } = makeClient({ balance: 50 });
    registerTradingTools(server, client);
    const result = await tools.place_trade.handler({
      tokenpair: "BTCUSD",
      action: "buy",
      count: 2,
      dry_run: false,
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/Insufficient funds/);
    expect(tradeCalls).toHaveLength(0);
  });

  it("refuses an oversell without calling the API", async () => {
    const { server, tools } = makeServer();
    const { client, tradeCalls } = makeClient({ positions: [BTC_POSITION] });
    registerTradingTools(server, client);
    const result = await tools.place_trade.handler({
      tokenpair: "BTCUSD",
      action: "sell",
      count: 10,
      dry_run: false,
    });
    expect(result.isError).toBe(true);
    expect(tradeCalls).toHaveLength(0);
  });

  it("refuses selling a token with no open position", async () => {
    const { server, tools } = makeServer();
    const { client, tradeCalls } = makeClient({ positions: [] });
    registerTradingTools(server, client);
    const result = await tools.place_trade.handler({
      tokenpair: "BTCUSD",
      action: "sell",
      count: 1,
      dry_run: false,
    });
    expect(result.isError).toBe(true);
    expect(tradeCalls).toHaveLength(0);
  });

  it("executes a valid live buy with the normalized count", async () => {
    const { server, tools } = makeServer();
    const { client, tradeCalls } = makeClient({ balance: 1000 });
    registerTradingTools(server, client);
    const result = await tools.place_trade.handler({
      tokenpair: "btcusd",
      action: "buy",
      count: 2,
      dry_run: false,
    });
    expect(result.isError).toBeFalsy();
    expect(tradeCalls).toHaveLength(1);
    const body = JSON.parse(tradeCalls[0].init.body);
    expect(body.tokenpair).toBe("BTCUSD");
    expect(body.count).toBe("2");
    expect(tradeCalls[0].init.headers["Idempotency-Key"]).toBeTruthy();
  });

  it("passes percentage sells through in backend-native form", async () => {
    const { server, tools } = makeServer();
    const { client, tradeCalls } = makeClient({ positions: [BTC_POSITION] });
    registerTradingTools(server, client);
    const result = await tools.place_trade.handler({
      tokenpair: "BTCUSD",
      action: "sell",
      count: "100%",
      dry_run: false,
    });
    expect(result.isError).toBeFalsy();
    expect(tradeCalls).toHaveLength(1);
    const body = JSON.parse(tradeCalls[0].init.body);
    expect(body.count).toBe("100%");
  });
});

describe("secret hygiene", () => {
  it("a failing live trade never leaks the webhook ID into tool output", async () => {
    const { server, tools } = makeServer();
    // Worst case: the backend echoes the full request path in its error body.
    const { client, tradeCalls } = makeClient({
      balance: 1000,
      tradeStatus: 500,
      tradeBody: `Internal error handling /transaction/${WEBHOOK}`,
    });
    registerTradingTools(server, client);
    const result = await tools.place_trade.handler({
      tokenpair: "BTCUSD",
      action: "buy",
      count: 1,
      dry_run: false,
    });
    expect(tradeCalls).toHaveLength(1);
    expect(result.isError).toBe(true);
    expect(text(result)).not.toContain(WEBHOOK);
    expect(text(result)).toContain("POST /transaction");
  });

  it("read-tool failures never leak the webhook ID", async () => {
    const { server, tools } = makeServer();
    const fetchFn = vi.fn(async () =>
      jsonResponse(500, `boom ${WEBHOOK} boom`),
    );
    const client = new ChartObserverClient(testConfig, fetchFn as any);
    registerTradingTools(server, client);
    const result = await tools.get_balance.handler({});
    expect(result.isError).toBe(true);
    expect(text(result)).not.toContain(WEBHOOK);
  });
});
