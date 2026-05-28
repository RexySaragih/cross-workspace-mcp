import { z } from "zod";
import { readdir } from "fs/promises";
import { join } from "path";
import {
  ALLOWED_ROOTS,
  IGNORED_DIRS,
  MAX_SEARCH_DEPTH,
  MAX_SEARCH_RESULTS,
} from "../config.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

async function findFiles(
  dir: string,
  pattern: string,
  results: string[],
  depth: number
): Promise<void> {
  if (depth > MAX_SEARCH_DEPTH || results.length >= MAX_SEARCH_RESULTS) return;

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (results.length >= MAX_SEARCH_RESULTS) break;
      if (IGNORED_DIRS.has(entry.name)) continue;

      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        await findFiles(fullPath, pattern, results, depth + 1);
      } else if (entry.name.toLowerCase().includes(pattern.toLowerCase())) {
        results.push(fullPath);
      }
    }
  } catch {
    // skip unreadable directories
  }
}

export function registerSearchFiles(server: McpServer) {
  server.tool(
    "search_project_files",
    "Search for files by name pattern across all allowed project workspaces. Returns matching file paths.",
    {
      pattern: z
        .string()
        .describe("Filename or partial name to search for (case-insensitive)"),
      project: z
        .string()
        .optional()
        .describe(
          "Optional: limit search to a specific project root (e.g. 'krom-falcon')"
        ),
    },
    async ({ pattern, project }) => {
      const roots = project
        ? ALLOWED_ROOTS.filter((r) => r.includes(project))
        : ALLOWED_ROOTS;

      if (roots.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No matching project found for: ${project}`,
            },
          ],
          isError: true,
        };
      }

      const results: string[] = [];

      for (const root of roots) {
        await findFiles(root, pattern, results, 0);
      }

      const text =
        results.length > 0
          ? `Found ${results.length} match(es):\n\n${results.join("\n")}`
          : `No files matching "${pattern}" found.`;

      return {
        content: [{ type: "text" as const, text }],
      };
    }
  );
}
