import { readFile } from "fs/promises";
import { z } from "zod";
import { limits } from "../config.js";
import { guardPath } from "../security/path-guard.js";
import { fileSize, formatBytes, looksBinary } from "../shared/fs-utils.js";
import { ok } from "../shared/response.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

async function readOne(path: string): Promise<string> {
  const guard = guardPath(path);
  if (!guard.ok) return `DENIED (${guard.reason}) ${guard.message}`;

  try {
    const size = await fileSize(guard.real);
    if (size > limits.maxBatchReadBytes) {
      return `SKIPPED too large (${formatBytes(size)} > ${formatBytes(limits.maxBatchReadBytes)}); read it individually`;
    }

    const buffer = await readFile(guard.real);
    if (looksBinary(buffer)) return `SKIPPED binary (${formatBytes(size)})`;

    return buffer.toString("utf-8");
  } catch (error) {
    return `ERR ${error instanceof Error ? error.message : String(error)}`;
  }
}

export function registerReadMultipleFiles(server: McpServer): void {
  server.registerTool(
    "read_project_files",
    {
      title: "Read multiple project files",
      description:
        "Read multiple files at once from allowed project workspaces. Useful for comparing or understanding related files across projects.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        paths: z
          .array(z.string())
          .min(1)
          .max(limits.maxBatchReadPaths)
          .describe("Array of absolute file paths to read"),
      },
    },
    async ({ paths }) => {
      const sections = await Promise.all(
        paths.map(async (path) => `--- ${path} ---\n${await readOne(path)}`)
      );
      return ok(sections.join("\n\n"));
    }
  );
}
