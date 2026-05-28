import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerProjectOverview } from "./tools/project-overview.js";
import { registerReadFile } from "./tools/read-file.js";
import { registerReadMultipleFiles } from "./tools/read-multiple-files.js";
import { registerListDir } from "./tools/list-dir.js";
import { registerSearchFiles } from "./tools/search-files.js";
import { registerGrepContent } from "./tools/grep-content.js";

const server = new McpServer({
  name: "cross-workspace",
  version: "1.0.0",
});

// Register all tools
registerProjectOverview(server);
registerReadFile(server);
registerReadMultipleFiles(server);
registerListDir(server);
registerSearchFiles(server);
registerGrepContent(server);

// Connect via stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
