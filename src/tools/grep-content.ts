import { readFile, stat } from "fs/promises";
import { extname } from "path";
import { z } from "zod";
import { DEFAULT_GREP_EXTENSIONS, limits } from "../config.js";
import { looksBinary } from "../shared/fs-utils.js";
import { fail, ok, type ToolResponse } from "../shared/response.js";
import { projectNames, resolveRoots } from "../shared/roots.js";
import { walkFiles } from "../shared/walk.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const MAX_QUERY_LENGTH = 1000;
const MAX_LINE_PREVIEW_CHARS = 200;

interface GrepMatch {
  file: string;
  line: number;
  text: string;
}

function buildPattern(query: string): RegExp {
  try {
    return new RegExp(query, "i");
  } catch {
    return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
}

function parseExtensions(raw: string | undefined): string[] {
  if (!raw) return DEFAULT_GREP_EXTENSIONS;
  const parsed = raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0)
    .map((item) => (item.startsWith(".") ? item : `.${item}`));
  return parsed.length > 0 ? parsed : DEFAULT_GREP_EXTENSIONS;
}

async function collectMatches(
  path: string,
  pattern: RegExp,
  results: GrepMatch[]
): Promise<void> {
  const { size } = await stat(path);
  if (size > limits.maxGrepFileBytes) return;

  const buffer = await readFile(path);
  if (looksBinary(buffer)) return;

  const lines = buffer.toString("utf-8").split("\n");
  for (let index = 0; index < lines.length; index++) {
    if (results.length >= limits.maxGrepResults) return;
    if (!pattern.test(lines[index])) continue;
    results.push({
      file: path,
      line: index + 1,
      text: lines[index].trim().slice(0, MAX_LINE_PREVIEW_CHARS),
    });
  }
}

interface GrepRequest {
  query: string;
  project?: string;
  extensions?: string;
}

function renderResults(
  query: string,
  results: GrepMatch[],
  timedOut: boolean
): ToolResponse {
  if (results.length === 0) return ok(`No matches found for "${query}"`);

  const capped = results.length >= limits.maxGrepResults ? " (result cap reached)" : "";
  const budget = timedOut ? " (time budget reached)" : "";
  const body = results
    .map((match) => `${match.file}:${match.line}\n  ${match.text}`)
    .join("\n\n");

  return ok(`Found ${results.length} match(es)${capped}${budget}:\n\n${body}`);
}

async function handleGrep({
  query,
  project,
  extensions,
}: GrepRequest): Promise<ToolResponse> {
  const roots = resolveRoots(project);
  if (roots.length === 0) {
    return fail(
      `FAIL no project matches "${project}" (available: ${projectNames().join(", ") || "none"})`
    );
  }

  const allowAllExtensions = extensions?.trim() === "*";
  const allowed = allowAllExtensions ? [] : parseExtensions(extensions);
  const pattern = buildPattern(query);
  const results: GrepMatch[] = [];
  const deadline = Date.now() + limits.grepTimeBudgetMs;

  for (const root of roots) {
    if (results.length >= limits.maxGrepResults) break;
    await walkFiles(root, {
      deadline,
      onFile: async ({ path }) => {
        const included =
          allowAllExtensions || allowed.includes(extname(path).toLowerCase());

        if (included) {
          try {
            await collectMatches(path, pattern, results);
          } catch {
            // Unreadable or vanished mid-walk; not worth failing the search.
          }
        }
        return results.length < limits.maxGrepResults;
      },
    });
  }

  return renderResults(query, results, Date.now() > deadline);
}

export function registerGrepContent(server: McpServer): void {
  server.registerTool(
    "grep_project_content",
    {
      title: "Grep project content",
      description:
        "Search file contents across allowed project workspaces using a text or regex pattern. Returns matching lines with file paths and line numbers. Defaults to common text/source extensions; pass `extensions` to widen or narrow.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        query: z
          .string()
          .min(1)
          .max(MAX_QUERY_LENGTH)
          .describe("Text or regex pattern to search for"),
        project: z
          .string()
          .optional()
          .describe("Optional: limit search to a specific project directory name"),
        extensions: z
          .string()
          .optional()
          .describe(
            "Optional: comma-separated extensions to include (e.g. '.ts,.tsx'). Use '*' for all text files."
          ),
      },
    },
    handleGrep
  );
}
