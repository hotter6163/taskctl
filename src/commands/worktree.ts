import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { existsSync, rmSync } from "node:fs";
import {
  getWorktreesByProject,
  getWorktreeById,
  createWorktree,
  releaseWorktree,
} from "../db/repositories/worktree.js";
import { getTaskById } from "../db/repositories/task.js";
import { getCurrentProject } from "./project.js";
import { shortId } from "../utils/id.js";
import {
  addWorktree,
  removeWorktree,
  listWorktrees as gitListWorktrees,
  pruneWorktrees,
  checkoutBranch,
} from "../integrations/git.js";
import { getWorktreePath, getWorktreeBasePath, ensureDir } from "../utils/paths.js";
import type { WorktreeStatus } from "../db/schema.js";

export function registerWorktreeCommand(program: Command): void {
  const wtCmd = program.command("wt").description("Manage worktree pool");

  wtCmd
    .command("init")
    .description("Initialize worktree pool")
    .option("-c, --count <count>", "Number of worktrees to create", parseInt)
    .action(async (options: { count?: number }) => {
      await initWorktrees(options.count);
    });

  wtCmd
    .command("list")
    .alias("ls")
    .description("List all worktrees")
    .action(async () => {
      await listWorktrees();
    });

  wtCmd
    .command("status [worktree-id]")
    .description("Show worktree status")
    .action(async (worktreeId?: string) => {
      if (worktreeId) {
        await showWorktreeStatus(worktreeId);
      } else {
        await listWorktrees();
      }
    });

  wtCmd
    .command("reset <worktree-id>")
    .description("Reset a worktree to available state")
    .option("-a, --all", "Reset all worktrees")
    .action(async (worktreeId: string, options: { all?: boolean }) => {
      if (options.all) {
        await resetAllWorktrees();
      } else {
        await resetWorktree(worktreeId);
      }
    });

  wtCmd
    .command("path <worktree-id>")
    .description("Print worktree path")
    .action(async (worktreeId: string) => {
      await printWorktreePath(worktreeId);
    });

  wtCmd
    .command("cd <worktree-id>")
    .description("Print cd command for worktree")
    .action(async (worktreeId: string) => {
      await printWorktreeCd(worktreeId);
    });
}

async function initWorktrees(count?: number): Promise<void> {
  const project = await getCurrentProject();
  if (!project) {
    console.error(chalk.red("No project found in current directory"));
    process.exit(1);
  }

  const existingWorktrees = await getWorktreesByProject(project.id);
  const targetCount = count ?? project.worktreeCount;

  if (existingWorktrees.length >= targetCount) {
    console.log(chalk.yellow(`Already have ${existingWorktrees.length} worktrees`));
    return;
  }

  const toCreate = targetCount - existingWorktrees.length;
  const spinner = ora(`Creating ${toCreate} worktrees...`).start();

  try {
    // Create worktree base directory
    const basePath = getWorktreeBasePath(project.path, project.name);
    ensureDir(basePath);

    // Prune any orphaned worktrees
    await pruneWorktrees(project.path);

    for (let i = existingWorktrees.length; i < targetCount; i++) {
      const wtName = `${project.name}${i}`;
      const wtPath = getWorktreePath(project.path, project.name, i);

      spinner.text = `Creating worktree ${i + 1}/${targetCount}: ${wtName}`;

      // Remove if exists but not in DB
      if (existsSync(wtPath)) {
        try {
          await removeWorktree(project.path, wtPath);
        } catch {
          rmSync(wtPath, { recursive: true, force: true });
        }
      }

      // Create git worktree
      await addWorktree(project.path, wtPath);

      // Register in database
      await createWorktree({
        projectId: project.id,
        name: wtName,
        path: wtPath,
        status: "available",
      });
    }

    spinner.succeed(`Created ${toCreate} worktrees`);
  } catch (error) {
    spinner.fail("Failed to create worktrees");
    throw error;
  }
}

async function listWorktrees(): Promise<void> {
  const project = await getCurrentProject();
  if (!project) {
    console.error(chalk.red("No project found in current directory"));
    process.exit(1);
  }

  const worktrees = await getWorktreesByProject(project.id);

  if (worktrees.length === 0) {
    console.log(chalk.gray("No worktrees found"));
    console.log(chalk.gray("Initialize with 'taskctl wt init'"));
    return;
  }

  // Get git worktree info
  const gitWorktrees = await gitListWorktrees(project.path);
  const gitWorktreeMap = new Map(gitWorktrees.map((wt) => [wt.path, wt]));

  console.log("");
  console.log(chalk.bold("Worktrees:"));
  console.log("");
  console.log(
    `  ${chalk.gray("ID".padEnd(10))} ${chalk.gray("Name".padEnd(15))} ${chalk.gray("Status".padEnd(12))} ${chalk.gray("Task/Branch")}`
  );
  console.log(chalk.gray("  " + "-".repeat(70)));

  for (const wt of worktrees) {
    const idShort = shortId(wt.id);
    const statusColor = getStatusColor(wt.status);
    const gitWt = gitWorktreeMap.get(wt.path);
    const exists = existsSync(wt.path);

    let taskInfo = "";
    if (wt.taskId) {
      const task = await getTaskById(wt.taskId);
      taskInfo = task ? `${shortId(task.id)} - ${task.title.substring(0, 30)}` : wt.taskId;
    } else if (gitWt) {
      taskInfo = chalk.gray(gitWt.branch);
    }

    const nameDisplay = exists ? wt.name : chalk.red(`${wt.name} (missing)`);
    console.log(
      `  ${idShort.padEnd(10)} ${nameDisplay.padEnd(15)} ${statusColor(wt.status.padEnd(12))} ${taskInfo}`
    );
  }

  const available = worktrees.filter((w) => w.status === "available").length;
  console.log("");
  console.log(chalk.gray(`  ${available}/${worktrees.length} available`));
  console.log("");
}

