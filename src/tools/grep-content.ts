import { z } from "zod";
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import {
  ALLOWED_ROOTS,
  IGNORED_DIRS,
  MAX_SEARCH_DEPTH,
  isAllowedPath,
} from "../config.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

interface GrepMatch {
  file: string;
  line: number;
  text: string;
}

const MAX_GREP_RESULTS = 50;

async function grepInDir(
  dir: string,
  pattern: RegExp,
  extensions: string[],
  results: GrepMatch[],
  depth: number
): Promise<void> {
  if (depth > MAX_SEARCH_DEPTH || results.length >= MAX_GREP_RESULTS) return;

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (results.length >= MAX_GREP_RESULTS) break;
      if (IGNORED_DIRS.has(entry.name)) continue;

      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        await grepInDir(fullPath, pattern, extensions, results, depth + 1);
      } else {
        const hasMatchingExt =
          extensions.length === 0 ||
          extensions.some((ext) => entry.name.endsWith(ext));

        if (!hasMatchingExt) continue;

        try {
          const content = await readFile(fullPath, "utf-8");
          const lines = content.split("\n");

          for (let i = 0; i < lines.length; i++) {
            if (results.length >= MAX_GREP_RESULTS) break;
            if (pattern.test(lines[i])) {
              results.push({
                file: fullPath,
                line: i + 1,
                text: lines[i].trim().substring(0, 200),
              });
            }
          }
        } catch {
          // skip unreadable files (binary, etc.)
        }
      }
    }
  } catch {
    // skip unreadable directories
  }
}

export function registerGrepContent(server: McpServer) {
  server.tool(
    "grep_project_content",
    "Search file contents across allowed project workspaces using a text or regex pattern. Returns matching lines with file paths and line numbers.",
    {
      query: z.string().describe("Text or regex pattern to search for"),
      project: z
        .string()
        .optional()
        .describe("Optional: limit search to a specific project (e.g. 'krom-trex')"),
      extensions: z
        .string()
        .optional()
        .describe(
          "Optional: comma-separated file extensions to include (e.g. '.ts,.tsx,.js')"
        ),
    },
    async ({ query, project, extensions }) => {
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

      const extList = extensions
        ? extensions.split(",").map((e) => e.trim())
        : [];

      let pattern: RegExp;
      try {
        pattern = new RegExp(query, "i");
      } catch {
        pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      }

      const results: GrepMatch[] = [];

      for (const root of roots) {
        await grepInDir(root, pattern, extList, results, 0);
      }

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No matches found for "${query}"`,
            },
          ],
        };
      }

      const text = results
        .map((r) => `${r.file}:${r.line}\n  ${r.text}`)
        .join("\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${results.length} match(es):\n\n${text}`,
          },
        ],
      };
    }
  );
}
