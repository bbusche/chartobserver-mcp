import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  ChartObserverClient,
  LeaderboardEntry,
} from "../api-client.js";
import { ok, fail, READ_TOOL_ANNOTATIONS } from "./util.js";

function findUserInLeaderboard(
  entries: LeaderboardEntry[] | undefined,
  username: string,
): { rank: number; entry: LeaderboardEntry } | null {
  if (!entries) return null;
  const idx = entries.findIndex(
    (e) => e.username?.toLowerCase() === username.toLowerCase(),
  );
  if (idx === -1) return null;
  return { rank: idx + 1, entry: entries[idx] };
}

export function registerMarketTools(
  server: McpServer,
  client: ChartObserverClient,
): void {
  server.registerTool(
    "get_leaderboard",
    {
      title: "Get leaderboard",
      description:
        "Fetch the 7-day rolling ChartObserver leaderboard: top traders by average % profit per closed trade, plus the top individual closed trades. Public data.",
      annotations: { ...READ_TOOL_ANNOTATIONS },
      inputSchema: {
        limit: z
          .number()
          .int()
          .positive()
          .max(100)
          .default(25)
          .describe("Maximum number of top-traders rows to return."),
      },
    },
    async ({ limit }) => {
      try {
        const board = await client.getLeaderboard();
        const week = board["7"] ?? Object.values(board)[0];
        const topTraders = (week?.topTraders ?? []).slice(0, limit);
        return ok({
          windowDays: 7,
          topTraders,
          topTradeCount: week?.leaderBoard?.length ?? 0,
        });
      } catch (e) {
        return fail("get_leaderboard", e);
      }
    },
  );

  server.registerTool(
    "get_my_ranking",
    {
      title: "Get my leaderboard rank",
      description:
        "Find the configured user's position on the 7-day leaderboard, if they appear. Returns null rank if not on the board.",
      annotations: { ...READ_TOOL_ANNOTATIONS },
      inputSchema: {},
    },
    async () => {
      try {
        const board = await client.getLeaderboard();
        const week = board["7"] ?? Object.values(board)[0];
        const found = findUserInLeaderboard(
          week?.topTraders,
          client.config.username,
        );
        return ok({
          username: client.config.username,
          rank: found?.rank ?? null,
          entry: found?.entry ?? null,
          totalRanked: week?.topTraders?.length ?? 0,
        });
      } catch (e) {
        return fail("get_my_ranking", e);
      }
    },
  );

  server.registerTool(
    "get_price",
    {
      title: "Get current price",
      description:
        "Fetch the latest USD price for a crypto pair from the ChartObserver price cache.",
      annotations: { ...READ_TOOL_ANNOTATIONS },
      inputSchema: {
        tokenpair: z
          .string()
          .max(20)
          .describe("Pair like BTCUSD, ETHUSD, SOLUSDT (no slash)."),
      },
    },
    async ({ tokenpair }) => {
      try {
        const price = await client.getPrice(tokenpair.toUpperCase());
        return ok({ tokenpair: tokenpair.toUpperCase(), price });
      } catch (e) {
        return fail("get_price", e);
      }
    },
  );
}
