import { describe, it, expect } from "vitest";
import { loadConfig, DEFAULT_API_BASE, DEFAULT_TIMEOUT_MS } from "../config.js";

const validEnv = {
  CHARTOBSERVER_WEBHOOK_ID: "wh_test_secret_abc123",
  CHARTOBSERVER_UID: "1700000000000",
  CHARTOBSERVER_USERNAME: "alice",
};

describe("loadConfig", () => {
  it("throws when required env vars are missing", () => {
    expect(() => loadConfig({})).toThrow(/CHARTOBSERVER_WEBHOOK_ID/);
  });

  it("lists all missing variables in one error", () => {
    const err = (() => {
      try {
        loadConfig({});
      } catch (e) {
        return (e as Error).message;
      }
      return "";
    })();
    expect(err).toMatch(/CHARTOBSERVER_WEBHOOK_ID/);
    expect(err).toMatch(/CHARTOBSERVER_UID/);
    expect(err).toMatch(/CHARTOBSERVER_USERNAME/);
  });

  it("defaults apiBase to production when not set", () => {
    const cfg = loadConfig({ ...validEnv });
    expect(cfg.apiBase).toBe(DEFAULT_API_BASE);
  });

  it("strips trailing slashes from apiBase", () => {
    const cfg = loadConfig({
      ...validEnv,
      CHARTOBSERVER_API_BASE: "https://example.test/staging//",
    });
    expect(cfg.apiBase).toBe("https://example.test/staging");
  });

  it("trims whitespace from values", () => {
    const cfg = loadConfig({
      CHARTOBSERVER_WEBHOOK_ID: "  wh_test_secret_abc123  ",
      CHARTOBSERVER_UID: " 1700000000000 ",
      CHARTOBSERVER_USERNAME: " alice ",
    });
    expect(cfg.webhookId).toBe("wh_test_secret_abc123");
    expect(cfg.uid).toBe("1700000000000");
    expect(cfg.username).toBe("alice");
  });

  it("rejects an http: apiBase", () => {
    expect(() =>
      loadConfig({
        ...validEnv,
        CHARTOBSERVER_API_BASE: "http://example.test",
      }),
    ).toThrow(/https/);
  });

  it("rejects a non-URL apiBase", () => {
    expect(() =>
      loadConfig({
        ...validEnv,
        CHARTOBSERVER_API_BASE: "not a url",
      }),
    ).toThrow(/valid URL/);
  });

  it("rejects a non-numeric uid", () => {
    expect(() =>
      loadConfig({ ...validEnv, CHARTOBSERVER_UID: "alice" }),
    ).toThrow(/numeric/);
  });

  it("rejects a too-short webhook ID without echoing its value", () => {
    let msg = "";
    try {
      loadConfig({ ...validEnv, CHARTOBSERVER_WEBHOOK_ID: "abc" });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/too short/);
    expect(msg).not.toContain("abc");
  });

  it("defaults timeoutMs and accepts an override", () => {
    expect(loadConfig({ ...validEnv }).timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
    expect(
      loadConfig({ ...validEnv, CHARTOBSERVER_TIMEOUT_MS: "30000" }).timeoutMs,
    ).toBe(30_000);
  });

  it("rejects a non-numeric or out-of-range timeout", () => {
    expect(() =>
      loadConfig({ ...validEnv, CHARTOBSERVER_TIMEOUT_MS: "soon" }),
    ).toThrow(/CHARTOBSERVER_TIMEOUT_MS/);
    expect(() =>
      loadConfig({ ...validEnv, CHARTOBSERVER_TIMEOUT_MS: "999999999" }),
    ).toThrow(/CHARTOBSERVER_TIMEOUT_MS/);
  });

  it("missing-credentials error directs the user to chart.observer signup", () => {
    let msg = "";
    try {
      loadConfig({});
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("https://chart.observer");
    expect(msg).toMatch(/create one in a browser/);
  });

  it("invalid-credentials error directs the user to chart.observer signup", () => {
    let msg = "";
    try {
      loadConfig({ ...validEnv, CHARTOBSERVER_UID: "alice" });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("https://chart.observer");
  });
});
