import { mkdir, writeFile } from "fs/promises";
import { dirname } from "path";
import { guardPath } from "../security/path-guard.js";
import { exists, writeFileAtomic } from "./fs-utils.js";
import { denied, err, fail, ok, type ToolResponse } from "./response.js";

export interface WriteRequest {
  path: string;
  content: string;
  createOnly: boolean;
}

function summarize(path: string, action: string, content: string): ToolResponse {
  const lines = content.length === 0 ? 0 : content.split("\n").length;
  return ok(`OK ${path} ${action} ${content.length}b ${lines}L`);
}

/**
 * Shared by `write_project_file` and `create_project_file` so both paths get
 * identical guarding, parent creation and reporting.
 */
export async function performWrite(request: WriteRequest): Promise<ToolResponse> {
  const { path, content, createOnly } = request;

  const guard = guardPath(path, { write: true });
  if (!guard.ok) return denied(path, guard);

  try {
    await mkdir(dirname(guard.real), { recursive: true });

    if (createOnly) {
      // `wx` makes the existence check and the create one atomic step, so two
      // concurrent creates cannot both believe they won.
      await writeFile(guard.real, content, { encoding: "utf-8", flag: "wx" });
      return summarize(path, "created", content);
    }

    const existed = await exists(guard.real);
    await writeFileAtomic(guard.real, content);
    return summarize(path, existed ? "updated" : "created", content);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      return fail(`FAIL ${path} already exists`);
    }
    return err("write", path, error);
  }
}
