import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolve } from "node:path";
import { initDb } from "../db/index.js";
import { getProjectByPath } from "../db/repositories/project.js";
import { registerPlanTools } from "./tools/plan-tools.js";
import { registerTaskTools } from "./tools/task-tools.js";

export async function startMcpServer(projectPath?: string): Promise<void> {
  // Initialize database
  await initDb();

  // Resolve project
  const resolvedPath = resolve(projectPath ?? process.cwd());
  const project = await resolveProject(resolvedPath);

  if (!project) {
    console.error("No project found. Run 'taskctl init' first.");
    process.exit(1);
  }

  // Create MCP server
  const server = new McpServer({
    name: "taskctl",
    version: "0.2.0",
  });

  // Register tools
  registerPlanTools(server, project.id);
  registerTaskTools(server, project.id);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function resolveProject(path: string) {
  return getProjectByPath(path);
}
