import { z } from "zod";
import { access, mkdir, writeFile } from "fs/promises";
import { constants } from "fs";
import { dirname } from "path";
import { isAllowedPath } from "../config.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerCreateFile(server: McpServer) {
  server.tool(
    "create_project_file",
    "Create a new file outside the active workspace. Fails if the file already exists. Creates parent directories as needed. Returns a one-line summary (no file content).",
    {
      path: z.string().describe("Absolute path for the new file"),
      content: z
        .string()
        .optional()
        .default("")
        .describe("Initial file content (default: empty file)"),
    },
    async ({ path, content }) => {
      if (!isAllowedPath(path)) {
        return {
          content: [{ type: "text" as const, text: `DENIED ${path}` }],
          isError: true,
        };
      }

      try {
        await access(path, constants.F_OK);
        return {
          content: [{ type: "text" as const, text: `FAIL ${path} already exists` }],
          isError: true,
        };
      } catch (e: any) {
        if (e.code !== "ENOENT") {
          return {
            content: [{ type: "text" as const, text: `ERR ${path}: ${e.message}` }],
            isError: true,
          };
        }
      }

      try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content, { encoding: "utf-8", flag: "wx" });
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `ERR create ${path}: ${e.message}` }],
          isError: true,
        };
      }

      const lines = content.length === 0 ? 0 : content.split("\n").length;
      return {
        content: [
          {
            type: "text" as const,
            text: `OK ${path} created ${content.length}b ${lines}L`,
          },
        ],
      };
    }
  );
}
