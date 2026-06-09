# Cross-Workspace MCP Server

An MCP (Model Context Protocol) server that gives AI agents read access to your other project workspaces directly from the IDE — no terminal switching or CLI needed.

Built with **TypeScript** + **@modelcontextprotocol/sdk**.

---

## Why?

When you're working in one project (e.g. `krom-falcon`) but need the agent to reference code from another project (e.g. `krom-trex`), the IDE can't see files outside the current workspace. This MCP server bridges that gap by exposing read-only tools that let the agent browse, search, and read files across all your local projects.

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
        "WORKSPACE_BASE_DIR": "/Users/yourname/Documents",
        "WORKSPACE_PATTERN": "prefix-*",
      },
      "autoApprove": [
        "list_projects",
        "read_project_file",
        "read_project_files",
        "list_project_dir",
        "search_project_files",
        "grep_project_content",
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
        "WORKSPACE_BASE_DIR": "/Users/yourname/Documents",
        "WORKSPACE_PATTERN": "prefix-*",
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
| `WORKSPACE_PATTERN`  | `krom-*`      | Glob-like pattern to match project directories (prefix match) |

### How discovery works

On startup, the server scans `WORKSPACE_BASE_DIR` for any **directory** whose name starts with the pattern prefix (everything before `*`). For example:

- Pattern `krom-*` → matches `krom-falcon`, `krom-trex`, `krom-superzoo`, etc.
- Pattern `my-app-*` → matches `my-app-frontend`, `my-app-backend`, etc.
- Pattern `*` → matches ALL directories (use with caution)

Any new project you clone into the base directory that matches the pattern will be automatically discovered on the next server restart.

---

## Available Tools

### `list_projects`

List all discovered project workspaces with basic info (package name, description, top-level structure).

**Use case:** "What projects are available?" / orientation before diving in.

---

### `read_project_file`

Read a single file from any allowed project workspace.

| Parameter | Type   | Required | Description               |
| --------- | ------ | -------- | ------------------------- |
| `path`    | string | ✅       | Absolute path to the file |

**Use case:** "Show me the auth middleware from krom-falcon"

---

### `read_project_files`

Read multiple files at once. Useful for comparing implementations across projects.

| Parameter | Type     | Required | Description                  |
| --------- | -------- | -------- | ---------------------------- |
| `paths`   | string[] | ✅       | Array of absolute file paths |

**Use case:** "Compare the user model in krom-falcon vs krom-trex"

---

### `list_project_dir`

List files and directories at a given path.

| Parameter   | Type    | Required | Description                                            |
| ----------- | ------- | -------- | ------------------------------------------------------ |
| `path`      | string  | ✅       | Absolute path to the directory                         |
| `recursive` | boolean | ❌       | List 1 level deep into subdirectories (default: false) |

**Use case:** "What's in the src/modules folder of krom-camel?"

---

### `search_project_files`

Search for files by name pattern across all (or a specific) project.

| Parameter | Type   | Required | Description                                           |
| --------- | ------ | -------- | ----------------------------------------------------- |
| `pattern` | string | ✅       | Filename or partial name (case-insensitive)           |
| `project` | string | ❌       | Limit search to a specific project (e.g. `krom-trex`) |

**Use case:** "Find all files named 'bifast' across projects"

---

### `grep_project_content`

Search inside file contents using text or regex patterns.

| Parameter    | Type   | Required | Description                                            |
| ------------ | ------ | -------- | ------------------------------------------------------ |
| `query`      | string | ✅       | Text or regex pattern to search for                    |
| `project`    | string | ❌       | Limit to a specific project                            |
| `extensions` | string | ❌       | Comma-separated extensions to filter (e.g. `.ts,.tsx`) |

**Use case:** "Find where `BiFastService` is used in krom-falcon"

---

## Security

- **Read-only** — no write/delete/execute operations
- **Path validation** — all file access is checked against discovered allowed roots; path traversal is blocked
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
│       └── grep-content.ts       ← grep_project_content
├── package.json
├── tsconfig.json
└── .gitignore
```

---

## License

MIT
