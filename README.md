# Cross-Workspace MCP Server

An MCP (Model Context Protocol) server that gives AI agents read and write access to your other project workspaces directly from the IDE — no terminal switching or CLI needed.

Built with **TypeScript** + **@modelcontextprotocol/sdk**.

---

## Why?

When you're working in one project but need the agent to reference or edit code in another project, the IDE can't see files outside the current workspace. This MCP server bridges that gap by exposing tools that let the agent browse, search, read, edit, create, and diagnose files across all your local projects.

Especially useful for agents like **Kiro** that are restricted to the active workspace.

---

## Installation

### Option 1: Use via npx (recommended)

```jsonc
{
  "mcpServers": {
    "cross-workspace": {
      "command": "npx",
      "args": ["-y", "@rexymayderio/cross-workspace-mcp"],
      "env": {
        "WORKSPACE_BASE_DIR": "/Users/yourname/Projects",
        "WORKSPACE_PATTERN": "my-app-*",
      },
    },
  },
}
```

Every tool carries MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`), so most clients can decide what to auto-approve on their own. An explicit `autoApprove` list is no longer required.

### Option 2: Install globally

```bash
npm install -g @rexymayderio/cross-workspace-mcp
```

```jsonc
{
  "mcpServers": {
    "cross-workspace": {
      "command": "cross-workspace-mcp",
      "env": {
        "WORKSPACE_BASE_DIR": "/Users/yourname/Projects",
        "WORKSPACE_PATTERN": "my-app-*",
      },
    },
  },
}
```

---

## Configuration

All configuration is done via environment variables — no code changes needed.

### Discovery

| Variable             | Default       | Description                                              |
| -------------------- | ------------- | -------------------------------------------------------- |
| `WORKSPACE_BASE_DIR` | `~/Documents` | Parent directory where your projects live                |
| `WORKSPACE_PATTERN`  | `krom-*`      | Comma-separated glob patterns matching project dir names |

Patterns support `*` anywhere in the name, so `my-app-*`, `*-service` and `api-*-prod` all work. Use `*` to match every directory (with caution). Discovery re-scans automatically every 30 seconds, and `refresh_projects` forces it immediately.

### Hardening (opt-in)

These default to off so upgrading from 1.x does not change behaviour.

| Variable                      | Default | Description                                                    |
| ----------------------------- | ------- | -------------------------------------------------------------- |
| `WORKSPACE_READONLY`          | `false` | Do not register any write tool at all                          |
| `WORKSPACE_PROTECT_SENSITIVE` | `false` | Refuse writes to `PROTECTED_PATTERNS` paths                    |
| `WORKSPACE_SOFT_DELETE`       | `false` | Move deleted files to `<project>/.workspace-trash` instead of unlinking |
| `WORKSPACE_RESPECT_GITIGNORE` | `false` | Skip gitignored files during search and grep                   |
| `WORKSPACE_PROTECTED_PATTERNS`| see below | Comma-separated glob deny list for writes                    |

Default protected patterns: `.git/**`, `.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa*`, `.ssh/**`, `.npmrc`.

### Limits

| Variable                          | Default | Description                                  |
| --------------------------------- | ------- | -------------------------------------------- |
| `WORKSPACE_MAX_READ_BYTES`        | `5MB`   | Largest file `read_project_file` will return |
| `WORKSPACE_MAX_BATCH_READ_BYTES`  | `256KB` | Per-file cap in `read_project_files`         |
| `WORKSPACE_MAX_BATCH_READ_PATHS`  | `50`    | Max paths per batch read                     |
| `WORKSPACE_MAX_GREP_FILE_BYTES`   | `2MB`   | Files larger than this are skipped by grep   |
| `WORKSPACE_MAX_LIST_ENTRIES`      | `1000`  | Max entries from `list_project_dir`          |
| `WORKSPACE_MAX_SEARCH_DEPTH`      | `8`     | Recursion depth for search and grep          |
| `WORKSPACE_MAX_SEARCH_RESULTS`    | `100`   | Max filename search results                  |
| `WORKSPACE_MAX_GREP_RESULTS`      | `50`    | Max grep matches                             |
| `WORKSPACE_GREP_TIME_BUDGET_MS`   | `15000` | Wall-clock budget for a grep call            |
| `WORKSPACE_DIAGNOSE_TIMEOUT_MS`   | `60000` | Wall-clock budget for a diagnose call        |

---

## Security

### The sandbox

Every path passes through a single guard before any file system call. The guard:

1. **Requires absolute paths.** Relative paths are rejected rather than resolved against the server's working directory, which is whatever the IDE happened to spawn the process with.
2. **Resolves symlinks.** Paths are canonicalised with `realpath`, walking up to the nearest existing ancestor for files that do not exist yet. A symlink planted inside a project that points elsewhere on disk is rejected, and the resolved real path — not the caller's path — is what actually gets read or written.
3. **Compares on segment boundaries.** Root `/x/app` does not match the unrelated sibling `/x/app-secrets`.
4. **Applies to traversal too.** The directory walker used by search and grep classifies symlinks and drops any whose target escapes the root, so linked files cannot leak into results.

The sandbox is always on and cannot be disabled by configuration.

### Known limitations

- **Time-of-check to time-of-use.** A path is validated and then used. A symlink swapped in that gap could in principle be followed. This is inherent to path-based file APIs and is only a concern if an untrusted process can write inside your project roots.
- **The gitignore matcher is a subset.** Comments, negation, directory-only rules, anchoring and wildcards are supported; nested `.gitignore` files are not. It only narrows search results, never widens access.
- **Anything inside a root is fair game.** Scope your `WORKSPACE_PATTERN` deliberately, and turn on `WORKSPACE_PROTECT_SENSITIVE` if the projects contain credentials.

### Other measures

- Binary files are detected by NUL-byte sniff and refused for read and edit, and skipped by grep.
- Grep defaults to a text and source extension allowlist; pass `extensions: "*"` to widen.
- Writes are atomic (temp file plus rename, preserving file mode). `create_only` uses an exclusive open so two concurrent creates cannot both succeed.
- Edits are validated in full against an in-memory copy; if any edit in the batch fails, nothing is written.
- Ignored during traversal: `node_modules`, `.git`, `dist`, `build`, `.next`, `.nuxt`, `.turbo`, `.cache`, `coverage`, `.venv`, `venv`, `__pycache__`, `vendor`, `target`, `.gradle`, `.terraform`, `Pods`, `.idea`, `.kiro`.

---

## Available Tools

### Read & Search

| Tool                    | Purpose                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| `list_projects`         | List discovered workspaces with package name and structure         |
| `refresh_projects`      | Re-scan for newly cloned projects without restarting               |
| `read_project_file`     | Read one file, optionally a line range via `offset`/`limit`         |
| `read_project_files`    | Read several files at once for comparison                          |
| `list_project_dir`      | List a directory, optionally one level deep                        |
| `search_project_files`  | Find files by name substring, optionally scoped to one project      |
| `grep_project_content`  | Search file contents by text or regex                              |

`list_projects` reports the active discovery settings when nothing matches, so a wrong `WORKSPACE_BASE_DIR` or pattern is visible immediately instead of surfacing as an empty result.

### Write & Create

Write tools return compact one-line summaries (no echoed content) to save tokens. None are registered when `WORKSPACE_READONLY` is set.

| Tool                   | Purpose                                                        |
| ---------------------- | -------------------------------------------------------------- |
| `edit_project_file`    | Up to 20 search/replace edits, all-or-nothing, atomic write     |
| `write_project_file`   | Create or overwrite, creating parent directories as needed     |
| `create_project_file`  | Create only; fails if the file exists                          |
| `create_project_dir`   | Create a directory; fails if it exists                         |
| `delete_project_file`  | Delete a file (directories refused; soft delete optional)      |

`edit_project_file` requires `old_string` to match exactly once unless `replace_all` is set, so an ambiguous edit fails loudly rather than changing the wrong line.

### Diagnostics

`diagnose_project_file` runs TypeScript/JavaScript diagnostics on a file outside the active workspace. Finding code errors is a successful response, not a tool failure.

It resolves the nearest `tsconfig.json` without walking past the project root, and prefers the target project's own TypeScript from its `node_modules` so results match that project's build rather than whatever version this server bundles. Programs are cached and reused across calls, with source files invalidated by mtime, so repeated calls after edits are fast and never report stale results.

Supported: `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, `.cjs`

Example response:

```
OK /path/to/user-service.ts [/path/to/tsconfig.json, ts 5.5.4 (project)]
1 error(s)
131:21 error TS2322 Type '"test"' is not assignable to type 'UserRole | undefined'.
```

---

## Token Efficiency

- **Edits over rewrites** — send `old_string`/`new_string` deltas, not full files
- **Batch edits** — up to 20 replacements per `edit_project_file` call
- **Minimal responses** — one-line summaries like `OK path 2 edit(s) Δ+45b`
- **Partial reads** — `offset`/`limit` for targeted context
- **Capped results** — searches, listings and reads are bounded by default

Recommended agent workflow:

```
1. grep_project_content   → locate the file
2. read_project_file      → read only the relevant lines
3. edit_project_file      → apply targeted changes
4. diagnose_project_file  → verify no type errors
```

---

## Development

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

Tests run a real MCP client against a real server over an in-memory transport, against throwaway workspaces on the real file system. Symlink and `realpath` behaviour cannot be reproduced faithfully by a fake, so the sandbox regressions exercise it directly.

---

## Upgrading from 1.x

Behaviour is preserved by default, with three deliberate exceptions:

1. **Relative paths are now rejected.** Previously they resolved against the server's working directory and almost always failed the root check anyway.
2. **Symlinks that escape a project root are now denied.** In 1.x these were allowed, because the boundary check resolved `..` but not symlinks.
3. **Grep defaults to a text extension allowlist.** Previously every file was decoded as UTF-8, including binaries. Pass `extensions: "*"` for the old behaviour.

Size caps, `refresh_projects`, and the tool annotations are additive. All hardening features are off unless explicitly enabled.

---

## Project Structure

```
src/
├── index.ts                  ← bin entry: logging, stdio transport, shutdown
├── server.ts                 ← builds the server and registers tools
├── config.ts                 ← env config, limits, project discovery
├── security/
│   └── path-guard.ts         ← the sandbox: realpath, boundaries, deny list
├── shared/
│   ├── fs-utils.ts           ← binary sniff, atomic write, size helpers
│   ├── gitignore.ts          ← gitignore subset matcher
│   ├── response.ts           ← shared ok/fail/denied response shapes
│   ├── roots.ts              ← project name resolution
│   ├── walk.ts               ← guarded directory traversal
│   └── write-ops.ts          ← shared write/create implementation
└── tools/                    ← one file per tool
```

---

## License

MIT
