import { z } from "zod";
import { readFile } from "fs/promises";
import { isAllowedPath } from "../config.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerReadFile(server: McpServer) {
  server.tool(
    "read_project_file",
    "Read a file from any allowed project workspace. Returns the file content as text.",
    {
      path: z.string().describe("Absolute path to the file to read"),
    },
    async ({ path }) => {
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
        const content = await readFile(path, "utf-8");
        return {
          content: [{ type: "text" as const, text: content }],
        };
      } catch (e: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error reading file: ${e.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
