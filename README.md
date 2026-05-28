# Cross-Workspace MCP Server

An MCP (Model Context Protocol) server that gives Kiro's AI agent read access to your other project workspaces directly from the IDE — no terminal switching or CLI needed.

Built with **Bun** + **TypeScript** + **@modelcontextprotocol/sdk**.

---

## Why?

When you're working in one project (e.g. `krom-falcon`) but need the agent to reference code from another project (e.g. `krom-trex`), Kiro can't see files outside the current workspace. This MCP server bridges that gap by exposing read-only tools that let the agent browse, search, and read files across all your local projects.

---

## Prerequisites

- [Bun](https://bun.sh) installed (`curl -fsSL https://bun.sh/install | bash`)
- [Kiro IDE](https://kiro.dev) with MCP support

---

## Installation

### 1. Clone / copy this project

```bash
# Clone to your preferred location
git clone <repo-url> ~/Documents/shared-workspace-mcp-server

# Or if you already have it:
cd ~/Documents/shared-workspace-mcp-server
```

### 2. Install dependencies

```bash
bun install
```

That's it — no build step required. Bun runs TypeScript directly.

### 3. Register in Kiro

Add the server to your **global** Kiro MCP config at `~/.kiro/settings/mcp.json`:

```jsonc
{
  "mcpServers": {
    "cross-workspace": {
      "command": "bun",
      "args": [
        "run",
        "/absolute/path/to/shared-workspace-mcp-server/src/index.ts",
      ],
      "env": {
        "WORKSPACE_BASE_DIR": "/Users/yourname/Documents",
        "WORKSPACE_PATTERN": "prefix-*",
      },
      "disabled": false,
      "autoApprove": [
        "list_projects",
        "read_project_file",
        "read_project_files",
        "list_project_dir",
        "search_project_files",
        "grep_project_content",
      ],
    },
    // ... your other MCP servers
  },
}
```

> **Important:** Replace the paths with your actual absolute paths. The `args` path must point to `src/index.ts` in wherever you cloned this repo.

### 4. Restart / reconnect

Kiro auto-reconnects MCP servers when the config changes. You can also manually reconnect from the MCP Server view in the Kiro feature panel, or search the command palette for "MCP".

---

## Configuration

All configuration is done via environment variables in the MCP config — no code changes needed.

| Env Variable         | Default                            | Description                                                   |
| -------------------- | ---------------------------------- | ------------------------------------------------------------- |
| `WORKSPACE_BASE_DIR` | `/Users/johanes.saragih/Documents` | The parent directory where your projects live                 |
| `WORKSPACE_PATTERN`  | `krom-*`                           | Glob-like pattern to match project directories (prefix match) |

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

## Troubleshooting

### Server not showing up in Kiro

1. Check that `bun` is in your PATH — run `which bun` in terminal
2. Verify the absolute path in `args` points to the correct `src/index.ts`
3. Check `~/.kiro/settings/mcp.json` is valid JSON (no trailing commas, etc.)
4. Look at the MCP Server panel in Kiro for connection errors

### No projects discovered

1. Verify `WORKSPACE_BASE_DIR` points to the right parent directory
2. Check that directories matching `WORKSPACE_PATTERN` actually exist there
3. Test manually: `ls ~/Documents | grep krom-`

### "Access denied" errors

The file you're trying to read is outside the discovered project roots. Check that the project directory matches the pattern and exists in the base directory.

---

## Development

```bash
# Run with watch mode (auto-restart on changes)
bun --watch src/index.ts

# Type check
bunx tsc --noEmit

# Test discovery manually
bun -e "import { ALLOWED_ROOTS } from './src/config.ts'; console.log(ALLOWED_ROOTS)"
```

---

## License

Internal tool — Krom Bank Technology Engineering.
