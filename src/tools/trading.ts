import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ChartObserverClient, Transaction } from "../api-client.js";
import { ok, fail, READ_TOOL_ANNOTATIONS } from "./util.js";

const TOKEN_PAIR_PATTERN = /^[A-Za-z0-9]+$/;

function summarizeOpenPositionsByToken(
  positions: Transaction[],
): Record<string, { totalAmount: number; avgCostBasis: number }> {
  const grouped: Record<
    string,
    { totalAmount: number; totalCost: number }
  > = {};
  for (const p of positions) {
    if (!p.isOpen) continue;
    const key = p.tokenPair;
    const amount = Number(p.amount);
    const price = Number(p.txnPrice);
    if (!Number.isFinite(amount) || !Number.isFinite(price)) continue;
    if (!grouped[key]) grouped[key] = { totalAmount: 0, totalCost: 0 };
    grouped[key].totalAmount += amount;
    grouped[key].totalCost += amount * price;
  }
  const out: Record<string, { totalAmount: number; avgCostBasis: number }> = {};
  for (const [k, v] of Object.entries(grouped)) {
    out[k] = {
      totalAmount: v.totalAmount,
      avgCostBasis: v.totalAmount === 0 ? 0 : v.totalCost / v.totalAmount,
    };
  }
  return out;
}

