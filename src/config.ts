import { resolve } from "path";
import { readdirSync, statSync } from "fs";

/**
 * Cross-Workspace MCP Server Configuration
 *
 * Base directory is configurable via WORKSPACE_BASE_DIR env var.
 * Defaults to ~/Documents if not set.
 *
 * Project pattern is configurable via WORKSPACE_PATTERN env var.
 * Defaults to "krom-*" if not set.
 */
export const WORKSPACE_BASE_DIR =
  process.env.WORKSPACE_BASE_DIR || "/Users/johanes.saragih/Documents";

export const WORKSPACE_PATTERN = process.env.WORKSPACE_PATTERN || "krom-*";

/**
 * Dynamically discover allowed roots by scanning WORKSPACE_BASE_DIR
 * for directories matching WORKSPACE_PATTERN (supports glob-like prefix matching)
 */
function discoverAllowedRoots(): string[] {
  const pattern = WORKSPACE_PATTERN.replace("*", "");

  try {
    const entries = readdirSync(WORKSPACE_BASE_DIR, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && e.name.startsWith(pattern))
      .map((e) => resolve(WORKSPACE_BASE_DIR, e.name));
  } catch {
    return [];
  }
}

export const ALLOWED_ROOTS: string[] = discoverAllowedRoots();

/**
 * Directories to skip during recursive file searches
 */
export const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".nuxt",
  "dist",
  "build",
  ".turbo",
  ".cache",
  "coverage",
  ".kiro",
]);

/**
 * Maximum recursion depth for file searches
 */
export const MAX_SEARCH_DEPTH = 8;

/**
 * Maximum number of results returned from search
 */
export const MAX_SEARCH_RESULTS = 100;

/**
 * Check if a given path is within allowed project roots
 */
export function isAllowedPath(filePath: string): boolean {
  const resolved = resolve(filePath);
  return ALLOWED_ROOTS.some((root) => resolved.startsWith(root));
}
