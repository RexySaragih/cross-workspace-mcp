#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { describeDiscovery, features, getAllowedRoots } from "./config.js";
import { SERVER_VERSION, createServer } from "./server.js";

/** stdout carries the JSON-RPC stream, so all logging must go to stderr. */
function log(message: string): void {
  process.stderr.write(`[cross-workspace] ${message}\n`);
}

async function main(): Promise<void> {
  log(`v${SERVER_VERSION} ${describeDiscovery()}`);

  if (getAllowedRoots().length === 0) {
    log("WARNING: no projects matched. Every tool call will be denied.");
  }
  if (features.readOnly) {
    log("read-only mode: write tools are not registered.");
  }

  const server = createServer();
  await server.connect(new StdioServerTransport());

  const shutdown = (): void => {
    void server.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  log(
    `fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
  );
  process.exit(1);
});
