import { z } from "zod";
import { readdir } from "fs/promises";
import { isAllowedPath } from "../config.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerListDir(server: McpServer) {
  server.tool(
    "list_project_dir",
    "List files and directories in a given path from any allowed project workspace.",
    {
      path: z.string().describe("Absolute path to the directory to list"),
      recursive: z
        .boolean()
        .optional()
        .default(false)
        .describe("Whether to list recursively (1 level deep)"),
    },
    async ({ path, recursive }) => {
      if (!isAllowedPath(path)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Access denied: ${path} is not within allowed project roots`,
            },
          ],
          isError: true,
        };
      }

      try {
        const entries = await readdir(path, { withFileTypes: true });
        const lines: string[] = [];

        for (const entry of entries) {
          const prefix = entry.isDirectory() ? "📁" : "📄";
          lines.push(`${prefix} ${entry.name}`);

          if (recursive && entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
            try {
              const subPath = `${path}/${entry.name}`;
              const subEntries = await readdir(subPath, { withFileTypes: true });
              for (const sub of subEntries) {
                const subPrefix = sub.isDirectory() ? "📁" : "📄";
                lines.push(`  ${subPrefix} ${sub.name}`);
              }
            } catch {
              // skip unreadable subdirectories
            }
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: lines.join("\n") || "(empty directory)",
            },
          ],
        };
      } catch (e: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing directory: ${e.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