async function showWorktreeStatus(worktreeId: string): Promise<void> {
  const project = await getCurrentProject();
  if (!project) {
    console.error(chalk.red("No project found in current directory"));
    process.exit(1);
  }

  const worktree = await findWorktree(worktreeId, project.id);
  if (!worktree) {
    console.error(chalk.red(`Worktree not found: ${worktreeId}`));
    process.exit(1);
  }

  const exists = existsSync(worktree.path);
  let task = null;
  if (worktree.taskId) {
    task = await getTaskById(worktree.taskId);
  }

  console.log("");
  console.log(chalk.bold(`Worktree: ${worktree.name}`));
  console.log("");
  console.log(`  ${chalk.bold("ID:")}       ${worktree.id}`);
  console.log(`  ${chalk.bold("Path:")}     ${exists ? worktree.path : chalk.red(`${worktree.path} (missing)`)}`);
  console.log(`  ${chalk.bold("Status:")}   ${getStatusColor(worktree.status)(worktree.status)}`);
  if (worktree.branch) {
    console.log(`  ${chalk.bold("Branch:")}   ${worktree.branch}`);
  }
  if (task) {
    console.log(`  ${chalk.bold("Task:")}     ${shortId(task.id)} - ${task.title}`);
  }
  console.log(`  ${chalk.bold("Created:")}  ${worktree.createdAt}`);
  console.log(`  ${chalk.bold("Updated:")}  ${worktree.updatedAt}`);
  console.log("");
}

async function resetWorktree(worktreeId: string): Promise<void> {
  const project = await getCurrentProject();
  if (!project) {
    console.error(chalk.red("No project found in current directory"));
    process.exit(1);
  }

  const worktree = await findWorktree(worktreeId, project.id);
  if (!worktree) {
    console.error(chalk.red(`Worktree not found: ${worktreeId}`));
    process.exit(1);
  }

  const spinner = ora(`Resetting worktree ${worktree.name}...`).start();

  try {
    // Reset to main branch
    if (existsSync(worktree.path)) {
      await checkoutBranch(worktree.path, project.mainBranch);
    }

    // Update database
    await releaseWorktree(worktree.id);

    spinner.succeed(`Worktree ${worktree.name} reset to available`);
  } catch (error) {
    spinner.fail(`Failed to reset worktree ${worktree.name}`);
    throw error;
  }
}

async function resetAllWorktrees(): Promise<void> {
  const project = await getCurrentProject();
  if (!project) {
    console.error(chalk.red("No project found in current directory"));
    process.exit(1);
  }

  const worktrees = await getWorktreesByProject(project.id);
  const spinner = ora(`Resetting ${worktrees.length} worktrees...`).start();

  try {
    for (const wt of worktrees) {
      spinner.text = `Resetting ${wt.name}...`;
      if (existsSync(wt.path)) {
        try {
          await checkoutBranch(wt.path, project.mainBranch);
        } catch {
          // Ignore checkout errors
        }
      }
      await releaseWorktree(wt.id);
    }

    spinner.succeed(`All ${worktrees.length} worktrees reset to available`);
  } catch (error) {
    spinner.fail("Failed to reset worktrees");
    throw error;
  }
}

async function printWorktreePath(worktreeId: string): Promise<void> {
  const project = await getCurrentProject();
  if (!project) {
    console.error(chalk.red("No project found in current directory"));
    process.exit(1);
  }

  const worktree = await findWorktree(worktreeId, project.id);
  if (!worktree) {
    console.error(chalk.red(`Worktree not found: ${worktreeId}`));
    process.exit(1);
  }

  console.log(worktree.path);
}

async function printWorktreeCd(worktreeId: string): Promise<void> {
  const project = await getCurrentProject();
  if (!project) {
    console.error(chalk.red("No project found in current directory"));
    process.exit(1);
  }

  const worktree = await findWorktree(worktreeId, project.id);
  if (!worktree) {
    console.error(chalk.red(`Worktree not found: ${worktreeId}`));
    process.exit(1);
  }

  console.log(`cd "${worktree.path}"`);
}

async function findWorktree(worktreeId: string, projectId: string) {
  // Try exact match
  let worktree = await getWorktreeById(worktreeId);
  if (worktree && worktree.projectId === projectId) return worktree;

  // Try prefix match or name match
  const worktrees = await getWorktreesByProject(projectId);
  return (
    worktrees.find(
      (w) => w.id.startsWith(worktreeId) || w.name === worktreeId || w.name.endsWith(worktreeId)
    ) ?? null
  );
}

function getStatusColor(status: WorktreeStatus) {
  switch (status) {
    case "available":
      return chalk.green;
    case "assigned":
      return chalk.blue;
    case "in_progress":
      return chalk.yellow;
    case "pr_pending":
      return chalk.magenta;
    case "completed":
      return chalk.cyan;
    case "error":
      return chalk.red;
    default:
      return chalk.white;
  }
}
