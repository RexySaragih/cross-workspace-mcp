import { readFile } from "fs/promises";
import { z } from "zod";
import { limits } from "../config.js";
import { guardPath } from "../security/path-guard.js";
import { fileSize, formatBytes, looksBinary } from "../shared/fs-utils.js";
import { denied, err, fail, ok, type ToolResponse } from "../shared/response.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const MAX_LINES_PER_READ = 2000;

function renderLines(lines: string[], startLine: number): string {
  return lines.map((line, index) => `${startLine + index}|${line}`).join("\n");
}

interface ReadRequest {
  path: string;
  offset?: number;
  limit?: number;
}

async function handleRead({ path, offset, limit }: ReadRequest): Promise<ToolResponse> {
  const guard = guardPath(path);
  if (!guard.ok) return denied(path, guard);

  try {
    const size = await fileSize(guard.real);
    if (size > limits.maxReadBytes) {
      return fail(
        `FAIL ${path} too large (${formatBytes(size)} > ${formatBytes(limits.maxReadBytes)}); use offset/limit or raise WORKSPACE_MAX_READ_BYTES`
      );
    }

    const buffer = await readFile(guard.real);
    if (looksBinary(buffer)) {
      return fail(`FAIL ${path} looks binary (${formatBytes(size)})`);
    }

    const content = buffer.toString("utf-8");
    const lines = content.split("\n");
    const total = lines.length;

    if (offset === undefined && limit === undefined) {
      return ok(`${path} ${total}L\n${content}`);
    }

    const start = (offset ?? 1) - 1;
    if (start >= total) {
      return fail(`FAIL ${path} offset ${offset} beyond end of file (${total}L)`);
    }

    const slice = lines.slice(start, start + (limit ?? MAX_LINES_PER_READ));
    const header = `${path} L${start + 1}-${start + slice.length}/${total}`;
    return ok(`${header}\n${renderLines(slice, start + 1)}`);
  } catch (error) {
    return err("read", path, error);
  }
}

export function registerReadFile(server: McpServer): void {
  server.registerTool(
    "read_project_file",
    {
      title: "Read project file",
      description:
        "Read a file from any allowed project workspace. Use offset/limit to read a line range and save tokens.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
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
          .max(MAX_LINES_PER_READ)
          .optional()
          .describe(`Max lines to return (max ${MAX_LINES_PER_READ})`),
      },
    },
    handleRead
  );
}
