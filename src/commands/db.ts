import { Command } from "commander";
import chalk from "chalk";
import { existsSync, unlinkSync } from "node:fs";
import { getDbPath } from "../utils/paths.js";
import { closeDb, initDb } from "../db/index.js";

export function registerDbCommand(program: Command): void {
  const dbCmd = program.command("db").description("Database management");

  dbCmd
    .command("reset")
    .description("Reset the database (deletes all data)")
    .option("-f, --force", "Skip confirmation")
    .action(async (options: { force?: boolean }) => {
      await resetDb(options);
    });

  dbCmd
    .command("path")
    .description("Show the database file path")
    .action(() => {
      console.log(getDbPath());
    });
}

async function resetDb(options: { force?: boolean }): Promise<void> {
  if (!options.force) {
    console.log(chalk.yellow("This will delete ALL taskctl data (projects, plans, tasks, PRs)."));
    console.log(chalk.gray("Use --force to skip this confirmation."));
    console.log("");

    const readline = await import("node:readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) => {
      rl.question(chalk.bold("Are you sure? (yes/N): "), resolve);
    });
    rl.close();

    if (answer.toLowerCase() !== "yes") {
      console.log("Aborted.");
      return;
    }
  }

  const dbPath = getDbPath();

  // Close existing connection
  closeDb();

  // Delete DB file
  if (existsSync(dbPath)) {
    unlinkSync(dbPath);
  }

  // Re-initialize with fresh schema
  await initDb();

  console.log(chalk.green("Database reset successfully."));
}
