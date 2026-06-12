import { ChartObserverApiError } from "../api-client.js";
import { redactSecrets } from "../redact.js";

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/** Every read tool hits the live ChartObserver API and mutates nothing. */
export const READ_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  openWorldHint: true,
} as const;

export function ok(payload: unknown): ToolResult {
  return {
    content: [
      {
        type: "text",
        text:
          typeof payload === "string"
            ? payload
            : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

export function fail(toolName: string, error: unknown): ToolResult {
  let message: string;
  if (error instanceof ChartObserverApiError) {
    message = `${toolName} failed: HTTP ${error.status} from ${error.label}\n${error.bodyText.slice(0, 1000)}`;
  } else if (error instanceof Error) {
    message = `${toolName} failed: ${error.message}`;
  } else {
    message = `${toolName} failed: ${String(error)}`;
  }
  return {
    content: [{ type: "text", text: redactSecrets(message) }],
    isError: true,
  };
}
