import { z } from "zod";
import { readFile, writeFile } from "fs/promises";
import { isAllowedPath } from "../config.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const MAX_EDITS_PER_CALL = 20;

interface Edit {
  old_string: string;
  new_string: string;
  replace_all: boolean;
}

function countOccurrences(content: string, search: string): number {
  if (search === "") return 0;
  let count = 0;
  let index = 0;
  while ((index = content.indexOf(search, index)) !== -1) {
    count++;
    index += search.length;
  }
  return count;
}

function applyEdits(
  content: string,
  edits: Edit[]
): { ok: true; content: string; applied: number; delta: number } | { ok: false; error: string } {
  let current = content;
  let totalDelta = 0;

  for (let i = 0; i < edits.length; i++) {
    const { old_string, new_string, replace_all } = edits[i];
    const occurrences = countOccurrences(current, old_string);

    if (occurrences === 0) {
      return { ok: false, error: `edit ${i + 1}/${edits.length}: old_string not found` };
    }

    if (!replace_all && occurrences > 1) {
      return {
        ok: false,
        error: `edit ${i + 1}/${edits.length}: ${occurrences} matches (set replace_all or use a unique old_string)`,
      };
    }

    if (replace_all) {
      const parts = current.split(old_string);
      current = parts.join(new_string);
      totalDelta += (new_string.length - old_string.length) * (parts.length - 1);
    } else {
      const index = current.indexOf(old_string);
      current =
        current.slice(0, index) + new_string + current.slice(index + old_string.length);
      totalDelta += new_string.length - old_string.length;
    }
  }

  return { ok: true, content: current, applied: edits.length, delta: totalDelta };
}

export function registerEditFile(server: McpServer) {
  server.tool(
    "edit_project_file",
    "Apply targeted search/replace edits to a file outside the active workspace. All edits are validated then written atomically. Returns a one-line summary (no file content) to save tokens.",
    {
      path: z.string().describe("Absolute path to the file"),
      edits: z
        .array(
          z.object({
            old_string: z.string().describe("Exact text to find"),
            new_string: z.string().describe("Replacement text"),
            replace_all: z
              .boolean()
              .optional()
              .default(false)
              .describe("Replace every match (default: require exactly one)"),
          })
        )
        .min(1)
        .max(MAX_EDITS_PER_CALL)
        .describe("Edits applied in order; all must succeed before writing"),
    },
    async ({ path, edits }) => {
      if (!isAllowedPath(path)) {
        return {
          content: [{ type: "text" as const, text: `DENIED ${path}` }],
          isError: true,
        };
      }

      let content: string;
      try {
        content = await readFile(path, "utf-8");
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `ERR read ${path}: ${e.message}` }],
          isError: true,
        };
      }

      const result = applyEdits(content, edits);
      if (!result.ok) {
        return {
          content: [{ type: "text" as const, text: `FAIL ${path} ${result.error}` }],
          isError: true,
        };
      }

      if (result.content === content) {
        return {
          content: [{ type: "text" as const, text: `OK ${path} 0 edits (no changes)` }],
        };
      }

      try {
        await writeFile(path, result.content, "utf-8");
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `ERR write ${path}: ${e.message}` }],
          isError: true,
        };
      }

      const sign = result.delta >= 0 ? `+${result.delta}` : `${result.delta}`;
      return {
        content: [
          {
            type: "text" as const,
            text: `OK ${path} ${result.applied} edit(s) Δ${sign}b`,
          },
        ],
      };
    }
  );
}
