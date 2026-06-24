import { z } from "zod";
import { access } from "fs/promises";
import { constants, existsSync } from "fs";
import { dirname, extname, resolve } from "path";
import ts from "typescript";
import { isAllowedPath } from "../config.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const SUPPORTED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
]);

const DEFAULT_MAX_DIAGNOSTICS = 50;
const MAX_DIAGNOSTICS_CAP = 100;

function findTsConfig(filePath: string): string | undefined {
  let dir = dirname(resolve(filePath));

  while (true) {
    const candidate = resolve(dir, "tsconfig.json");
    if (existsSync(candidate)) return candidate;

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return undefined;
}

function createProgram(filePath: string): ts.Program {
  const resolved = resolve(filePath);
  const tsconfigPath = findTsConfig(resolved);

  if (tsconfigPath) {
    const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    if (configFile.error) {
      throw new Error(
        ts.flattenDiagnosticMessageText(configFile.error.messageText, " ")
      );
    }

    const configDir = dirname(tsconfigPath);
    const parsed = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      configDir
    );

    const rootNames = parsed.fileNames.includes(resolved)
      ? parsed.fileNames
      : [...parsed.fileNames, resolved];

    return ts.createProgram({
      rootNames,
      options: parsed.options,
      host: ts.createCompilerHost(parsed.options),
    });
  }

  return ts.createProgram({
    rootNames: [resolved],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      allowJs: true,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
    host: ts.createCompilerHost({}),
  });
}

function severityLabel(category: ts.DiagnosticCategory): string {
  switch (category) {
    case ts.DiagnosticCategory.Error:
      return "error";
    case ts.DiagnosticCategory.Warning:
      return "warn";
    case ts.DiagnosticCategory.Suggestion:
      return "hint";
    default:
      return "info";
  }
}

function formatDiagnostic(diag: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diag.messageText, " ");
  const severity = severityLabel(diag.category);
  const code = `TS${diag.code}`;

  if (diag.file && diag.start !== undefined) {
    const { line, character } = diag.file.getLineAndCharacterOfPosition(diag.start);
    return `${line + 1}:${character + 1} ${severity} ${code} ${message}`;
  }

  return `${severity} ${code} ${message}`;
}

function summarize(counts: { errors: number; warnings: number; other: number }): string {
  const parts: string[] = [];
  if (counts.errors) parts.push(`${counts.errors} error(s)`);
  if (counts.warnings) parts.push(`${counts.warnings} warning(s)`);
  if (counts.other) parts.push(`${counts.other} other`);
  return parts.length > 0 ? parts.join(", ") : "0 issues";
}

export function registerDiagnoseFile(server: McpServer) {
  server.tool(
    "diagnose_project_file",
    "Run TypeScript/JavaScript diagnostics on a file outside the active workspace. Uses the nearest tsconfig.json for project context. Returns compact one-line issues to save tokens.",
    {
      path: z.string().describe("Absolute path to the file to diagnose"),
      max_results: z
        .number()
        .int()
        .min(1)
        .max(MAX_DIAGNOSTICS_CAP)
        .optional()
        .default(DEFAULT_MAX_DIAGNOSTICS)
        .describe("Max diagnostics to return (default: 50)"),
    },
    async ({ path, max_results }) => {
      if (!isAllowedPath(path)) {
        return {
          content: [{ type: "text" as const, text: `DENIED ${path}` }],
          isError: true,
        };
      }

      const resolved = resolve(path);
      const ext = extname(resolved).toLowerCase();

      if (!SUPPORTED_EXTENSIONS.has(ext)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `FAIL ${path} unsupported type (use .ts/.tsx/.js/.jsx)`,
            },
          ],
          isError: true,
        };
      }

      try {
        await access(resolved, constants.F_OK);
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `ERR ${path}: ${e.message}` }],
          isError: true,
        };
      }

      let program: ts.Program;
      try {
        program = createProgram(resolved);
      } catch (e: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `ERR diagnose ${path}: ${e.message}`,
            },
          ],
          isError: true,
        };
      }

      const sourceFile = program.getSourceFile(resolved);
      if (!sourceFile) {
        return {
          content: [
            {
              type: "text" as const,
              text: `FAIL ${path} could not load source file`,
            },
          ],
          isError: true,
        };
      }

      const diagnostics = [
        ...program.getSyntacticDiagnostics(sourceFile),
        ...program.getSemanticDiagnostics(sourceFile),
      ];

      const counts = { errors: 0, warnings: 0, other: 0 };
      for (const diag of diagnostics) {
        if (diag.category === ts.DiagnosticCategory.Error) counts.errors++;
        else if (diag.category === ts.DiagnosticCategory.Warning) counts.warnings++;
        else counts.other++;
      }

      const tsconfigPath = findTsConfig(resolved);
      const header = tsconfigPath
        ? `${path} [${tsconfigPath}]`
        : `${path} [no tsconfig]`;

      if (diagnostics.length === 0) {
        return {
          content: [{ type: "text" as const, text: `OK ${header}\n0 issues` }],
        };
      }

      const shown = diagnostics.slice(0, max_results);
      const lines = shown.map(formatDiagnostic);
      const summary = summarize(counts);
      const truncated =
        diagnostics.length > max_results
          ? ` (showing ${max_results}/${diagnostics.length})`
          : "";

      return {
        content: [
          {
            type: "text" as const,
            text: `OK ${header}\n${summary}${truncated}\n${lines.join("\n")}`,
          },
        ],
      };
    }
  );
}
