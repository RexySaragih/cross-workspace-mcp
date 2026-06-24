#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerProjectOverview } from "./tools/project-overview.js";
import { registerReadFile } from "./tools/read-file.js";
import { registerReadMultipleFiles } from "./tools/read-multiple-files.js";
import { registerListDir } from "./tools/list-dir.js";
import { registerSearchFiles } from "./tools/search-files.js";
import { registerGrepContent } from "./tools/grep-content.js";
import { registerEditFile } from "./tools/edit-file.js";
import { registerWriteFile } from "./tools/write-file.js";
import { registerDeleteFile } from "./tools/delete-file.js";
import { registerCreateFile } from "./tools/create-file.js";
import { registerCreateDir } from "./tools/create-dir.js";
import { registerDiagnoseFile } from "./tools/diagnose-file.js";

const server = new McpServer({
  name: "cross-workspace",
  version: "1.2.0",
});

// Register all tools
registerProjectOverview(server);
registerReadFile(server);
registerReadMultipleFiles(server);
registerListDir(server);
registerSearchFiles(server);
registerGrepContent(server);
registerEditFile(server);
registerWriteFile(server);
registerCreateFile(server);
registerCreateDir(server);
registerDeleteFile(server);
registerDiagnoseFile(server);

// Connect via stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
