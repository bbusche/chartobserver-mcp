import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ChartObserverClient } from "../api-client.js";
import { ok, fail, READ_TOOL_ANNOTATIONS } from "./util.js";

export function registerAccountTools(
  server: McpServer,
  client: ChartObserverClient,
): void {
  server.registerTool(
    "get_profile",
    {
      title: "Get profile",
      description:
        "Fetch the currently configured user's public profile (description, social links, follower counts) along with their USD paper-trading balance. Read-only.",
      annotations: { ...READ_TOOL_ANNOTATIONS },
      inputSchema: {},
    },
    async () => {
      try {
        const [profile, balance] = await Promise.all([
          client.getPublicProfile(client.config.username),
          client.getBalance(),
        ]);
        return ok({
          username: client.config.username,
          uid: client.config.uid,
          balance,
          profile,
        });
      } catch (e) {
        return fail("get_profile", e);
      }
    },
  );
}
