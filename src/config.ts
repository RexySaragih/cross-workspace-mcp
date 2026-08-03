import { readdirSync, realpathSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = BYTES_PER_KB * BYTES_PER_KB;

const DEFAULT_MAX_READ_BYTES = 5 * BYTES_PER_MB;
const DEFAULT_MAX_BATCH_READ_BYTES = 256 * BYTES_PER_KB;
const DEFAULT_MAX_BATCH_READ_PATHS = 50;
const DEFAULT_MAX_GREP_FILE_BYTES = 2 * BYTES_PER_MB;
const DEFAULT_MAX_LIST_ENTRIES = 1000;
const DEFAULT_MAX_SEARCH_DEPTH = 8;
const DEFAULT_MAX_SEARCH_RESULTS = 100;
const DEFAULT_MAX_GREP_RESULTS = 50;
const DEFAULT_GREP_TIME_BUDGET_MS = 15_000;
const DEFAULT_DIAGNOSE_TIMEOUT_MS = 60_000;
const DEFAULT_ROOTS_TTL_MS = 30_000;

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envList(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const items = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : fallback;
}

/**
 * Canonicalises a directory so later boundary checks compare like with like.
 * On macOS `/tmp` is a symlink to `/private/tmp`; without this every root
 * configured under `/tmp` would fail to match its own children.
 */
function toRealPath(path: string): string {
  try {
    return realpathSync(resolve(path));
  } catch {
    return resolve(path);
  }
}

export const WORKSPACE_BASE_DIR = toRealPath(
  process.env.WORKSPACE_BASE_DIR || resolve(homedir(), "Documents")
);

export const WORKSPACE_PATTERNS = envList("WORKSPACE_PATTERN", ["krom-*"]);

export const limits = {
  maxReadBytes: envInt("WORKSPACE_MAX_READ_BYTES", DEFAULT_MAX_READ_BYTES),
  maxBatchReadBytes: envInt(
    "WORKSPACE_MAX_BATCH_READ_BYTES",
    DEFAULT_MAX_BATCH_READ_BYTES
  ),
  maxBatchReadPaths: envInt(
    "WORKSPACE_MAX_BATCH_READ_PATHS",
    DEFAULT_MAX_BATCH_READ_PATHS
  ),
  maxGrepFileBytes: envInt(
    "WORKSPACE_MAX_GREP_FILE_BYTES",
    DEFAULT_MAX_GREP_FILE_BYTES
  ),
  maxListEntries: envInt("WORKSPACE_MAX_LIST_ENTRIES", DEFAULT_MAX_LIST_ENTRIES),
  maxSearchDepth: envInt("WORKSPACE_MAX_SEARCH_DEPTH", DEFAULT_MAX_SEARCH_DEPTH),
  maxSearchResults: envInt("WORKSPACE_MAX_SEARCH_RESULTS", DEFAULT_MAX_SEARCH_RESULTS),
  maxGrepResults: envInt("WORKSPACE_MAX_GREP_RESULTS", DEFAULT_MAX_GREP_RESULTS),
  grepTimeBudgetMs: envInt(
    "WORKSPACE_GREP_TIME_BUDGET_MS",
    DEFAULT_GREP_TIME_BUDGET_MS
  ),
  diagnoseTimeoutMs: envInt(
    "WORKSPACE_DIAGNOSE_TIMEOUT_MS",
    DEFAULT_DIAGNOSE_TIMEOUT_MS
  ),
} as const;

/**
 * Opt-in hardening. Defaults preserve 1.x behaviour so existing installs do
 * not change semantics on upgrade; the path sandbox itself is never optional.
 */
export const features = {
  readOnly: envBool("WORKSPACE_READONLY", false),
  protectSensitiveFiles: envBool("WORKSPACE_PROTECT_SENSITIVE", false),
  softDelete: envBool("WORKSPACE_SOFT_DELETE", false),
  respectGitignore: envBool("WORKSPACE_RESPECT_GITIGNORE", false),
} as const;

export const PROTECTED_PATTERNS = envList("WORKSPACE_PROTECTED_PATTERNS", [
  ".git/**",
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "id_rsa*",
  ".ssh/**",
  ".npmrc",
]);

export const IGNORED_DIRS = new Set([
  ".cache",
  ".git",
  ".gradle",
  ".idea",
  ".next",
  ".nuxt",
  ".terraform",
  ".turbo",
  ".venv",
  ".kiro",
  "Pods",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "venv",
  "vendor",
]);

/**
 * Extensions grepped when the caller does not narrow the search. Without this
 * every binary in the tree is decoded as UTF-8, which never throws and so
 * silently emits replacement characters into results.
 */
export const DEFAULT_GREP_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".env",
  ".md",
  ".mdx",
  ".txt",
  ".html",
  ".css",
  ".scss",
  ".less",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".kts",
  ".swift",
  ".php",
  ".sh",
  ".bash",
  ".zsh",
  ".sql",
  ".graphql",
  ".prisma",
  ".vue",
  ".svelte",
  ".proto",
  ".tf",
  ".gradle",
  ".xml",
];

function matchesAnyPattern(name: string, patterns: string[]): boolean {
  return patterns.some((pattern) => wildcardToRegExp(pattern).test(name));
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function discoverAllowedRoots(): string[] {
  try {
    return readdirSync(WORKSPACE_BASE_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => matchesAnyPattern(entry.name, WORKSPACE_PATTERNS))
      .map((entry) => toRealPath(resolve(WORKSPACE_BASE_DIR, entry.name)));
  } catch {
    return [];
  }
}

let cachedRoots: string[] = discoverAllowedRoots();
let cachedAt = Date.now();

/**
 * Roots are re-scanned on a short TTL so a newly cloned project becomes
 * visible without restarting the server.
 */
export function getAllowedRoots(): string[] {
  if (Date.now() - cachedAt > DEFAULT_ROOTS_TTL_MS) refreshAllowedRoots();
  return cachedRoots;
}

export function refreshAllowedRoots(): string[] {
  cachedRoots = discoverAllowedRoots();
  cachedAt = Date.now();
  return cachedRoots;
}

/**
 * Explains why discovery came back empty, so a misconfigured base directory or
 * pattern is reported instead of surfacing as a bare "no projects found".
 */
export function describeDiscovery(): string {
  const patterns = WORKSPACE_PATTERNS.join(", ");
  try {
    const dirCount = readdirSync(WORKSPACE_BASE_DIR, {
      withFileTypes: true,
    }).filter((entry) => entry.isDirectory()).length;
    return `base=${WORKSPACE_BASE_DIR} pattern=${patterns} dirs_scanned=${dirCount} matched=${getAllowedRoots().length}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `base=${WORKSPACE_BASE_DIR} pattern=${patterns} UNREADABLE: ${message}`;
  }
}
