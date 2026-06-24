import { z } from "zod";
import { unlink } from "fs/promises";
import { isAllowedPath } from "../config.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerDeleteFile(server: McpServer) {
  server.tool(
    "delete_project_file",
    "Delete a file outside the active workspace. Returns a one-line summary to save tokens.",
    {
      path: z.string().describe("Absolute path to the file to delete"),
    },
    async ({ path }) => {
      if (!isAllowedPath(path)) {
        return {
          content: [{ type: "text" as const, text: `DENIED ${path}` }],
          isError: true,
        };
      }

      try {
        await unlink(path);
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `ERR delete ${path}: ${e.message}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text" as const, text: `OK ${path} deleted` }],
      };
    }
  );
}
