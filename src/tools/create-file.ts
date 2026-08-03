import { z } from "zod";
import { performWrite } from "../shared/write-ops.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerCreateFile(server: McpServer): void {
  server.registerTool(
    "create_project_file",
    {
      title: "Create project file",
      description:
        "Create a new file outside the active workspace. Fails if the file already exists. Creates parent directories as needed. Returns a one-line summary (no file content).",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        path: z.string().describe("Absolute path for the new file"),
        content: z
          .string()
          .optional()
          .default("")
          .describe("Initial file content (default: empty file)"),
      },
    },
    async ({ path, content }) => performWrite({ path, content, createOnly: true })
  );
}
