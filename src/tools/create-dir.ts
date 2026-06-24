import { z } from "zod";
import { mkdir, stat } from "fs/promises";
import { isAllowedPath } from "../config.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerCreateDir(server: McpServer) {
  server.tool(
    "create_project_dir",
    "Create a new folder outside the active workspace. Fails if the folder already exists. Optionally creates parent directories. Returns a one-line summary.",
    {
      path: z.string().describe("Absolute path for the new directory"),
      parents: z
        .boolean()
        .optional()
        .default(true)
        .describe("Create parent directories if needed (default: true)"),
    },
    async ({ path, parents }) => {
      if (!isAllowedPath(path)) {
        return {
          content: [{ type: "text" as const, text: `DENIED ${path}` }],
          isError: true,
        };
      }

      try {
        const info = await stat(path);
        if (info.isDirectory()) {
          return {
            content: [{ type: "text" as const, text: `FAIL ${path} already exists` }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text" as const, text: `FAIL ${path} exists (not a directory)` }],
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
        await mkdir(path, { recursive: parents });
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `ERR create ${path}: ${e.message}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text" as const, text: `OK ${path} created` }],
      };
    }
  );
}
