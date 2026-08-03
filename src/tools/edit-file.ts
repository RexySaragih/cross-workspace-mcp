import { readFile } from "fs/promises";
import { z } from "zod";
import { limits } from "../config.js";
import { guardPath } from "../security/path-guard.js";
import { formatBytes, looksBinary, writeFileAtomic } from "../shared/fs-utils.js";
import { denied, err, fail, ok, type ToolResponse } from "../shared/response.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const MAX_EDITS_PER_CALL = 20;

interface Edit {
  old_string: string;
  new_string: string;
  replace_all: boolean;
}

type EditOutcome =
  | { ok: true; content: string; applied: number; delta: number }
  | { ok: false; error: string };

function countOccurrences(content: string, search: string): number {
  if (search === "") return 0;
  let count = 0;
  let index = content.indexOf(search);
  while (index !== -1) {
    count++;
    index = content.indexOf(search, index + search.length);
  }
  return count;
}

function applyEdit(content: string, edit: Edit): string {
  if (edit.replace_all) return content.split(edit.old_string).join(edit.new_string);

  const index = content.indexOf(edit.old_string);
  return (
    content.slice(0, index) +
    edit.new_string +
    content.slice(index + edit.old_string.length)
  );
}

function validate(content: string, edit: Edit, position: string): string | null {
  if (edit.old_string === "") return `edit ${position}: old_string is empty`;

  const occurrences = countOccurrences(content, edit.old_string);
  if (occurrences === 0) return `edit ${position}: old_string not found`;
  if (!edit.replace_all && occurrences > 1) {
    return `edit ${position}: ${occurrences} matches (set replace_all or use a unique old_string)`;
  }
  return null;
}

/** Every edit is applied to an in-memory copy first; nothing is written unless all succeed. */
function applyEdits(content: string, edits: Edit[]): EditOutcome {
  let current = content;

  for (const [index, edit] of edits.entries()) {
    const position = `${index + 1}/${edits.length}`;
    const problem = validate(current, edit, position);
    if (problem) return { ok: false, error: problem };
    current = applyEdit(current, edit);
  }

  return {
    ok: true,
    content: current,
    applied: edits.length,
    delta: current.length - content.length,
  };
}

async function loadEditableContent(
  path: string,
  real: string
): Promise<{ ok: true; content: string } | { ok: false; response: ToolResponse }> {
  try {
    const buffer = await readFile(real);
    if (buffer.length > limits.maxReadBytes) {
      return {
        ok: false,
        response: fail(
          `FAIL ${path} too large to edit (${formatBytes(buffer.length)} > ${formatBytes(limits.maxReadBytes)})`
        ),
      };
    }
    if (looksBinary(buffer)) {
      return { ok: false, response: fail(`FAIL ${path} looks binary`) };
    }
    return { ok: true, content: buffer.toString("utf-8") };
  } catch (error) {
    return { ok: false, response: err("read", path, error) };
  }
}

async function handleEdit({
  path,
  edits,
}: {
  path: string;
  edits: Edit[];
}): Promise<ToolResponse> {
  const guard = guardPath(path, { write: true });
  if (!guard.ok) return denied(path, guard);

  const loaded = await loadEditableContent(path, guard.real);
  if (!loaded.ok) return loaded.response;

  const result = applyEdits(loaded.content, edits);
  if (!result.ok) return fail(`FAIL ${path} ${result.error}`);
  if (result.content === loaded.content) return ok(`OK ${path} 0 edits (no changes)`);

  try {
    await writeFileAtomic(guard.real, result.content);
  } catch (error) {
    return err("write", path, error);
  }

  const sign = result.delta >= 0 ? `+${result.delta}` : `${result.delta}`;
  return ok(`OK ${path} ${result.applied} edit(s) Δ${sign}b`);
}

export function registerEditFile(server: McpServer): void {
  server.registerTool(
    "edit_project_file",
    {
      title: "Edit project file",
      description:
        "Apply targeted search/replace edits to a file outside the active workspace. All edits are validated before anything is written, and the write itself is atomic. Returns a one-line summary (no file content) to save tokens.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        path: z.string().describe("Absolute path to the file"),
        edits: z
          .array(
            z.object({
              old_string: z.string().describe("Exact text to find"),
              new_string: z.string().describe("Replacement text"),
              replace_all: z
                .boolean()
                .optional()
                .default(false)
                .describe("Replace every match (default: require exactly one)"),
            })
          )
          .min(1)
          .max(MAX_EDITS_PER_CALL)
          .describe("Edits applied in order; all must succeed before writing"),
      },
    },
    handleEdit
  );
}
