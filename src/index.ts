#!/usr/bin/env node

import { Command } from "commander";
import { initDb } from "./db/index.js";
import { registerInitCommand } from "./commands/init.js";
import { registerProjectCommand } from "./commands/project.js";
import { registerPlanCommand } from "./commands/plan.js";
import { registerTaskCommand } from "./commands/task.js";
import { registerSessionCommand } from "./commands/session.js";
import { registerMcpCommand } from "./commands/mcp.js";
import { registerPrCommand } from "./commands/pr.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerDbCommand } from "./commands/db.js";

const program = new Command();

program
  .name("taskctl")
  .description("AI-Powered Task Management CLI with Claude Code session management")
  .version("0.2.0")
  .option("-v, --verbose", "Enable verbose output")
  .option("-q, --quiet", "Minimize output");

// Register commands
registerInitCommand(program);
registerProjectCommand(program);
registerPlanCommand(program);
registerTaskCommand(program);
registerSessionCommand(program);
registerMcpCommand(program);
registerPrCommand(program);
registerStatusCommand(program);
registerDbCommand(program);

// Initialize database and run
async function main() {
  try {
    await initDb();
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
      if (program.opts().verbose) {
        console.error(error.stack);
      }
    } else {
      console.error("An unexpected error occurred");
    }
    process.exit(1);
  }
}

main();
