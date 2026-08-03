import { z } from "zod";
import { limits } from "../config.js";
import { fail, ok } from "../shared/response.js";
import { projectNames, resolveRoots } from "../shared/roots.js";
import { walkFiles } from "../shared/walk.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerSearchFiles(server: McpServer): void {
  server.registerTool(
    "search_project_files",
    {
      title: "Search project files by name",
      description:
        "Search for files by name pattern across all allowed project workspaces. Returns matching file paths.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        pattern: z
          .string()
          .min(1)
          .describe("Filename or partial name to search for (case-insensitive)"),
        project: z
          .string()
          .optional()
          .describe("Optional: limit search to a specific project directory name"),
      },
    },
    async ({ pattern, project }) => {
      const roots = resolveRoots(project);
      if (roots.length === 0) {
        return fail(
          `FAIL no project matches "${project}" (available: ${projectNames().join(", ") || "none"})`
        );
      }

      const needle = pattern.toLowerCase();
      const results: string[] = [];

      for (const root of roots) {
        if (results.length >= limits.maxSearchResults) break;
        await walkFiles(root, {
          onFile: ({ path, name }) => {
            if (name.toLowerCase().includes(needle)) results.push(path);
            return results.length < limits.maxSearchResults;
          },
        });
      }

      if (results.length === 0) return ok(`No files matching "${pattern}" found.`);

      const capped =
        results.length >= limits.maxSearchResults ? " (result cap reached)" : "";
      return ok(`Found ${results.length} match(es)${capped}:\n\n${results.join("\n")}`);
    }
  );
}
