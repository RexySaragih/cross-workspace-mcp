import { z } from "zod";
import { readFile } from "fs/promises";
import { isAllowedPath } from "../config.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerReadMultipleFiles(server: McpServer) {
  server.tool(
    "read_project_files",
    "Read multiple files at once from allowed project workspaces. Useful for comparing or understanding related files across projects.",
    {
      paths: z
        .array(z.string())
        .describe("Array of absolute file paths to read"),
    },
    async ({ paths }) => {
      const results: string[] = [];

      for (const path of paths) {
        if (!isAllowedPath(path)) {
          results.push(`--- ${path} ---\nAccess denied: not within allowed project roots\n`);
          continue;
        }

        try {
          const content = await readFile(path, "utf-8");
          results.push(`--- ${path} ---\n${content}\n`);
        } catch (e: any) {
          results.push(`--- ${path} ---\nError: ${e.message}\n`);
        }
      }

      return {
        content: [{ type: "text" as const, text: results.join("\n") }],
      };
    }
  );
}
