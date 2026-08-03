import type { Dirent } from "fs";
import { readdir } from "fs/promises";
import { join } from "path";
import { z } from "zod";
import { IGNORED_DIRS, limits } from "../config.js";
import { guardPath } from "../security/path-guard.js";
import { denied, err, ok } from "../shared/response.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function label(entry: Dirent): string {
  if (entry.isDirectory()) return "dir ";
  if (entry.isSymbolicLink()) return "link";
  return "file";
}

async function listChildren(parent: string): Promise<string[]> {
  try {
    const entries = await readdir(parent, { withFileTypes: true });
    return entries.map((entry) => `  ${label(entry)} ${entry.name}`);
  } catch {
    return [];
  }
}

export function registerListDir(server: McpServer): void {
  server.registerTool(
    "list_project_dir",
    {
      title: "List project directory",
      description:
        "List files and directories in a given path from any allowed project workspace.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        path: z.string().describe("Absolute path to the directory to list"),
        recursive: z
          .boolean()
          .optional()
          .default(false)
          .describe("Also list one level into each subdirectory"),
      },
    },
    async ({ path, recursive }) => {
      const guard = guardPath(path);
      if (!guard.ok) return denied(path, guard);

      try {
        const entries = await readdir(guard.real, { withFileTypes: true });
        const lines: string[] = [];

        for (const entry of entries) {
          if (lines.length >= limits.maxListEntries) break;
          lines.push(`${label(entry)} ${entry.name}`);

          const shouldDescend =
            recursive && entry.isDirectory() && !IGNORED_DIRS.has(entry.name);
          if (!shouldDescend) continue;

          lines.push(...(await listChildren(join(guard.real, entry.name))));
        }

        if (lines.length === 0) return ok(`${path} (empty directory)`);

        const truncated =
          entries.length > limits.maxListEntries
            ? ` (showing ${limits.maxListEntries}/${entries.length})`
            : "";
        return ok(`${path}${truncated}\n${lines.join("\n")}`);
      } catch (error) {
        return err("list", path, error);
      }
    }
  );
}
