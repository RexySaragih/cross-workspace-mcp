import type { GuardResult } from "../security/path-guard.js";

interface TextContent {
  type: "text";
  text: string;
}

export interface ToolResponse {
  content: TextContent[];
  isError?: boolean;
  [key: string]: unknown;
}

function textResponse(text: string, isError: boolean): ToolResponse {
  return { content: [{ type: "text", text }], isError };
}

export function ok(text: string): ToolResponse {
  return textResponse(text, false);
}

/** The operation ran but the request was invalid or refused. */
export function fail(text: string): ToolResponse {
  return textResponse(text, true);
}

/** The operation could not run because something threw. */
export function err(action: string, path: string, error: unknown): ToolResponse {
  const message = error instanceof Error ? error.message : String(error);
  return textResponse(`ERR ${action} ${path}: ${message}`, true);
}

export function denied(path: string, guard: GuardResult & { ok: false }): ToolResponse {
  return textResponse(`DENIED ${path} (${guard.reason}) ${guard.message}`, true);
}
