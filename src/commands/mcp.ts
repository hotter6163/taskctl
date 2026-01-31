import { Command } from "commander";

export function registerMcpCommand(program: Command): void {
  program
    .command("mcp")
    .description("Start MCP server for Claude Code integration")
    .option("--project-path <path>", "Project path (default: cwd)")
    .action(async (options: { projectPath?: string }) => {
      const { startMcpServer } = await import("../mcp/index.js");
      await startMcpServer(options.projectPath);
    });
}
