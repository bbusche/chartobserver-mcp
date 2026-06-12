import { describe, it, expect, vi, afterEach } from "vitest";
import { ChartObserverClient, ChartObserverApiError } from "../api-client.js";
import type { Config } from "../config.js";

const testConfig: Config = {
  apiBase: "https://api.example.test",
  webhookId: "wh_test_secret_abc123",
  uid: "1700000000000",
  username: "alice",
  userAgent: "chartobserver-mcp/test",
  timeoutMs: 15_000,
};

function makeFetch(
  responses: Array<{
    status: number;
    body: string | object;
    headers?: Record<string, string>;
  }>,
) {
  const calls: Array<{ url: string; init?: any }> = [];
  let i = 0;
  const fn = vi.fn(async (url: string, init?: any) => {
    calls.push({ url, init });
    const r = responses[Math.min(i++, responses.length - 1)];
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () =>
        typeof r.body === "string" ? r.body : JSON.stringify(r.body),
      headers: {
        get: (name: string) => r.headers?.[name.toLowerCase()] ?? null,
      },
    };
  });
  return { fn, calls };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ChartObserverClient", () => {
  it("getBalance parses the array response and returns a number", async () => {
    const { fn } = makeFetch([
      { status: 200, body: [{ usdBalance: "9876.54" }] },
    ]);
    const c = new ChartObserverClient(testConfig, fn);
    const balance = await c.getBalance();
    expect(balance).toBe(9876.54);
    expect(fn).toHaveBeenCalledWith(
      "https://api.example.test/users/balance/1700000000000",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("getBalance throws when response is empty", async () => {
    const { fn } = makeFetch([{ status: 200, body: [] }]);
    const c = new ChartObserverClient(testConfig, fn);
    await expect(c.getBalance()).rejects.toThrow(/empty/);
  });

  it("getPrice handles the {data: {amount}} shape", async () => {
    const { fn } = makeFetch([
      { status: 200, body: { data: { amount: "67500.25" } } },
    ]);
    const c = new ChartObserverClient(testConfig, fn);
    const price = await c.getPrice("BTCUSD");
    expect(price).toBe(67500.25);
  });

  it("getPrice handles bare {amount} shape", async () => {
    const { fn } = makeFetch([{ status: 200, body: { amount: 42.5 } }]);
    const c = new ChartObserverClient(testConfig, fn);
    expect(await c.getPrice("ETHUSD")).toBe(42.5);
  });

  it("getPrice rejects unrecognized shapes", async () => {
    const { fn } = makeFetch([{ status: 200, body: { foo: "bar" } }]);
    const c = new ChartObserverClient(testConfig, fn);
    await expect(c.getPrice("BTCUSD")).rejects.toThrow(/Unrecognized/);
  });

  it("placeTrade posts the expected webhook body", async () => {
    const { fn, calls } = makeFetch([
      { status: 200, body: { message: "Data successfully added" } },
    ]);
    const c = new ChartObserverClient(testConfig, fn);
    await c.placeTrade({ tokenPair: "BTCUSD", action: "buy", count: 0.1 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://api.example.test/transaction/wh_test_secret_abc123",
    );
    expect(calls[0].init?.method).toBe("POST");
    const body = JSON.parse(calls[0].init!.body);
    expect(body).toEqual({
      tokenpair: "BTCUSD",
      action: "buy",
      count: "0.1",
      user: "1700000000000",
      exchange: "coinbase",
    });
  });

  it("placeTrade sends a UUID Idempotency-Key header", async () => {
    const { fn, calls } = makeFetch([
      { status: 200, body: { message: "Data successfully added" } },
    ]);
    const c = new ChartObserverClient(testConfig, fn);
    await c.placeTrade({ tokenPair: "BTCUSD", action: "buy", count: 0.1 });
    const key = calls[0].init?.headers["Idempotency-Key"];
    expect(key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("placeTrade serializes percentage sell counts", async () => {
    const { fn, calls } = makeFetch([
      { status: 200, body: { message: "Data successfully added" } },
    ]);
    const c = new ChartObserverClient(testConfig, fn);
    await c.placeTrade({ tokenPair: "ETHUSD", action: "sell", count: "100%" });
    const body = JSON.parse(calls[0].init!.body);
    expect(body.count).toBe("100%");
    expect(body.action).toBe("sell");
  });

  it("throws ChartObserverApiError on non-2xx", async () => {
    const { fn } = makeFetch([
      { status: 401, body: { message: "Authentication failed" } },
    ]);
    const c = new ChartObserverClient(testConfig, fn);
    await expect(c.getBalance()).rejects.toBeInstanceOf(
      ChartObserverApiError,
    );
  });

  it("failed trade errors carry a sanitized label, never the webhook path", async () => {
    const { fn } = makeFetch([{ status: 500, body: "boom" }]);
    const c = new ChartObserverClient(testConfig, fn);
    let caught: ChartObserverApiError | undefined;
    try {
      await c.placeTrade({ tokenPair: "BTCUSD", action: "buy", count: 1 });
    } catch (e) {
      caught = e as ChartObserverApiError;
    }
    expect(caught).toBeInstanceOf(ChartObserverApiError);
    expect(caught!.label).toBe("POST /transaction");
    expect(caught!.message).not.toContain(testConfig.webhookId);
    expect(caught!.label).not.toContain(testConfig.webhookId);
  });

  it("times out when fetch never resolves", async () => {
    const fn = vi.fn(() => new Promise<never>(() => {}));
    const c = new ChartObserverClient(
      { ...testConfig, timeoutMs: 50 },
      fn as any,
    );
    await expect(c.getBalance()).rejects.toThrow(/timed out after 50ms/);
  });

  it("timeout errors never contain the webhook secret", async () => {
    const fn = vi.fn(() => new Promise<never>(() => {}));
    const c = new ChartObserverClient(
      { ...testConfig, timeoutMs: 50 },
      fn as any,
    );
    let msg = "";
    try {
      await c.placeTrade({ tokenPair: "BTCUSD", action: "buy", count: 1 });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/timed out/);
    expect(msg).not.toContain(testConfig.webhookId);
  });

  it("retries a GET once on 429, honoring Retry-After", async () => {
    vi.useFakeTimers();
    const { fn } = makeFetch([
      { status: 429, body: "slow down", headers: { "retry-after": "2" } },
      { status: 200, body: [{ usdBalance: 55 }] },
    ]);
    const c = new ChartObserverClient(testConfig, fn);
    const pending = c.getBalance();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toBe(55);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("never retries a POST on 429", async () => {
    const { fn } = makeFetch([{ status: 429, body: "slow down" }]);
    const c = new ChartObserverClient(testConfig, fn);
    await expect(
      c.placeTrade({ tokenPair: "BTCUSD", action: "buy", count: 1 }),
    ).rejects.toBeInstanceOf(ChartObserverApiError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("includes X-Client and User-Agent headers on every request", async () => {
    const { fn, calls } = makeFetch([
      { status: 200, body: [{ usdBalance: 100 }] },
    ]);
    const c = new ChartObserverClient(testConfig, fn);
    await c.getBalance();
    expect(calls[0].init?.headers["User-Agent"]).toBe(
      "chartobserver-mcp/test",
    );
    expect(calls[0].init?.headers["X-Client"]).toBe(
      "chartobserver-mcp/test",
    );
  });
});
