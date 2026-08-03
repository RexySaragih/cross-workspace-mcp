import { existsSync, statSync } from "fs";
import { createRequire } from "module";
import { dirname, extname, join, resolve } from "path";
import defaultTs from "typescript";
import { z } from "zod";
import { limits } from "../config.js";
import { guardPath, isInside } from "../security/path-guard.js";
import { denied, err, fail, ok, type ToolResponse } from "../shared/response.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

type TypeScriptModule = typeof defaultTs;

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
const MAX_DIAGNOSTICS_CAP = 200;
const TIMEOUT_SENTINEL = "__diagnose_timeout__";

interface SourceFileCacheEntry {
  mtimeMs: number;
  file: defaultTs.SourceFile;
}

interface ProgramCacheEntry {
  program: defaultTs.Program;
  configMtimeMs: number;
  sourceFiles: Map<string, SourceFileCacheEntry>;
}

const programCache = new Map<string, ProgramCacheEntry>();

function mtimeOf(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Walks up for a tsconfig but stops at the project root, so a diagnose call
 * cannot pick up compiler settings from outside the sandbox.
 */
function findTsConfig(filePath: string, root: string): string | undefined {
  let directory = dirname(filePath);

  while (isInside(directory, root)) {
    const candidate = join(directory, "tsconfig.json");
    if (existsSync(candidate)) return candidate;

    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  return undefined;
}

/**
 * Prefers the target project's own TypeScript. Diagnosing with whatever version
 * this server bundles produces results that disagree with the project's build.
 */
function loadTypeScript(root: string): { ts: TypeScriptModule; source: string } {
  try {
    const requireFromProject = createRequire(join(root, "package.json"));
    const resolvedPath = requireFromProject.resolve("typescript");
    return {
      ts: requireFromProject(resolvedPath) as TypeScriptModule,
      source: "project",
    };
  } catch {
    return { ts: defaultTs, source: "bundled" };
  }
}

function assertWithinDeadline(deadline: number): void {
  if (Date.now() > deadline) throw new Error(TIMEOUT_SENTINEL);
}

/**
 * Caches parsed source files by mtime. This makes `oldProgram` reuse safe:
 * unchanged files are reused, while a file edited since the last call is
 * re-read, so diagnostics never reflect pre-edit content.
 */
function createCachingHost(
  ts: TypeScriptModule,
  options: defaultTs.CompilerOptions,
  cache: Map<string, SourceFileCacheEntry>,
  deadline: number
): defaultTs.CompilerHost {
  const host = ts.createCompilerHost(options);
  const readSourceFile = host.getSourceFile.bind(host);
  const readFile = host.readFile.bind(host);

  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    assertWithinDeadline(deadline);

    const mtimeMs = mtimeOf(fileName);
    const cached = cache.get(fileName);
    if (cached && mtimeMs !== null && cached.mtimeMs === mtimeMs) return cached.file;

    const file = readSourceFile(fileName, languageVersion, onError, shouldCreate);
    if (file && mtimeMs !== null) cache.set(fileName, { mtimeMs, file });
    return file;
  };

  host.readFile = (fileName) => {
    assertWithinDeadline(deadline);
    return readFile(fileName);
  };

  return host;
}

function resolveCompilerSettings(
  ts: TypeScriptModule,
  tsconfigPath: string | undefined,
  target: string
): { options: defaultTs.CompilerOptions; rootNames: string[] } {
  if (!tsconfigPath) {
    return {
      rootNames: [target],
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
    };
  }

  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, " "));
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    dirname(tsconfigPath)
  );

  return {
    options: parsed.options,
    rootNames: parsed.fileNames.includes(target)
      ? parsed.fileNames
      : [...parsed.fileNames, target],
  };
}

function getProgram(
  ts: TypeScriptModule,
  tsconfigPath: string | undefined,
  target: string,
  deadline: number
): defaultTs.Program {
  const cacheKey = tsconfigPath ?? `standalone:${target}`;
  const configMtimeMs = tsconfigPath ? (mtimeOf(tsconfigPath) ?? 0) : 0;

  const cached = programCache.get(cacheKey);
  const reusable = cached?.configMtimeMs === configMtimeMs ? cached : undefined;
  const sourceFiles = reusable?.sourceFiles ?? new Map<string, SourceFileCacheEntry>();

  const { options, rootNames } = resolveCompilerSettings(ts, tsconfigPath, target);
  const host = createCachingHost(ts, options, sourceFiles, deadline);

  const program = ts.createProgram({
    rootNames,
    options,
    host,
    oldProgram: reusable?.program,
  });

  programCache.set(cacheKey, { program, configMtimeMs, sourceFiles });
  return program;
}

