import { z } from "zod";
import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";
import { ALLOWED_ROOTS } from "../config.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

interface ProjectInfo {
  name: string;
  path: string;
  hasPackageJson: boolean;
  packageName?: string;
  description?: string;
  topLevelDirs: string[];
  topLevelFiles: string[];
}

async function getProjectInfo(root: string): Promise<ProjectInfo | null> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
      .map((e) => e.name);
    const files = entries.filter((e) => e.isFile()).map((e) => e.name);

    let packageName: string | undefined;
    let description: string | undefined;
    let hasPackageJson = false;

    if (files.includes("package.json")) {
      hasPackageJson = true;
      try {
        const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf-8"));
        packageName = pkg.name;
        description = pkg.description;
      } catch {}
    }

    return {
      name: root.split("/").pop() || root,
      path: root,
      hasPackageJson,
      packageName,
      description,
      topLevelDirs: dirs,
      topLevelFiles: files.slice(0, 20), // limit for readability
    };
  } catch {
    return null;
  }
}

export function registerProjectOverview(server: McpServer) {
  server.tool(
    "list_projects",
    "List all allowed project workspaces with basic info (package name, top-level structure). Useful for discovering available projects.",
    {},
    async () => {
      const projects: ProjectInfo[] = [];

      for (const root of ALLOWED_ROOTS) {
        const info = await getProjectInfo(root);
        if (info) projects.push(info);
      }

      if (projects.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No accessible projects found.",
            },
          ],
        };
      }

      const text = projects
        .map((p) => {
          let out = `## ${p.name}\n`;
          out += `Path: ${p.path}\n`;
          if (p.packageName) out += `Package: ${p.packageName}\n`;
          if (p.description) out += `Description: ${p.description}\n`;
          out += `Directories: ${p.topLevelDirs.join(", ")}\n`;
          out += `Files: ${p.topLevelFiles.join(", ")}`;
          return out;
        })
        .join("\n\n---\n\n");

      return {
        content: [{ type: "text" as const, text }],
      };
    }
  );
}
