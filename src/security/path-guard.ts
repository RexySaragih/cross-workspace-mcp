import { existsSync, realpathSync } from "fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "path";
import { PROTECTED_PATTERNS, features, getAllowedRoots } from "../config.js";

export type GuardFailure =
  "not_absolute" | "no_roots" | "outside_roots" | "protected_path" | "readonly_mode";

export type GuardResult =
  | { ok: true; real: string; root: string }
  | { ok: false; reason: GuardFailure; message: string };

export interface GuardOptions {
  /** Enforces read-only mode and the protected-path deny list. */
  write?: boolean;
}

/**
 * Resolves a path through any symlinks, walking up to the nearest existing
 * ancestor so that not-yet-created targets can still be canonicalised.
 *
 * Lexical resolution alone is not enough: `resolve()` collapses `..` but keeps
 * symlinks intact, so a link planted inside an allowed root would otherwise
 * pass the boundary check while pointing anywhere on disk.
 */
export function resolveReal(input: string): string {
  const absolute = resolve(input);
  const unresolvedTail: string[] = [];
  let cursor = absolute;

  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) return absolute;
    unresolvedTail.unshift(basename(cursor));
    cursor = parent;
  }

  try {
    return resolve(realpathSync(cursor), ...unresolvedTail);
  } catch {
    return absolute;
  }
}

/**
 * Containment test that respects path segment boundaries, so root `/x/app`
 * does not match the unrelated sibling `/x/app-secrets`.
 */
export function isInside(child: string, root: string): boolean {
  return child === root || child.startsWith(root + sep);
}

function globToRegExp(glob: string): RegExp {
  const doubleStar = "\u0000";
  const pattern = glob
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, doubleStar)
    .replace(/\*/g, "[^/]*")
    .split(doubleStar)
    .join(".*");
  return new RegExp(`^${pattern}$`);
}

function expandPattern(pattern: string): string[] {
  const suffix = "/**";
  return pattern.endsWith(suffix)
    ? [pattern, pattern.slice(0, -suffix.length)]
    : [pattern];
}

/**
 * Matches at every depth so a nested `.git` or `.env` is protected too, not
 * only one sitting directly at the project root.
 */
function matchesProtectedPattern(relativePath: string, pattern: string): boolean {
  const normalized = relativePath.split(sep).join("/");

  if (!pattern.includes("/")) {
    return globToRegExp(pattern).test(basename(normalized));
  }

  const segments = normalized.split("/");
  return expandPattern(pattern).some((candidate) => {
    const regex = globToRegExp(candidate);
    return segments.some((_, index) => regex.test(segments.slice(index).join("/")));
  });
}

export function isProtectedPath(real: string, root: string): boolean {
  const relativePath = relative(root, real);
  return PROTECTED_PATTERNS.some((pattern) =>
    matchesProtectedPattern(relativePath, pattern)
  );
}

/**
 * Single gate every tool must pass a path through before touching the file
 * system. Callers must use the returned `real` path for the actual operation;
 * reusing the caller-supplied path would re-follow the symlink just rejected.
 */
export function guardPath(input: string, options: GuardOptions = {}): GuardResult {
  if (!isAbsolute(input)) {
    return {
      ok: false,
      reason: "not_absolute",
      message: "path must be absolute",
    };
  }

  const roots = getAllowedRoots();
  if (roots.length === 0) {
    return {
      ok: false,
      reason: "no_roots",
      message:
        "no project roots discovered (check WORKSPACE_BASE_DIR/WORKSPACE_PATTERN)",
    };
  }

  const real = resolveReal(input);
  const root = roots.find((candidate) => isInside(real, candidate));

  if (!root) {
    return {
      ok: false,
      reason: "outside_roots",
      message: "resolves outside allowed project roots",
    };
  }

  if (!options.write) return { ok: true, real, root };

  if (features.readOnly) {
    return {
      ok: false,
      reason: "readonly_mode",
      message: "server is in read-only mode (WORKSPACE_READONLY)",
    };
  }

  if (features.protectSensitiveFiles && isProtectedPath(real, root)) {
    return {
      ok: false,
      reason: "protected_path",
      message: "matches a protected path pattern",
    };
  }

  return { ok: true, real, root };
}
