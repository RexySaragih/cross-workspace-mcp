import { mkdir, rename, stat, unlink } from "fs/promises";
import { basename, join } from "path";
import { z } from "zod";
import { features } from "../config.js";
import { guardPath } from "../security/path-guard.js";
import { denied, err, fail, ok } from "../shared/response.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const TRASH_DIR_NAME = ".workspace-trash";

async function moveToTrash(real: string, root: string): Promise<string> {
  const trashDir = join(root, TRASH_DIR_NAME);
  await mkdir(trashDir, { recursive: true });

  const destination = join(trashDir, `${Date.now()}-${basename(real)}`);
  await rename(real, destination);
  return destination;
}

export function registerDeleteFile(server: McpServer): void {
  server.registerTool(
    "delete_project_file",
    {
      title: "Delete project file",
      description:
        "Delete a file outside the active workspace. Directories are refused. Set WORKSPACE_SOFT_DELETE=true to move files to a trash folder instead of unlinking. Returns a one-line summary.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        path: z.string().describe("Absolute path to the file to delete"),
      },
    },
    async ({ path }) => {
      const guard = guardPath(path, { write: true });
      if (!guard.ok) return denied(path, guard);

      try {
        const info = await stat(guard.real);
        if (info.isDirectory()) {
          return fail(`FAIL ${path} is a directory (this tool deletes files only)`);
        }

        if (features.softDelete) {
          const destination = await moveToTrash(guard.real, guard.root);
          return ok(`OK ${path} moved to trash -> ${destination}`);
        }

        await unlink(guard.real);
        return ok(`OK ${path} deleted`);
      } catch (error) {
        return err("delete", path, error);
      }
    }
  );
}
