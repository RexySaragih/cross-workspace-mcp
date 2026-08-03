import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { vi } from "vitest";

export interface ToolOutcome {
  text: string;
  isError: boolean;
}

export interface Harness {
  baseDir: string;
  /** Absolute path inside a discovered project root. */
  inProject: (project: string, relativePath?: string) => string;
  call: (tool: string, args?: Record<string, unknown>) => Promise<ToolOutcome>;
  listTools: () => Promise<string[]>;
  writeFixture: (absolutePath: string, contents: string | Buffer) => Promise<void>;
  linkFixture: (absolutePath: string, target: string) => Promise<void>;
  close: () => Promise<void>;
}

export interface HarnessOptions {
  /** Project directory names to create under the base dir before discovery. */
  projects?: string[];
  /** Directories created outside every project root, used for escape tests. */
  outsideDirs?: string[];
  env?: Record<string, string>;
}

const PROJECT_PATTERN = "proj-*";
const ENV_PREFIX = "WORKSPACE_";

function captureWorkspaceEnv(): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.startsWith(ENV_PREFIX))
  );
}

/**
 * Feature flags are read once at import time, so a flag set by one test would
 * otherwise persist into every later test in the same file.
 */
function restoreWorkspaceEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith(ENV_PREFIX)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(snapshot)) {
    if (value !== undefined) process.env[key] = value;
  }
}

async function writeFixture(
  absolutePath: string,
  contents: string | Buffer
): Promise<void> {
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents);
}

/**
 * Builds a throwaway workspace on the real file system and connects a real MCP
 * client to a real server over an in-memory transport. The file system is the
 * I/O boundary this server exists to wrap, and symlink and realpath behaviour
 * cannot be reproduced by a fake, so it is exercised for real.
 */
export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const baseDir = await mkdtemp(join(tmpdir(), "cross-workspace-"));
  const envSnapshot = captureWorkspaceEnv();

  process.env.WORKSPACE_BASE_DIR = baseDir;
  process.env.WORKSPACE_PATTERN = PROJECT_PATTERN;
  for (const [key, value] of Object.entries(options.env ?? {})) {
    process.env[key] = value;
  }

  for (const project of options.projects ?? ["proj-alpha"]) {
    await mkdir(join(baseDir, project), { recursive: true });
  }
  for (const outside of options.outsideDirs ?? []) {
    await mkdir(join(baseDir, outside), { recursive: true });
  }

  // Modules read configuration at import time, so they must be loaded only
  // after the environment and directory layout are in place.
  vi.resetModules();
  const { createServer } = await import("../../src/server.js");

  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: "harness", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  return {
    baseDir,
    inProject: (project, relativePath = "") =>
      relativePath ? join(baseDir, project, relativePath) : join(baseDir, project),
    writeFixture,
    linkFixture: async (absolutePath, target) => {
      await mkdir(dirname(absolutePath), { recursive: true });
      await symlink(target, absolutePath);
    },
    listTools: async () => {
      const { tools } = await client.listTools();
      return tools.map((tool) => tool.name).sort();
    },
    call: async (tool, args = {}) => {
      const result = await client.callTool({ name: tool, arguments: args });
      const content = result.content as Array<{ type: string; text?: string }>;
      return {
        text: content.map((item) => item.text ?? "").join("\n"),
        isError: result.isError === true,
      };
    },
    close: async () => {
      await client.close();
      await server.close();
      await rm(baseDir, { recursive: true, force: true });
      restoreWorkspaceEnv(envSnapshot);
    },
  };
}
