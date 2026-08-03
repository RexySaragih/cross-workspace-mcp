import { readFileSync } from "fs";
import { join, sep } from "path";

interface IgnoreRule {
  regex: RegExp;
  negated: boolean;
  directoryOnly: boolean;
}

function toRegExp(pattern: string, anchored: boolean): RegExp {
  const doubleStar = "\u0000";
  const body = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, doubleStar)
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .split(doubleStar)
    .join(".*");

  return anchored
    ? new RegExp(`^${body}(?:/.*)?$`)
    : new RegExp(`(?:^|/)${body}(?:/.*)?$`);
}

function parseRule(rawLine: string): IgnoreRule | null {
  const line = rawLine.trim();
  if (line === "" || line.startsWith("#")) return null;

  const negated = line.startsWith("!");
  let pattern = negated ? line.slice(1) : line;

  const directoryOnly = pattern.endsWith("/");
  if (directoryOnly) pattern = pattern.slice(0, -1);

  const anchored = pattern.startsWith("/") || pattern.slice(0, -1).includes("/");
  if (pattern.startsWith("/")) pattern = pattern.slice(1);
  if (pattern === "") return null;

  return { regex: toRegExp(pattern, anchored), negated, directoryOnly };
}

/**
 * Supports the common subset of gitignore syntax: comments, negation,
 * directory-only rules, anchoring and glob wildcards. Nested .gitignore files
 * and full precedence rules are not modelled, which is acceptable because this
 * only ever narrows search results and is opt-in.
 */
export class GitignoreMatcher {
  private readonly rules: IgnoreRule[];

  constructor(root: string) {
    this.rules = GitignoreMatcher.loadRules(root);
  }

  private static loadRules(root: string): IgnoreRule[] {
    try {
      return readFileSync(join(root, ".gitignore"), "utf-8")
        .split("\n")
        .map(parseRule)
        .filter((rule): rule is IgnoreRule => rule !== null);
    } catch {
      return [];
    }
  }

  ignores(relativePath: string, isDirectory: boolean): boolean {
    const normalized = relativePath.split(sep).join("/");
    let ignored = false;

    for (const rule of this.rules) {
      if (rule.directoryOnly && !isDirectory) continue;
      if (rule.regex.test(normalized)) ignored = !rule.negated;
    }

    return ignored;
  }
}
