import { z } from "zod";
import { readFile } from "fs/promises";
import { isAllowedPath } from "../config.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerReadFile(server: McpServer) {
  server.tool(
    "read_project_file",
    "Read a file from any allowed project workspace. Use offset/limit to read a line range and save tokens.",
    {
      path: z.string().describe("Absolute path to the file to read"),
      offset: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("1-based start line (omit to read from beginning)"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe("Max lines to return (default: full file, max 500 when offset is set)"),
    },
    async ({ path, offset, limit }) => {
      if (!isAllowedPath(path)) {
        return {
          content: [{ type: "text" as const, text: `DENIED ${path}` }],
          isError: true,
        };
      }

      try {
        const content = await readFile(path, "utf-8");
        const lines = content.split("\n");
        const total = lines.length;

        if (offset !== undefined) {
          const start = offset - 1;
          const maxLines = limit ?? 500;
          const slice = lines.slice(start, start + maxLines);
          const end = start + slice.length;
          const header = `${path} L${start + 1}-${end}/${total}`;
          const numbered = slice.map((line, i) => `${start + i + 1}|${line}`).join("\n");
          return {
            content: [{ type: "text" as const, text: `${header}\n${numbered}` }],
          };
        }

        if (limit !== undefined) {
          const slice = lines.slice(0, limit);
          const header = `${path} L1-${slice.length}/${total}`;
          const numbered = slice.map((line, i) => `${i + 1}|${line}`).join("\n");
          return {
            content: [{ type: "text" as const, text: `${header}\n${numbered}` }],
          };
        }

        return {
          content: [{ type: "text" as const, text: `${path} ${total}L\n${content}` }],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `ERR read ${path}: ${e.message}` }],
          isError: true,
        };
      }
    }
  );
}
