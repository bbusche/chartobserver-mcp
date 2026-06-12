import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";

export interface Transaction {
  userId: string;
  txnId: string;
  entityType: "buy" | "sell" | "reconcile";
  amount: number;
  exchange: number;
  isOpen: boolean;
  txnPrice: number;
  tokenPair: string;
  txnDate: string;
  closeDate?: string;
  closePrice?: number;
  costBasis?: number;
  txnSource: string;
  strategyAuthor?: string;
  strategyInterval?: string;
}

export interface ClosedTrade {
  userId: string;
  username: string;
  txnId: string;
  tokenPair: string;
  amount: number;
  avgPrice: number;
  closePrice: number;
  openDate: string;
  closeDate: string;
  ymd: string;
  strategyAuthor?: string;
  strategyInterval?: string;
}

export interface PublicProfile {
  description?: string;
  showPortfolio?: string;
  copyTradable?: string;
  instagramURL?: string;
  tradingviewURL?: string;
  twitterURL?: string;
  youtubeURL?: string;
  telegramURL?: string;
  farcasterURL?: string;
  subscription?: string;
  followers?: number;
  following?: number;
  userId?: string;
}

export interface LeaderboardEntry {
  username: string;
  tradeCount: number;
  avgProfit: number;
  largestProfit: number;
  strategy?: string;
  interval?: string;
}

export interface LeaderboardResponse {
  [windowDays: string]: {
    topTraders?: LeaderboardEntry[];
    leaderBoard?: unknown[];
  };
}

export class ChartObserverApiError extends Error {
  /**
   * `label` is a sanitized request descriptor (e.g. "POST /transaction") —
   * never the interpolated URL path, which can contain the webhook secret.
   */
  constructor(
    public readonly status: number,
    public readonly label: string,
    public readonly bodyText: string,
  ) {
    super(`ChartObserver API ${status} on ${label}: ${bodyText.slice(0, 500)}`);
    this.name = "ChartObserverApiError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  /** Sanitized descriptor used in all error text instead of the URL path. */
  label?: string;
  idempotencyKey?: string;
}

type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  headers?: { get(name: string): string | null };
}>;

const MAX_RETRY_AFTER_S = 10;

export class ChartObserverClient {
  constructor(
    public readonly config: Config,
    private readonly fetchFn: FetchLike = globalThis.fetch as unknown as FetchLike,
  ) {}

  private async fetchWithTimeout(
    url: string,
    init: Parameters<FetchLike>[1],
    label: string,
  ): Promise<Awaited<ReturnType<FetchLike>>> {
    const timeoutMs = this.config.timeoutMs;
    const signal = AbortSignal.timeout(timeoutMs);
    const timeoutError = new Error(
      `Request to ChartObserver API timed out after ${timeoutMs}ms (${label})`,
    );
    let onAbort: (() => void) | undefined;
    // Race an explicit rejection alongside the signal: injected fetch
    // implementations may ignore `signal`, but the tool must still unblock.
    const abortPromise = new Promise<never>((_, reject) => {
      onAbort = () => reject(timeoutError);
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return await Promise.race([
        this.fetchFn(url, { ...init, signal }),
        abortPromise,
      ]);
    } catch (e) {
      const name = (e as Error)?.name;
      if (name === "AbortError" || name === "TimeoutError") throw timeoutError;
      throw e;
    } finally {
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
  }

  private async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const method = opts.method ?? "GET";
    const label = opts.label ?? `${method} request`;
    const url = `${this.config.apiBase}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": this.config.userAgent,
      "X-Client": this.config.userAgent,
    };
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    const init = {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    };

    let res = await this.fetchWithTimeout(url, init, label);
    if (res.status === 429 && method === "GET") {
      // Honor Retry-After once for idempotent reads. Never retry POSTs.
      const retryAfterS = Number(res.headers?.get("retry-after") ?? "") || 1;
      const waitMs = Math.min(retryAfterS, MAX_RETRY_AFTER_S) * 1000;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      res = await this.fetchWithTimeout(url, init, label);
    }

    const text = await res.text();
    if (!res.ok) {
      throw new ChartObserverApiError(res.status, label, text);
    }
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }

  async getBalance(): Promise<number> {
    const result = await this.request<Array<{ usdBalance: string | number }>>(
      `/users/balance/${encodeURIComponent(this.config.uid)}`,
      { label: "GET /users/balance" },
    );
    if (!Array.isArray(result) || result.length === 0) {
      throw new Error("Balance response was empty");
    }
    return Number(result[0].usdBalance);
  }

  async getOpenPositions(): Promise<Transaction[]> {
    return this.request<Transaction[]>(
      `/positions/open/${encodeURIComponent(this.config.uid)}`,
      { label: "GET /positions/open" },
    );
  }

  async getClosedPositions(): Promise<Transaction[]> {
    return this.request<Transaction[]>(
      `/positions/closed/${encodeURIComponent(this.config.uid)}`,
      { label: "GET /positions/closed" },
    );
  }

  async getRecentTransactions(): Promise<Transaction[]> {
    return this.request<Transaction[]>(
      `/transactions/${encodeURIComponent(this.config.uid)}`,
      { label: "GET /transactions" },
    );
  }

  async getLeaderboard(): Promise<LeaderboardResponse> {
    return this.request<LeaderboardResponse>("/leaderboard", {
      label: "GET /leaderboard",
    });
  }

  async getPrice(tokenPair: string): Promise<number> {
    const result = await this.request<{
      data?: { amount?: string | number };
      amount?: string | number;
      price?: string | number;
    }>(`/token/price/${encodeURIComponent(tokenPair)}`, {
      label: "GET /token/price",
    });
    const raw =
      result?.data?.amount ?? result?.amount ?? result?.price ?? NaN;
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      throw new Error(
        `Unrecognized price response shape for ${tokenPair}: ${JSON.stringify(result)}`,
      );
    }
    return n;
  }

  async getPublicProfile(username: string): Promise<PublicProfile> {
    const result = await this.request<{ data?: PublicProfile }>(
      `/user/profile/${encodeURIComponent(username)}`,
      { label: "GET /user/profile" },
    );
    return result?.data ?? {};
  }

  async placeTrade(args: {
    tokenPair: string;
    action: "buy" | "sell";
    count: string | number;
  }): Promise<{ message: string }> {
    return this.request<{ message: string }>(
      `/transaction/${encodeURIComponent(this.config.webhookId)}`,
      {
        method: "POST",
        label: "POST /transaction",
        // Sent for forward-compat: the backend will dedupe on this key once
        // idempotency support lands. The client never auto-retries this POST.
        idempotencyKey: randomUUID(),
        body: {
          tokenpair: args.tokenPair,
          action: args.action,
          count: String(args.count),
          user: this.config.uid,
          exchange: "coinbase",
        },
      },
    );
  }
}
