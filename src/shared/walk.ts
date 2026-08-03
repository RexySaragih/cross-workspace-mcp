import type { Dirent } from "fs";
import { readdir, stat } from "fs/promises";
import { join, relative } from "path";
import { IGNORED_DIRS, features, limits } from "../config.js";
import { isInside, resolveReal } from "../security/path-guard.js";
import { GitignoreMatcher } from "./gitignore.js";

export interface WalkedFile {
  path: string;
  name: string;
}

export interface WalkController {
  /** Return false to stop the traversal early. */
  onFile: (file: WalkedFile) => Promise<boolean> | boolean;
  deadline?: number;
}

interface EntryKind {
  isDirectory: boolean;
  isFile: boolean;
}

/**
 * Classifies an entry, resolving symlinks and discarding any that escape the
 * root. Without this a symlink inside the tree would be read (or descended)
 * even though its target lies outside the sandbox.
 */
async function classify(
  entry: Dirent,
  fullPath: string,
  root: string
): Promise<EntryKind | null> {
  if (entry.isDirectory()) return { isDirectory: true, isFile: false };
  if (entry.isFile()) return { isDirectory: false, isFile: true };
  if (!entry.isSymbolicLink()) return null;

  const real = resolveReal(fullPath);
  if (!isInside(real, root)) return null;

  try {
    const info = await stat(real);
    return { isDirectory: info.isDirectory(), isFile: info.isFile() };
  } catch {
    return null;
  }
}

interface WalkContext {
  root: string;
  matcher: GitignoreMatcher | null;
  controller: WalkController;
}

/** True means keep walking, false means the caller asked to stop. */
type ShouldContinue = boolean;

async function visitEntry(
  entry: Dirent,
  directory: string,
  depth: number,
  context: WalkContext
): Promise<ShouldContinue> {
  if (IGNORED_DIRS.has(entry.name)) return true;

  const fullPath = join(directory, entry.name);
  const kind = await classify(entry, fullPath, context.root);
  if (!kind) return true;

  const relativePath = relative(context.root, fullPath);
  if (context.matcher?.ignores(relativePath, kind.isDirectory)) return true;

  if (kind.isDirectory) return walkDirectory(fullPath, depth + 1, context);

  return context.controller.onFile({ path: fullPath, name: entry.name });
}

async function walkDirectory(
  directory: string,
  depth: number,
  context: WalkContext
): Promise<ShouldContinue> {
  const { deadline } = context.controller;
  if (depth > limits.maxSearchDepth) return true;
  if (deadline !== undefined && Date.now() > deadline) return false;

  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return true;
  }

  for (const entry of entries) {
    if (!(await visitEntry(entry, directory, depth, context))) return false;
  }

  return true;
}

export async function walkFiles(
  root: string,
  controller: WalkController
): Promise<void> {
  const matcher = features.respectGitignore ? new GitignoreMatcher(root) : null;
  await walkDirectory(root, 0, { root, matcher, controller });
}
