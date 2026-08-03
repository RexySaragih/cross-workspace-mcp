import { z } from "zod";
import { performWrite } from "../shared/write-ops.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerWriteFile(server: McpServer): void {
  server.registerTool(
    "write_project_file",
    {
      title: "Write project file",
      description:
        "Create or overwrite a file outside the active workspace. Creates parent directories as needed. Writes are atomic (temp file plus rename). Returns a one-line summary (no file content) to save tokens.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        path: z.string().describe("Absolute path to the file"),
        content: z.string().describe("Full file content to write"),
        create_only: z
          .boolean()
          .optional()
          .default(false)
          .describe("If true, fail when the file already exists"),
      },
    },
    async ({ path, content, create_only }) =>
      performWrite({ path, content, createOnly: create_only })
  );
}
