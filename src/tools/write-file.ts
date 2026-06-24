import { z } from "zod";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";
import { isAllowedPath } from "../config.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerWriteFile(server: McpServer) {
  server.tool(
    "write_project_file",
    "Create or overwrite a file outside the active workspace. Creates parent directories as needed. Returns a one-line summary (no file content) to save tokens.",
    {
      path: z.string().describe("Absolute path to the file"),
      content: z.string().describe("Full file content to write"),
      create_only: z
        .boolean()
        .optional()
        .default(false)
        .describe("If true, fail when the file already exists"),
    },
    async ({ path, content, create_only }) => {
      if (!isAllowedPath(path)) {
        return {
          content: [{ type: "text" as const, text: `DENIED ${path}` }],
          isError: true,
        };
      }

      let existed = false;
      if (create_only) {
        try {
          await readFile(path);
          existed = true;
        } catch (e: any) {
          if (e.code !== "ENOENT") {
            return {
              content: [{ type: "text" as const, text: `ERR ${path}: ${e.message}` }],
              isError: true,
            };
          }
        }

        if (existed) {
          return {
            content: [{ type: "text" as const, text: `FAIL ${path} already exists` }],
            isError: true,
          };
        }
      } else {
        try {
          await readFile(path);
          existed = true;
        } catch {
          existed = false;
        }
      }

      try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content, "utf-8");
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `ERR write ${path}: ${e.message}` }],
          isError: true,
        };
      }

      const action = existed ? "updated" : "created";
      const lines = content.split("\n").length;
      return {
        content: [
          {
            type: "text" as const,
            text: `OK ${path} ${action} ${content.length}b ${lines}L`,
          },
        ],
      };
    }
  );
}
