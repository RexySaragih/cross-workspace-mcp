#!/usr/bin/env node
/**
 * End-to-end smoke test against the built server over a real stdio transport.
 * Complements the in-process vitest suite by exercising the actual published
 * entry point, JSON-RPC framing and tool registration.
 */
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(REPO_ROOT, "dist", "index.js");

const EXPECTED_TOOLS = [
  "create_project_dir",
  "create_project_file",
  "delete_project_file",
  "diagnose_project_file",
  "edit_project_file",
  "grep_project_content",
  "list_project_dir",
  "list_projects",
  "read_project_file",
  "read_project_files",
  "refresh_projects",
  "search_project_files",
  "write_project_file",
];

const results = [];

function record(name, passed, detail) {
  results.push({ name, passed, detail });
  const status = passed ? "PASS" : "FAIL";
  process.stdout.write(`${status}  ${name}${passed ? "" : `\n      ${detail}`}\n`);
}

function check(name, condition, detail = "") {
  record(name, Boolean(condition), detail);
}

function createClient(env) {
  const child = spawn(process.execPath, [ENTRY], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));

  const pending = new Map();
  let buffer = "";

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      const resolver = pending.get(message.id);
      if (resolver) {
        pending.delete(message.id);
        resolver(message);
      }
    }
  });

  let nextId = 0;
  const send = (method, params) =>
    new Promise((resolvePromise, rejectPromise) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectPromise(new Error(`timeout waiting for ${method}`));
      }, 60_000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        resolvePromise(message);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });

  return {
    send,
    notify: (method) =>
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`),
    stderr: () => stderr.join(""),
    kill: () => child.kill(),
  };
}

async function callTool(client, name, args = {}) {
  const response = await client.send("tools/call", { name, arguments: args });
  if (response.error) return { text: response.error.message, isError: true };
  const text = (response.result.content ?? [])
    .map((item) => item.text ?? "")
    .join("\n");
  return { text, isError: response.result.isError === true };
}

async function buildWorkspace() {
  const base = await mkdtemp(join(tmpdir(), "cross-workspace-smoke-"));
  const alpha = join(base, "smoke-alpha");
  const beta = join(base, "smoke-beta");
  const vault = join(base, "vault");

  await mkdir(join(alpha, "src"), { recursive: true });
  await mkdir(join(beta, "src"), { recursive: true });
  await mkdir(vault, { recursive: true });

  await writeFile(join(alpha, "package.json"), '{"name":"alpha","description":"Alpha app"}');
  await writeFile(
    join(alpha, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true, target: "ES2022", noEmit: true } })
  );
  await writeFile(join(alpha, "src", "user-service.ts"), "export const role = 'admin';\n");
  await writeFile(join(alpha, "src", "broken.ts"), "export const total: number = 'nope';\n");
  await writeFile(join(alpha, "logo.png"), Buffer.from([0x89, 0x50, 0x00, 0x01]));
  await writeFile(
    join(beta, "src", "auth.ts"),
    "export class AuthGuard {}\nexport const guard = new AuthGuard();\n"
  );
  await writeFile(join(vault, "secret.txt"), "TOP SECRET");
  await symlink(vault, join(alpha, "src", "escape"));

  return { base, alpha, beta, vault };
}

async function main() {
  if (!existsSync(ENTRY)) {
    process.stderr.write(`Missing build at ${ENTRY}. Run: npm run build\n`);
    process.exit(1);
  }

  const ws = await buildWorkspace();
  const client = createClient({
    WORKSPACE_BASE_DIR: ws.base,
    WORKSPACE_PATTERN: "smoke-*",
  });

  try {
    const init = await client.send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke", version: "1.0.0" },
    });
    client.notify("notifications/initialized");
    check(
      "handshake reports server info",
      init.result?.serverInfo?.name === "cross-workspace",
      JSON.stringify(init.result?.serverInfo)
    );

    const listed = await client.send("tools/list", {});
    const names = (listed.result?.tools ?? []).map((tool) => tool.name).sort();
    check(
      `tools/list exposes all ${EXPECTED_TOOLS.length} tools`,
      JSON.stringify(names) === JSON.stringify(EXPECTED_TOOLS),
      `got ${names.length}: ${names.join(", ")}`
    );

    const annotated = (listed.result?.tools ?? []).filter(
      (tool) => tool.annotations && "readOnlyHint" in tool.annotations
    );
    check(
      "every tool carries annotations",
      annotated.length === names.length,
      `${annotated.length}/${names.length} annotated`
    );

    const projects = await callTool(client, "list_projects");
    check(
      "list_projects finds both projects",
      projects.text.includes("smoke-alpha") && projects.text.includes("smoke-beta"),
      projects.text
    );

    const refreshed = await callTool(client, "refresh_projects");
    check("refresh_projects reports roots", refreshed.text.includes("2 project(s)"), refreshed.text);

    const read = await callTool(client, "read_project_file", {
      path: join(ws.alpha, "src/user-service.ts"),
    });
    check("read_project_file returns content", read.text.includes("role = 'admin'"), read.text);

    const ranged = await callTool(client, "read_project_file", {
      path: join(ws.alpha, "src/user-service.ts"),
      offset: 1,
      limit: 1,
    });
    check("read_project_file honours offset/limit", ranged.text.includes("L1-1/"), ranged.text);

    const binary = await callTool(client, "read_project_file", {
      path: join(ws.alpha, "logo.png"),
    });
    check("read_project_file refuses binary", binary.isError && binary.text.includes("binary"), binary.text);

    const multi = await callTool(client, "read_project_files", {
      paths: [join(ws.alpha, "src/user-service.ts"), join(ws.beta, "src/auth.ts")],
    });
    check(
      "read_project_files returns both",
      multi.text.includes("AuthGuard") && multi.text.includes("admin"),
      multi.text
    );

    const listing = await callTool(client, "list_project_dir", {
      path: join(ws.alpha, "src"),
    });
    check("list_project_dir lists entries", listing.text.includes("user-service.ts"), listing.text);

    const search = await callTool(client, "search_project_files", { pattern: "auth" });
    check("search_project_files finds file", search.text.includes("auth.ts"), search.text);

    const scoped = await callTool(client, "search_project_files", {
      pattern: "user",
      project: "smoke-alpha",
    });
    check("search_project_files scopes by project", scoped.text.includes("smoke-alpha"), scoped.text);

    const grep = await callTool(client, "grep_project_content", { query: "AuthGuard" });
    check("grep_project_content finds match", grep.text.includes("auth.ts:1"), grep.text);

    const diagnoseOk = await callTool(client, "diagnose_project_file", {
      path: join(ws.alpha, "src/user-service.ts"),
    });
    check("diagnose_project_file clean file", diagnoseOk.text.includes("0 issues"), diagnoseOk.text);

    const diagnoseBad = await callTool(client, "diagnose_project_file", {
      path: join(ws.alpha, "src/broken.ts"),
    });
    check(
      "diagnose_project_file reports type error",
      !diagnoseBad.isError && diagnoseBad.text.includes("TS2322"),
      diagnoseBad.text
    );

    const created = await callTool(client, "create_project_file", {
      path: join(ws.beta, "src/new-file.ts"),
      content: "export const created = true;\n",
    });
    check("create_project_file creates", !created.isError && created.text.startsWith("OK"), created.text);

    const duplicate = await callTool(client, "create_project_file", {
      path: join(ws.beta, "src/new-file.ts"),
      content: "x",
    });
    check("create_project_file rejects duplicate", duplicate.isError, duplicate.text);

    const written = await callTool(client, "write_project_file", {
      path: join(ws.beta, "deep/nested/config.json"),
      content: "{}",
    });
    check("write_project_file creates parents", !written.isError, written.text);

    const madeDir = await callTool(client, "create_project_dir", {
      path: join(ws.beta, "src/modules"),
    });
    check("create_project_dir creates", !madeDir.isError, madeDir.text);

    const edited = await callTool(client, "edit_project_file", {
      path: join(ws.alpha, "src/user-service.ts"),
      edits: [{ old_string: "'admin'", new_string: "'owner'" }],
    });
    check("edit_project_file applies edit", edited.text.includes("1 edit(s)"), edited.text);

    const ambiguous = await callTool(client, "edit_project_file", {
      path: join(ws.beta, "src/auth.ts"),
      edits: [{ old_string: "AuthGuard", new_string: "AccessGuard" }],
    });
    check(
      "edit_project_file rejects ambiguous match",
      ambiguous.isError && ambiguous.text.includes("2 matches"),
      ambiguous.text
    );

    const replacedAll = await callTool(client, "edit_project_file", {
      path: join(ws.beta, "src/auth.ts"),
      edits: [{ old_string: "AuthGuard", new_string: "AccessGuard", replace_all: true }],
    });
    check(
      "edit_project_file replace_all succeeds",
      !replacedAll.isError && replacedAll.text.includes("1 edit(s)"),
      replacedAll.text
    );

    const deleted = await callTool(client, "delete_project_file", {
      path: join(ws.beta, "src/new-file.ts"),
    });
    check("delete_project_file removes file", !deleted.isError, deleted.text);

    const deleteDir = await callTool(client, "delete_project_file", {
      path: join(ws.beta, "src/modules"),
    });
    check("delete_project_file refuses directory", deleteDir.isError, deleteDir.text);

    const escaped = await callTool(client, "read_project_file", {
      path: join(ws.alpha, "src/escape/secret.txt"),
    });
    check(
      "symlink escape is denied",
      escaped.isError && !escaped.text.includes("TOP SECRET"),
      escaped.text
    );

    const outside = await callTool(client, "read_project_file", {
      path: join(ws.vault, "secret.txt"),
    });
    check("path outside roots is denied", outside.isError, outside.text);

    const relative = await callTool(client, "read_project_file", { path: "src/auth.ts" });
    check("relative path is denied", relative.isError, relative.text);

    const badSchema = await callTool(client, "read_project_file", {});
    check("missing required argument is rejected", badSchema.isError, badSchema.text);

    const banner = client.stderr();
    check("startup logs discovery to stderr", banner.includes("matched=2"), banner.trim());
  } finally {
    client.kill();
    await rm(ws.base, { recursive: true, force: true });
  }

  const failed = results.filter((entry) => !entry.passed);
  process.stdout.write(
    `\n${results.length - failed.length}/${results.length} checks passed\n`
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`smoke run failed: ${error.stack ?? error.message}\n`);
  process.exit(1);
});
