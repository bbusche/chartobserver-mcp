import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ChartObserverClient, Transaction } from "../api-client.js";
import { ok, fail, READ_TOOL_ANNOTATIONS } from "./util.js";

interface PositionSummary {
  tokenPair: string;
  totalAmount: number;
  avgCostBasis: number;
}

function groupOpenPositions(positions: Transaction[]): PositionSummary[] {
  const grouped: Record<string, { amount: number; cost: number }> = {};
  for (const p of positions) {
    if (!p.isOpen) continue;
    const amt = Number(p.amount);
    const price = Number(p.txnPrice);
    if (!Number.isFinite(amt) || !Number.isFinite(price)) continue;
    if (!grouped[p.tokenPair]) grouped[p.tokenPair] = { amount: 0, cost: 0 };
    grouped[p.tokenPair].amount += amt;
    grouped[p.tokenPair].cost += amt * price;
  }
  return Object.entries(grouped).map(([tokenPair, v]) => ({
    tokenPair,
    totalAmount: v.amount,
    avgCostBasis: v.amount === 0 ? 0 : v.cost / v.amount,
  }));
}

export function registerPortfolioTools(
  server: McpServer,
  client: ChartObserverClient,
): void {
  server.registerTool(
    "get_portfolio_summary",
    {
      title: "Get portfolio summary",
      description:
        "One-call snapshot of the configured user's portfolio: USD balance, open positions grouped by token (with average cost basis), the 5 most recent closed trades, and the user's current leaderboard rank if any. Designed for periodic polling — agents can compare consecutive snapshots to detect changes.",
      annotations: { ...READ_TOOL_ANNOTATIONS },
      inputSchema: {},
    },
    async () => {
      try {
        const [balance, openPositions, closedTrades, leaderboard] =
          await Promise.all([
            client.getBalance(),
            client.getOpenPositions(),
            client.getClosedPositions(),
            client.getLeaderboard().catch(() => null),
          ]);

        const week =
          leaderboard?.["7"] ??
          (leaderboard ? Object.values(leaderboard)[0] : undefined);
        const myEntryIdx =
          week?.topTraders?.findIndex(
            (e) =>
              e.username?.toLowerCase() ===
              client.config.username.toLowerCase(),
          ) ?? -1;

        const grouped = groupOpenPositions(openPositions);
        const recentClosed = closedTrades.slice(0, 5);

        return ok({
          asOf: new Date().toISOString(),
          username: client.config.username,
          uid: client.config.uid,
          usdBalance: balance,
          openPositions: grouped,
          openPositionCount: openPositions.length,
          recentClosedTrades: recentClosed,
          leaderboardRank7d: myEntryIdx === -1 ? null : myEntryIdx + 1,
          leaderboardEntry:
            myEntryIdx === -1
              ? null
              : (week?.topTraders?.[myEntryIdx] ?? null),
        });
      } catch (e) {
        return fail("get_portfolio_summary", e);
      }
    },
  );
}
