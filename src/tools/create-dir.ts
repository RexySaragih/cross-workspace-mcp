import { mkdir, stat } from "fs/promises";
import { z } from "zod";
import { guardPath } from "../security/path-guard.js";
import { denied, err, fail, ok } from "../shared/response.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerCreateDir(server: McpServer): void {
  server.registerTool(
    "create_project_dir",
    {
      title: "Create project directory",
      description:
        "Create a new folder outside the active workspace. Fails if the folder already exists. Optionally creates parent directories. Returns a one-line summary.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        path: z.string().describe("Absolute path for the new directory"),
        parents: z
          .boolean()
          .optional()
          .default(true)
          .describe("Create parent directories if needed (default: true)"),
      },
    },
    async ({ path, parents }) => {
      const guard = guardPath(path, { write: true });
      if (!guard.ok) return denied(path, guard);

      try {
        const info = await stat(guard.real);
        return fail(
          info.isDirectory()
            ? `FAIL ${path} already exists`
            : `FAIL ${path} exists (not a directory)`
        );
      } catch (error) {
        const code = error instanceof Error && "code" in error ? error.code : null;
        if (code !== "ENOENT") return err("stat", path, error);
      }

      try {
        // `recursive` is deliberately false when parents are not requested, so a
        // missing parent surfaces as ENOENT rather than being created silently.
        await mkdir(guard.real, { recursive: parents });
        return ok(`OK ${path} created`);
      } catch (error) {
        return err("create", path, error);
      }
    }
  );
}
