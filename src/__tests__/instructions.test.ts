import { describe, it, expect } from "vitest";
import { SERVER_INSTRUCTIONS } from "../instructions.js";

describe("SERVER_INSTRUCTIONS", () => {
  it("tells the agent an existing account is required and where to sign up", () => {
    expect(SERVER_INSTRUCTIONS).toContain("https://chart.observer");
    expect(SERVER_INSTRUCTIONS).toMatch(/EXISTING chart.observer account/);
    expect(SERVER_INSTRUCTIONS).toMatch(/cannot[\s\S]*be created through this server/);
    expect(SERVER_INSTRUCTIONS).toMatch(/in a browser/);
  });

  it("reiterates the paper-trading and confirm-before-execute safety model", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/paper trading/);
    expect(SERVER_INSTRUCTIONS).toMatch(/confirm/i);
    expect(SERVER_INSTRUCTIONS).toMatch(/dry_run/);
  });
});
