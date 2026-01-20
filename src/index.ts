#!/usr/bin/env node

import { Command } from "commander";
import { initDb } from "./db/index.js";
import { registerInitCommand } from "./commands/init.js";
import { registerProjectCommand } from "./commands/project.js";
import { registerPlanCommand } from "./commands/plan.js";
import { registerTaskCommand } from "./commands/task.js";
import { registerWorktreeCommand } from "./commands/worktree.js";
import { registerExecCommand } from "./commands/exec.js";
import { registerPrCommand } from "./commands/pr.js";
import { registerStatusCommand } from "./commands/status.js";

const program = new Command();

program
  .name("taskctl")
  .description("AI-Powered Task Management CLI using Mastra framework")
  .version("0.1.0")
  .option("-v, --verbose", "Enable verbose output")
  .option("-q, --quiet", "Minimize output");

// Register commands
registerInitCommand(program);
registerProjectCommand(program);
registerPlanCommand(program);
registerTaskCommand(program);
registerWorktreeCommand(program);
registerExecCommand(program);
registerPrCommand(program);
registerStatusCommand(program);

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
