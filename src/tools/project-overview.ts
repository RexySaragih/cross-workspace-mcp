import { readFile, readdir } from "fs/promises";
import { basename, join } from "path";
import { z } from "zod";
import { IGNORED_DIRS, describeDiscovery, refreshAllowedRoots } from "../config.js";
import { ok } from "../shared/response.js";
import { resolveRoots } from "../shared/roots.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const MAX_LISTED_FILES = 20;

interface ProjectInfo {
  name: string;
  path: string;
  packageName?: string;
  description?: string;
  directories: string[];
  files: string[];
}

async function readPackageMetadata(
  root: string
): Promise<{ packageName?: string; description?: string }> {
  try {
    const raw = await readFile(join(root, "package.json"), "utf-8");
    const parsed = JSON.parse(raw) as { name?: string; description?: string };
    return { packageName: parsed.name, description: parsed.description };
  } catch {
    return {};
  }
}

async function getProjectInfo(root: string): Promise<ProjectInfo | null> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);

    return {
      name: basename(root),
      path: root,
      ...(files.includes("package.json") ? await readPackageMetadata(root) : {}),
      directories: entries
        .filter((entry) => entry.isDirectory())
        .filter((entry) => !entry.name.startsWith(".") && !IGNORED_DIRS.has(entry.name))
        .map((entry) => entry.name),
      files: files.slice(0, MAX_LISTED_FILES),
    };
  } catch {
    return null;
  }
}

function render(project: ProjectInfo): string {
  const lines = [`## ${project.name}`, `Path: ${project.path}`];
  if (project.packageName) lines.push(`Package: ${project.packageName}`);
  if (project.description) lines.push(`Description: ${project.description}`);
  lines.push(`Directories: ${project.directories.join(", ") || "(none)"}`);
  lines.push(`Files: ${project.files.join(", ") || "(none)"}`);
  return lines.join("\n");
}

async function describeProjects(project?: string): Promise<string> {
  const roots = resolveRoots(project);
  const infos = await Promise.all(roots.map(getProjectInfo));
  const found = infos.filter((info): info is ProjectInfo => info !== null);

  if (found.length === 0) {
    return `No accessible projects found.\nDiscovery: ${describeDiscovery()}`;
  }

  return found.map(render).join("\n\n---\n\n");
}

export function registerProjectOverview(server: McpServer): void {
  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description:
        "List all allowed project workspaces with basic info (package name, top-level structure). Useful for discovering available projects.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        project: z
          .string()
          .optional()
          .describe("Optional: only describe projects matching this directory name"),
      },
    },
    async ({ project }) => ok(await describeProjects(project))
  );
}

export function registerRefreshProjects(server: McpServer): void {
  server.registerTool(
    "refresh_projects",
    {
      title: "Refresh project discovery",
      description:
        "Re-scan the workspace base directory for projects. Use after cloning a new repository so it becomes visible without restarting the server.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {},
    },
    async () => {
      const roots = refreshAllowedRoots();
      const names = roots.map((root) => basename(root)).join(", ") || "(none)";
      return ok(
        `OK ${roots.length} project(s): ${names}\nDiscovery: ${describeDiscovery()}`
      );
    }
  );
}