function resolveSellQuantity(
  countInput: string,
  availableTokens: number,
): number {
  if (countInput.includes("%")) {
    const pct = parseFloat(countInput.replace("%", ""));
    if (!Number.isFinite(pct)) {
      throw new Error(`Invalid percent value: ${countInput}`);
    }
    return (pct / 100) * availableTokens;
  }
  const n = parseFloat(countInput);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid numeric count: ${countInput}`);
  }
  return n;
}

interface TradeArgs {
  tokenpair: string;
  action: "buy" | "sell";
  count: string | number;
}

interface TradeEvaluation {
  pair: string;
  price: number;
  balance: number;
  held: number;
  heldCostBasis: number;
  /** Percentage sells resolved to an absolute quantity; buys to a number. */
  normalizedCount: number;
  /** Malformed input (bad count, percentage buy). Rejected in BOTH branches. */
  inputError: string | null;
  /** Input is well-formed but the trade would be refused by the platform. */
  wouldSucceed: boolean;
  reason: string | null;
}

/**
 * Shared pre-flight for dry-run AND live execution, so the two paths cannot
 * diverge: live trades get exactly the validation the dry run advertises.
 */
async function evaluateTrade(
  client: ChartObserverClient,
  args: TradeArgs,
): Promise<TradeEvaluation> {
  const pair = args.tokenpair.toUpperCase();
  const [price, balance, openPositions] = await Promise.all([
    client.getPrice(pair),
    client.getBalance(),
    client.getOpenPositions(),
  ]);
  const grouped = summarizeOpenPositionsByToken(openPositions);
  const held = grouped[pair]?.totalAmount ?? 0;
  const heldCostBasis = grouped[pair]?.avgCostBasis ?? 0;

  const base: Omit<
    TradeEvaluation,
    "normalizedCount" | "inputError" | "wouldSucceed" | "reason"
  > = { pair, price, balance, held, heldCostBasis };

  if (args.action === "buy") {
    if (String(args.count).includes("%")) {
      return {
        ...base,
        normalizedCount: NaN,
        inputError: "Buy orders may not use a percentage count.",
        wouldSucceed: false,
        reason: null,
      };
    }
    const n = Number(args.count);
    if (!Number.isFinite(n) || n <= 0) {
      return {
        ...base,
        normalizedCount: NaN,
        inputError: "Buy count must be a positive number.",
        wouldSucceed: false,
        reason: null,
      };
    }
    const cost = n * price;
    const sufficient = balance >= cost;
    return {
      ...base,
      normalizedCount: n,
      inputError: null,
      wouldSucceed: sufficient,
      reason: sufficient
        ? null
        : `Insufficient funds: need ${cost.toFixed(2)} USD, have ${balance.toFixed(2)} USD.`,
    };
  }

  // sell
  let sellQty: number;
  try {
    sellQty = resolveSellQuantity(String(args.count), held);
  } catch (e) {
    return {
      ...base,
      normalizedCount: NaN,
      inputError: (e as Error).message,
      wouldSucceed: false,
      reason: null,
    };
  }
  if (sellQty <= 0) {
    return {
      ...base,
      normalizedCount: sellQty,
      inputError: "Sell count must be a positive quantity or percentage.",
      wouldSucceed: false,
      reason: null,
    };
  }
  const wouldSucceed = held > 0 && sellQty <= held * 1.005;
  return {
    ...base,
    normalizedCount: sellQty,
    inputError: null,
    wouldSucceed,
    reason:
      held === 0
        ? "No open position for this token — sell would be rejected."
        : sellQty > held * 1.005
          ? `Sell quantity (${sellQty}) exceeds held (${held}) — would be rejected.`
          : null,
  };
}

export function registerTradingTools(
  server: McpServer,
  client: ChartObserverClient,
): void {
  server.registerTool(
    "place_trade",
    {
      title: "Place a paper trade",
      description: [
        "Place a paper-trading buy or sell on the ChartObserver platform for the configured user.",
        "",
        "IMPORTANT SAFETY NOTES:",
        "- Defaults to dry_run=true. With dry_run=true, NO trade is executed; the tool returns the would-be impact (cost, resulting balance, resulting position). Always start with dry_run=true and present the result to the user for confirmation before calling again with dry_run=false.",
        "- This is paper trading (simulated). It does NOT move real funds. It DOES affect the user's leaderboard standing and visible portfolio.",
        "- Crypto pairs only. Pair format is no-slash (e.g. BTCUSD, ETHUSDT).",
        "- Sell `count` may be a percentage string like '50%' or '100%'. Buy `count` must be a numeric quantity.",
        "- Buys require sufficient USD balance. Sells cannot exceed currently held tokens.",
        "- Live execution runs the same validation as the dry run and refuses trades that would fail.",
      ].join("\n"),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: {
        tokenpair: z
          .string()
          .regex(TOKEN_PAIR_PATTERN)
          .max(20)
          .describe(
            "Trading pair in no-slash format, e.g. BTCUSD, ETHUSD, SOLUSDT.",
          ),
        action: z
          .enum(["buy", "sell"])
          .describe("Trade direction."),
        count: z
          .union([z.number().positive(), z.string()])
          .describe(
            "Quantity of base token to trade. For sells, may be a percentage string ('50%', '100%') of currently held tokens. For buys, must be a positive number.",
          ),
        dry_run: z
          .boolean()
          .default(true)
          .describe(
            "When true (default), returns the projected impact without executing. Set to false ONLY after confirming with the user.",
          ),
      },
    },
    // `dry_run = true` in the destructure is defense-in-depth: if the zod
    // default is ever bypassed, an absent flag must still mean dry run.
    async ({ tokenpair, action, count, dry_run = true }) => {
      try {
        const evaln = await evaluateTrade(client, {
          tokenpair,
          action,
          count,
        });

        if (evaln.inputError) {
          return fail("place_trade", new Error(evaln.inputError));
        }

        if (dry_run) {
          if (action === "buy") {
            const cost = evaln.normalizedCount * evaln.price;
            return ok({
              dry_run: true,
              action,
              tokenpair: evaln.pair,
              currentPrice: evaln.price,
              count: evaln.normalizedCount,
              estimatedCost: cost,
              currentBalance: evaln.balance,
              projectedBalance: evaln.balance - cost,
              wouldSucceed: evaln.wouldSucceed,
              note:
                evaln.reason ??
                "Confirm with the user, then re-call with dry_run=false to execute.",
            });
          }
          const proceeds = evaln.normalizedCount * evaln.price;
          return ok({
            dry_run: true,
            action,
            tokenpair: evaln.pair,
            currentPrice: evaln.price,
            count: evaln.normalizedCount,
            currentHeld: evaln.held,
            costBasis: evaln.heldCostBasis,
            estimatedProceeds: proceeds,
            estimatedPnL:
              (evaln.price - evaln.heldCostBasis) * evaln.normalizedCount,
            currentBalance: evaln.balance,
            projectedBalance: evaln.balance + proceeds,
            wouldSucceed: evaln.wouldSucceed,
            note:
              evaln.reason ??
              "Confirm with the user, then re-call with dry_run=false to execute.",
          });
        }

        // Live execution — refuse anything the dry run would flag.
        if (!evaln.wouldSucceed) {
          return fail(
            "place_trade",
            new Error(`Trade refused: ${evaln.reason}`),
          );
        }

        // Percentage sells stay in backend-native form ('100%') so the
        // platform computes the exact close quantity at execution time;
        // numeric counts are sent as the validated number.
        const wireCount =
          action === "sell" && String(count).includes("%")
            ? String(count)
            : evaln.normalizedCount;
        const res = await client.placeTrade({
          tokenPair: evaln.pair,
          action,
          count: wireCount,
        });
        return ok({
          dry_run: false,
          executed: true,
          tokenpair: evaln.pair,
          action,
          count: evaln.normalizedCount,
          response: res,
        });
      } catch (e) {
        return fail("place_trade", e);
      }
    },
  );

  server.registerTool(
    "get_balance",
    {
      title: "Get USD balance",
      description: "Fetch the configured user's current USD paper-trading balance.",
      annotations: { ...READ_TOOL_ANNOTATIONS },
      inputSchema: {},
    },
    async () => {
      try {
        const balance = await client.getBalance();
        return ok({ usdBalance: balance });
      } catch (e) {
        return fail("get_balance", e);
      }
    },
  );

  server.registerTool(
    "get_open_positions",
    {
      title: "Get open positions",
      description:
        "List all currently open paper-trading positions (buy transactions that have not yet been closed by a sell).",
      annotations: { ...READ_TOOL_ANNOTATIONS },
      inputSchema: {},
    },
    async () => {
      try {
        const positions = await client.getOpenPositions();
        const groupedByToken = summarizeOpenPositionsByToken(positions);
        return ok({
          openTransactionCount: positions.length,
          aggregateByToken: groupedByToken,
          rawTransactions: positions,
        });
      } catch (e) {
        return fail("get_open_positions", e);
      }
    },
  );

  server.registerTool(
    "get_closed_trades",
    {
      title: "Get closed trades",
      description:
        "List closed paper trades (completed buy→sell roundtrips) for the configured user, most recent first.",
      annotations: { ...READ_TOOL_ANNOTATIONS },
      inputSchema: {
        limit: z
          .number()
          .int()
          .positive()
          .max(300)
          .default(50)
          .describe("Maximum number of closed trades to return (server may cap)."),
      },
    },
    async ({ limit }) => {
      try {
        const trades = await client.getClosedPositions();
        return ok(trades.slice(0, limit));
      } catch (e) {
        return fail("get_closed_trades", e);
      }
    },
  );

  server.registerTool(
    "get_recent_transactions",
    {
      title: "Get recent transactions",
      description:
        "List the configured user's recent transactions (open + closed, all types). Most recent first.",
      annotations: { ...READ_TOOL_ANNOTATIONS },
      inputSchema: {
        limit: z
          .number()
          .int()
          .positive()
          .max(300)
          .default(50)
          .describe("Maximum number of transactions to return."),
      },
    },
    async ({ limit }) => {
      try {
        const txns = await client.getRecentTransactions();
        return ok(txns.slice(0, limit));
      } catch (e) {
        return fail("get_recent_transactions", e);
      }
    },
  );
}
