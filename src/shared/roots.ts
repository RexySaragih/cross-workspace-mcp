import { basename } from "path";
import { getAllowedRoots } from "../config.js";

/**
 * Matches on the directory name rather than the full path. Matching the whole
 * absolute path lets a substring of the base directory match every root, which
 * silently turns a project-scoped search into a global one.
 */
export function resolveRoots(project?: string): string[] {
  const roots = getAllowedRoots();
  if (!project) return roots;

  const needle = project.toLowerCase();
  const exact = roots.filter((root) => basename(root).toLowerCase() === needle);
  if (exact.length > 0) return exact;

  return roots.filter((root) => basename(root).toLowerCase().includes(needle));
}

export function projectNames(): string[] {
  return getAllowedRoots().map((root) => basename(root));
}
