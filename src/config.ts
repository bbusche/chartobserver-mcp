import { z } from "zod";

export interface Config {
  apiBase: string;
  webhookId: string;
  uid: string;
  username: string;
  userAgent: string;
  timeoutMs: number;
}

export const DEFAULT_API_BASE =
  "https://g2uyqqluc4.execute-api.us-east-2.amazonaws.com/dev";

export const DEFAULT_TIMEOUT_MS = 15_000;

export const PACKAGE_VERSION = "0.2.0";

// Validation messages must never echo the webhook value — they can end up in
// MCP client logs.
const configSchema = z.object({
  webhookId: z
    .string()
    .min(8, "CHARTOBSERVER_WEBHOOK_ID looks too short to be a valid webhook ID."),
  uid: z
    .string()
    .regex(/^\d+$/, "CHARTOBSERVER_UID must be your numeric user ID."),
  username: z.string().min(1, "CHARTOBSERVER_USERNAME must not be empty."),
  apiBase: z
    .string()
    .url("CHARTOBSERVER_API_BASE must be a valid URL.")
    .refine(
      (u) => new URL(u).protocol === "https:",
      "CHARTOBSERVER_API_BASE must use https: (credentials travel on this connection).",
    ),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(120_000)
    .describe("CHARTOBSERVER_TIMEOUT_MS"),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const webhookId = env.CHARTOBSERVER_WEBHOOK_ID?.trim();
  const uid = env.CHARTOBSERVER_UID?.trim();
  const username = env.CHARTOBSERVER_USERNAME?.trim();

  const missing: string[] = [];
  if (!webhookId) missing.push("CHARTOBSERVER_WEBHOOK_ID");
  if (!uid) missing.push("CHARTOBSERVER_UID");
  if (!username) missing.push("CHARTOBSERVER_USERNAME");
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(
        ", ",
      )}. Configure them in your MCP client's mcpServers entry. See README.`,
    );
  }

  const rawTimeout = env.CHARTOBSERVER_TIMEOUT_MS?.trim();
  const timeoutMs = rawTimeout ? Number(rawTimeout) : DEFAULT_TIMEOUT_MS;
  if (rawTimeout && !Number.isFinite(timeoutMs)) {
    throw new Error("CHARTOBSERVER_TIMEOUT_MS must be a number (milliseconds).");
  }

  const candidate = {
    apiBase: (env.CHARTOBSERVER_API_BASE?.trim() || DEFAULT_API_BASE).replace(
      /\/+$/,
      "",
    ),
    webhookId: webhookId!,
    uid: uid!,
    username: username!,
    timeoutMs,
  };

  const parsed = configSchema.safeParse(candidate);
  if (!parsed.success) {
    const reasons = parsed.error.issues
      .map((i) =>
        i.path[0] === "timeoutMs"
          ? "CHARTOBSERVER_TIMEOUT_MS must be a positive integer ≤ 120000."
          : i.message,
      )
      .join(" ");
    throw new Error(`Invalid configuration: ${reasons}`);
  }

  return {
    ...parsed.data,
    userAgent: `chartobserver-mcp/${PACKAGE_VERSION}`,
  };
}