function severityLabel(
  ts: TypeScriptModule,
  category: defaultTs.DiagnosticCategory
): string {
  if (category === ts.DiagnosticCategory.Error) return "error";
  if (category === ts.DiagnosticCategory.Warning) return "warn";
  if (category === ts.DiagnosticCategory.Suggestion) return "hint";
  return "info";
}

function formatDiagnostic(
  ts: TypeScriptModule,
  diagnostic: defaultTs.Diagnostic
): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
  const prefix = `${severityLabel(ts, diagnostic.category)} TS${diagnostic.code}`;

  if (!diagnostic.file || diagnostic.start === undefined) return `${prefix} ${message}`;

  const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(
    diagnostic.start
  );
  return `${line + 1}:${character + 1} ${prefix} ${message}`;
}

function summarize(
  ts: TypeScriptModule,
  diagnostics: readonly defaultTs.Diagnostic[]
): string {
  const errors = diagnostics.filter(
    (d) => d.category === ts.DiagnosticCategory.Error
  ).length;
  const warnings = diagnostics.filter(
    (d) => d.category === ts.DiagnosticCategory.Warning
  ).length;
  const other = diagnostics.length - errors - warnings;

  const parts: string[] = [];
  if (errors) parts.push(`${errors} error(s)`);
  if (warnings) parts.push(`${warnings} warning(s)`);
  if (other) parts.push(`${other} other`);
  return parts.join(", ") || "0 issues";
}

function validateTarget(path: string, target: string): ToolResponse | null {
  if (!SUPPORTED_EXTENSIONS.has(extname(target).toLowerCase())) {
    return fail(`FAIL ${path} unsupported type (use .ts/.tsx/.js/.jsx)`);
  }
  if (!existsSync(target)) return fail(`FAIL ${path} does not exist`);
  return null;
}

function renderDiagnostics(
  ts: TypeScriptModule,
  header: string,
  diagnostics: defaultTs.Diagnostic[],
  maxResults: number
): ToolResponse {
  if (diagnostics.length === 0) return ok(`OK ${header}\n0 issues`);

  const shown = diagnostics.slice(0, maxResults);
  const truncated =
    diagnostics.length > maxResults
      ? ` (showing ${maxResults}/${diagnostics.length})`
      : "";

  return ok(
    `OK ${header}\n${summarize(ts, diagnostics)}${truncated}\n${shown
      .map((diagnostic) => formatDiagnostic(ts, diagnostic))
      .join("\n")}`
  );
}

async function handleDiagnose({
  path,
  max_results,
}: {
  path: string;
  max_results: number;
}): Promise<ToolResponse> {
  const guard = guardPath(path);
  if (!guard.ok) return denied(path, guard);

  const target = resolve(guard.real);
  const invalid = validateTarget(path, target);
  if (invalid) return invalid;

  const { ts, source } = loadTypeScript(guard.root);
  const tsconfigPath = findTsConfig(target, guard.root);
  const deadline = Date.now() + limits.diagnoseTimeoutMs;

  let program: defaultTs.Program;
  try {
    program = getProgram(ts, tsconfigPath, target, deadline);
  } catch (error) {
    if (error instanceof Error && error.message === TIMEOUT_SENTINEL) {
      return fail(
        `FAIL ${path} diagnostics timed out after ${limits.diagnoseTimeoutMs}ms (raise WORKSPACE_DIAGNOSE_TIMEOUT_MS)`
      );
    }
    return err("diagnose", path, error);
  }

  const sourceFile = program.getSourceFile(target);
  if (!sourceFile) return fail(`FAIL ${path} could not load source file`);

  const diagnostics = [
    ...program.getSyntacticDiagnostics(sourceFile),
    ...program.getSemanticDiagnostics(sourceFile),
  ];

  const context = `${tsconfigPath ?? "no tsconfig"}, ts ${ts.version} (${source})`;
  return renderDiagnostics(ts, `${path} [${context}]`, diagnostics, max_results);
}

export function registerDiagnoseFile(server: McpServer): void {
  server.registerTool(
    "diagnose_project_file",
    {
      title: "Diagnose project file",
      description:
        "Run TypeScript/JavaScript diagnostics on a file outside the active workspace. Uses the nearest tsconfig.json for project context and the project's own TypeScript when available. Finding code errors is a successful response, not a tool failure.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        path: z.string().describe("Absolute path to the file to diagnose"),
        max_results: z
          .number()
          .int()
          .min(1)
          .max(MAX_DIAGNOSTICS_CAP)
          .optional()
          .default(DEFAULT_MAX_DIAGNOSTICS)
          .describe(`Max diagnostics to return (default: ${DEFAULT_MAX_DIAGNOSTICS})`),
      },
    },
    handleDiagnose
  );
}
