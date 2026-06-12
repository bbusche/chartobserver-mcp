import { describe, it, expect, afterEach } from "vitest";
import { registerSecret, clearSecrets, redactSecrets } from "../redact.js";

afterEach(() => clearSecrets());

describe("redactSecrets", () => {
  it("replaces every occurrence of a registered secret", () => {
    registerSecret("wh_super_secret");
    expect(
      redactSecrets("path /transaction/wh_super_secret failed: wh_super_secret"),
    ).toBe("path /transaction/*** failed: ***");
  });

  it("redacts URL-encoded occurrences", () => {
    registerSecret("wh/secret+value");
    expect(redactSecrets(`bad: ${encodeURIComponent("wh/secret+value")}`)).toBe(
      "bad: ***",
    );
  });

  it("is a no-op when nothing is registered", () => {
    expect(redactSecrets("hello")).toBe("hello");
  });

  it("ignores empty-string registration", () => {
    registerSecret("");
    expect(redactSecrets("hello")).toBe("hello");
  });
});
