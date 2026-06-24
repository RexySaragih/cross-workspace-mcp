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

No cloning or downloading needed. Just add to your MCP config:

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
      "autoApprove": [
        "list_projects",
        "read_project_file",
        "read_project_files",
        "list_project_dir",
        "search_project_files",
        "grep_project_content",
        "edit_project_file",
        "write_project_file",
        "create_project_file",
        "create_project_dir",
        "delete_project_file",
        "diagnose_project_file",
      ],
    },
  },
}
```

### Option 2: Install globally

```bash
npm install -g @rexymayderio/cross-workspace-mcp
```

Then use in MCP config:

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

All configuration is done via environment variables in the MCP config — no code changes needed.

| Env Variable         | Default       | Description                                                   |
| -------------------- | ------------- | ------------------------------------------------------------- |
| `WORKSPACE_BASE_DIR` | `~/Documents` | The parent directory where your projects live                 |
| `WORKSPACE_PATTERN`  | `prefix-*`      | Glob-like pattern to match project directories (prefix match) |

### How discovery works

On startup, the server scans `WORKSPACE_BASE_DIR` for any **directory** whose name starts with the pattern prefix (everything before `*`). For example:

- Pattern `my-app-*` → matches `my-app-frontend`, `my-app-backend`, etc.
- Pattern `project-*` → matches `project-api`, `project-web`, `project-shared`, etc.
- Pattern `*` → matches ALL directories (use with caution)

Any new project you clone into the base directory that matches the pattern will be automatically discovered on the next server restart.

---

## Available Tools

### Read & Search

#### `list_projects`

List all discovered project workspaces with basic info (package name, description, top-level structure).

**Use case:** "What projects are available?" / orientation before diving in.

---

#### `read_project_file`

Read a single file from any allowed project workspace. Supports line ranges to save tokens.

| Parameter | Type   | Required | Description                                      |
| --------- | ------ | -------- | ------------------------------------------------ |
| `path`    | string | ✅       | Absolute path to the file                        |
| `offset`  | number | ❌       | 1-based start line                               |
| `limit`   | number | ❌       | Max lines to return (max 500 when offset is set) |

**Use case:** "Show me lines 40–70 of the auth middleware from my-app-backend"

---

#### `read_project_files`

Read multiple files at once. Useful for comparing implementations across projects.

| Parameter | Type     | Required | Description                  |
| --------- | -------- | -------- | ---------------------------- |
| `paths`   | string[] | ✅       | Array of absolute file paths |

**Use case:** "Compare the user model in my-app-backend vs my-app-api"

---

#### `list_project_dir`

List files and directories at a given path.

| Parameter   | Type    | Required | Description                                            |
| ----------- | ------- | -------- | ------------------------------------------------------ |
| `path`      | string  | ✅       | Absolute path to the directory                         |
| `recursive` | boolean | ❌       | List 1 level deep into subdirectories (default: false) |

**Use case:** "What's in the src/modules folder of my-app-backend?"

---

#### `search_project_files`

Search for files by name pattern across all (or a specific) project.

| Parameter | Type   | Required | Description                                            |
| --------- | ------ | -------- | ------------------------------------------------------ |
| `pattern` | string | ✅       | Filename or partial name (case-insensitive)            |
| `project` | string | ❌       | Limit search to a specific project (e.g. `my-app-api`) |

**Use case:** "Find all files named 'auth' across projects"

---

#### `grep_project_content`

Search inside file contents using text or regex patterns.

| Parameter    | Type   | Required | Description                                            |
| ------------ | ------ | -------- | ------------------------------------------------------ |
| `query`      | string | ✅       | Text or regex pattern to search for                    |
| `project`    | string | ❌       | Limit to a specific project                            |
| `extensions` | string | ❌       | Comma-separated extensions to filter (e.g. `.ts,.tsx`) |

**Use case:** "Find where `UserService` is used in my-app-backend"

---

### Write & Create

All write tools return compact one-line summaries (no echoed file content) to save tokens.

#### `edit_project_file`

Apply targeted search/replace edits. All edits are validated in memory, then written atomically.

| Parameter | Type     | Required | Description                                              |
| --------- | -------- | -------- | -------------------------------------------------------- |
| `path`    | string   | ✅       | Absolute path to the file                                |
| `edits`   | object[] | ✅       | Array of `{ old_string, new_string, replace_all? }` (max 20) |

**Use case:** "Change `admin` to `rexy` in user-service.ts across another project"

---

#### `write_project_file`

Create or overwrite a file. Creates parent directories as needed.

| Parameter     | Type    | Required | Description                              |
| ------------- | ------- | -------- | ---------------------------------------- |
| `path`        | string  | ✅       | Absolute path to the file                |
| `content`     | string  | ✅       | Full file content to write               |
| `create_only` | boolean | ❌       | Fail if the file already exists          |

**Use case:** "Overwrite the config file in my-app-api"

---

#### `create_project_file`

Create a new file only — fails if it already exists.

| Parameter | Type   | Required | Description                            |
| --------- | ------ | -------- | -------------------------------------- |
| `path`    | string | ✅       | Absolute path for the new file         |
| `content` | string | ❌       | Initial content (default: empty file)  |

**Use case:** "Create a new utility file in my-app-backend"

---

#### `create_project_dir`

Create a new folder only — fails if it already exists.

| Parameter | Type    | Required | Description                                  |
| --------- | ------- | -------- | -------------------------------------------- |
| `path`    | string  | ✅       | Absolute path for the new directory          |
| `parents` | boolean | ❌       | Create parent directories (default: `true`)  |

**Use case:** "Create src/modules/billing in my-app-api"

---

#### `delete_project_file`

Delete a file from any allowed project workspace.

| Parameter | Type   | Required | Description               |
| --------- | ------ | -------- | ------------------------- |
| `path`    | string | ✅       | Absolute path to the file |

**Use case:** "Remove the temporary script from my-app-backend"

---

### Diagnostics

#### `diagnose_project_file`

Run TypeScript/JavaScript diagnostics on a file outside the active workspace. Uses the nearest `tsconfig.json` for project context. Finding code errors is a successful response — not a tool failure.

| Parameter     | Type   | Required | Description                          |
| ------------- | ------ | -------- | ------------------------------------ |
| `path`        | string | ✅       | Absolute path to the file            |
| `max_results` | number | ❌       | Max issues to return (default: 50) |

Supported: `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, `.cjs`

