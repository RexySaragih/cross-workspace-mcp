import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { features } from "./config.js";
import { registerCreateDir } from "./tools/create-dir.js";
import { registerCreateFile } from "./tools/create-file.js";
import { registerDeleteFile } from "./tools/delete-file.js";
import { registerDiagnoseFile } from "./tools/diagnose-file.js";
import { registerEditFile } from "./tools/edit-file.js";
import { registerGrepContent } from "./tools/grep-content.js";
import { registerListDir } from "./tools/list-dir.js";
import {
  registerProjectOverview,
  registerRefreshProjects,
} from "./tools/project-overview.js";
import { registerReadFile } from "./tools/read-file.js";
import { registerReadMultipleFiles } from "./tools/read-multiple-files.js";
import { registerSearchFiles } from "./tools/search-files.js";
import { registerWriteFile } from "./tools/write-file.js";

export const SERVER_VERSION = "2.0.0";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "cross-workspace",
    version: SERVER_VERSION,
  });

  registerProjectOverview(server);
  registerRefreshProjects(server);
  registerReadFile(server);
  registerReadMultipleFiles(server);
  registerListDir(server);
  registerSearchFiles(server);
  registerGrepContent(server);
  registerDiagnoseFile(server);

  // Withholding the write tools entirely is stronger than refusing each call:
  // a read-only server cannot advertise a capability it will not honour.
  if (!features.readOnly) {
    registerEditFile(server);
    registerWriteFile(server);
    registerCreateFile(server);
    registerCreateDir(server);
    registerDeleteFile(server);
  }

  return server;
}