**Use case:** "Check for type errors in user-service.ts after my edits"

Example response:

```
OK /path/to/user-service.ts [no tsconfig]
1 error(s)
131:21 error TS2322 Type '"test"' is not assignable to type 'UserRole | undefined'.
```

---

## Token Efficiency

Write and diagnostic tools are designed to minimize token usage:

- **Edits over rewrites** — send only `old_string`/`new_string` deltas, not full files
- **Batch edits** — up to 20 replacements in a single `edit_project_file` call
- **Minimal responses** — one-line summaries like `OK path 2 edit(s) Δ+45b`
- **Partial reads** — `read_project_file` supports `offset`/`limit` for targeted context

Recommended workflow for agents:

```
1. grep_project_content   → locate the file
2. read_project_file      → read only the relevant lines
3. edit_project_file      → apply targeted changes
4. diagnose_project_file  → verify no type errors
```

---

## Security

- **Sandboxed paths** — all file access is checked against discovered allowed roots; path traversal is blocked
- **Ignored directories** — `node_modules`, `.git`, `dist`, `build`, `.next`, `.nuxt`, `.turbo`, `.cache`, `coverage`, `.kiro` are skipped during searches
- **Result caps** — file search returns max 100 results, grep returns max 50 matches
- **Depth limit** — recursive searches stop at 8 levels deep

---

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run locally
npm start

# Watch mode
npm run dev
```

---

## Project Structure

```
shared-workspace-mcp-server/
├── src/
│   ├── index.ts              ← Entry point, registers tools & starts stdio transport
│   ├── config.ts             ← Env-based config, project discovery, path validation
│   └── tools/
│       ├── project-overview.ts   ← list_projects
│       ├── read-file.ts          ← read_project_file
│       ├── read-multiple-files.ts← read_project_files
│       ├── list-dir.ts           ← list_project_dir
│       ├── search-files.ts       ← search_project_files
│       ├── grep-content.ts       ← grep_project_content
│       ├── edit-file.ts          ← edit_project_file
│       ├── write-file.ts         ← write_project_file
│       ├── create-file.ts        ← create_project_file
│       ├── create-dir.ts         ← create_project_dir
│       ├── delete-file.ts        ← delete_project_file
│       └── diagnose-file.ts      ← diagnose_project_file
├── package.json
├── tsconfig.json
└── .gitignore
```

---

## License

MIT
