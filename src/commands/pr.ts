import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { getCurrentProject } from "./project.js";
import { getPlanById, getPlansByProject } from "../db/repositories/plan.js";
import { getTaskById, getTasksByPlan, updateTaskStatus } from "../db/repositories/task.js";
import {
  createPr as createPrRecord,
  getPrByTaskId,
  updatePrStatus,
} from "../db/repositories/pr.js";
import {
  createPr as ghCreatePr,
  getPr as ghGetPr,
  mergePr as ghMergePr,
  closePr as ghClosePr,
  isGhAvailable,
  convertPrStatus,
} from "../integrations/github.js";
import { push } from "../integrations/git.js";

export function registerPrCommand(program: Command): void {
  const prCmd = program.command("pr").description("Manage pull requests");

  prCmd
    .command("create <task-id>")
    .description("Create a pull request for a task")
    .option("-d, --draft", "Create as draft PR")
    .option("-t, --title <title>", "PR title")
    .action(async (taskId: string, options: { draft?: boolean; title?: string }) => {
      await createPr(taskId, options);
    });

  prCmd
    .command("list")
    .alias("ls")
    .description("List pull requests")
    .option("-p, --plan-id <id>", "Filter by plan ID")
    .option("-s, --status <status>", "Filter by status")
    .action(async (options: { planId?: string; status?: string }) => {
      await listPrs(options);
    });

  prCmd
    .command("sync [task-id]")
    .description("Sync PR status from GitHub")
    .action(async (taskId?: string) => {
      await syncPrs(taskId);
    });

  prCmd
    .command("merge <task-id>")
    .description("Merge a pull request")
    .option("--squash", "Squash merge")
    .action(async (taskId: string, options: { squash?: boolean }) => {
      await mergePr(taskId, options);
    });

  prCmd
    .command("close <task-id>")
    .description("Close a pull request without merging")
    .action(async (taskId: string) => {
      await closePr(taskId);
    });
}

async function createPr(
  taskId: string,
  options: { draft?: boolean; title?: string }
): Promise<void> {
  const project = await getCurrentProject();
  if (!project) {
    console.error(chalk.red("No project found in current directory"));
    process.exit(1);
  }

  // Check gh CLI
  const ghAvailable = await isGhAvailable();
  if (!ghAvailable) {
    console.error(chalk.red("GitHub CLI (gh) not available or not authenticated"));
    console.error(chalk.gray("Install with: brew install gh"));
    console.error(chalk.gray("Then run: gh auth login"));
    process.exit(1);
  }

  // Find task
  const task = await findTask(taskId, project.id);
  if (!task) {
    console.error(chalk.red(`Task not found: ${taskId}`));
    process.exit(1);
  }

  // Check if PR already exists
  const existingPr = await getPrByTaskId(task.id);
  if (existingPr) {
    console.log(chalk.yellow("PR already exists for this task"));
    console.log(`  PR #${existingPr.number}: ${existingPr.url}`);
    return;
  }

  // Check if task has a branch
  if (!task.branchName) {
    console.error(chalk.red("Task has no branch assigned"));
    console.error(chalk.gray("Start the task first with: taskctl task start <task-id>"));
    process.exit(1);
  }

  const plan = await getPlanById(task.planId);
  if (!plan) {
    console.error(chalk.red("Plan not found"));
    process.exit(1);
  }

  const spinner = ora("Creating pull request...").start();

  try {
    // Push branch to remote from the project path
    spinner.text = "Pushing branch to remote...";
    await push(project.path, "origin", task.branchName, true);

    // Create PR
    spinner.text = "Creating PR on GitHub...";

    const prTitle = options.title ?? task.title;
    const prBody = generatePrBody(task, plan);

    const prInfo = await ghCreatePr(project.path, {
      title: prTitle,
      body: prBody,
      baseBranch: plan.sourceBranch,
      headBranch: task.branchName,
      draft: options.draft,
    });

    // Save PR to database
    await createPrRecord({
      taskId: task.id,
      number: prInfo.number,
      url: prInfo.url,
      status: options.draft ? "draft" : "open",
      baseBranch: plan.sourceBranch,
      headBranch: task.branchName,
    });

    // Update task status
    await updateTaskStatus(task.id, "pr_created");

    spinner.succeed("Pull request created");

    console.log("");
    console.log(chalk.green(`PR #${prInfo.number} created`));
    console.log(`  URL: ${chalk.cyan(prInfo.url)}`);
    console.log("");
  } catch (error) {
    spinner.fail("Failed to create PR");
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
    process.exit(1);
  }
}

async function listPrs(options: { planId?: string; status?: string }): Promise<void> {
  const project = await getCurrentProject();
  if (!project) {
    console.error(chalk.red("No project found in current directory"));
    process.exit(1);
  }

  let plans;
  if (options.planId) {
    const plan = await findPlan(options.planId, project.id);
    if (!plan) {
      console.error(chalk.red(`Plan not found: ${options.planId}`));
      process.exit(1);
    }
    plans = [plan];
  } else {
    plans = await getPlansByProject(project.id);
  }

  let hasAnyPrs = false;

  for (const plan of plans) {
    const tasks = await getTasksByPlan(plan.id);
    const prsForPlan: Array<{
      pr: Awaited<ReturnType<typeof getPrByTaskId>>;
      task: (typeof tasks)[0];
    }> = [];

    for (const task of tasks) {
      const pr = await getPrByTaskId(task.id);
      if (pr) {
        if (!options.status || pr.status === options.status) {
          prsForPlan.push({ pr, task });
        }
      }
    }

    if (prsForPlan.length === 0) continue;
    hasAnyPrs = true;

    console.log("");
    console.log(chalk.bold(`Plan: ${plan.title}`));
    console.log(
      `  ${chalk.gray("#".padEnd(6))} ${chalk.gray("Status".padEnd(12))} ${chalk.gray("Title")}`
    );
    console.log(chalk.gray("  " + "-".repeat(60)));

    for (const { pr, task } of prsForPlan) {
      if (!pr) continue;
      const statusColor = getPrStatusColor(pr.status);
      console.log(
        `  ${String(pr.number).padEnd(6)} ${statusColor(pr.status.padEnd(12))} ${task.title}`
      );
    }
  }

  if (!hasAnyPrs) {
    console.log(chalk.gray("No pull requests found"));
  }

  console.log("");
}

async function syncPrs(taskId?: string): Promise<void> {
  const project = await getCurrentProject();
  if (!project) {
    console.error(chalk.red("No project found in current directory"));
    process.exit(1);
  }

  const ghAvailable = await isGhAvailable();
  if (!ghAvailable) {
    console.error(chalk.red("GitHub CLI (gh) not available"));
    process.exit(1);
  }

  const spinner = ora("Syncing PR status...").start();

  try {
    if (taskId) {
      // Sync single task
      const task = await findTask(taskId, project.id);
      if (!task) {
        spinner.fail(`Task not found: ${taskId}`);
        process.exit(1);
      }

      const pr = await getPrByTaskId(task.id);
      if (!pr) {
        spinner.fail("No PR found for this task");
        process.exit(1);
      }

      const ghPr = await ghGetPr(project.path, pr.number);
      const newStatus = convertPrStatus(ghPr);

      await updatePrStatus(pr.id, newStatus as Parameters<typeof updatePrStatus>[1]);

      // Update task status if PR is merged
      if (newStatus === "merged") {
        await updateTaskStatus(task.id, "completed");
      }

      spinner.succeed(`PR #${pr.number} synced: ${newStatus}`);
    } else {
      // Sync all PRs
      const plans = await getPlansByProject(project.id);
      let syncedCount = 0;

      for (const plan of plans) {
        const tasks = await getTasksByPlan(plan.id);
        for (const task of tasks) {
          const pr = await getPrByTaskId(task.id);
          if (!pr) continue;

          spinner.text = `Syncing PR #${pr.number}...`;

          try {
            const ghPr = await ghGetPr(project.path, pr.number);
            const newStatus = convertPrStatus(ghPr);

            await updatePrStatus(pr.id, newStatus as Parameters<typeof updatePrStatus>[1]);

            if (newStatus === "merged") {
              await updateTaskStatus(task.id, "completed");
            }

            syncedCount++;
          } catch {
            // Skip PRs that fail to sync
          }
        }
      }

      spinner.succeed(`Synced ${syncedCount} PR(s)`);
    }
  } catch (error) {
    spinner.fail("Failed to sync");
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
    process.exit(1);
  }
}

async function mergePr(taskId: string, options: { squash?: boolean }): Promise<void> {
  const project = await getCurrentProject();
  if (!project) {
    console.error(chalk.red("No project found in current directory"));
    process.exit(1);
  }

  const ghAvailable = await isGhAvailable();
  if (!ghAvailable) {
    console.error(chalk.red("GitHub CLI (gh) not available"));
    process.exit(1);
  }

  const task = await findTask(taskId, project.id);
  if (!task) {
    console.error(chalk.red(`Task not found: ${taskId}`));
    process.exit(1);
  }

  const pr = await getPrByTaskId(task.id);
  if (!pr) {
    console.error(chalk.red("No PR found for this task"));
    process.exit(1);
  }

  const spinner = ora(`Merging PR #${pr.number}...`).start();

  try {
    await ghMergePr(project.path, pr.number, {
      squash: options.squash,
      deleteAfterMerge: true,
    });

    await updatePrStatus(pr.id, "merged");
    await updateTaskStatus(task.id, "completed");

    spinner.succeed(`PR #${pr.number} merged`);
  } catch (error) {
    spinner.fail("Failed to merge PR");
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
    process.exit(1);
  }
}

async function closePr(taskId: string): Promise<void> {
  const project = await getCurrentProject();
  if (!project) {
    console.error(chalk.red("No project found in current directory"));
    process.exit(1);
  }

  const ghAvailable = await isGhAvailable();
  if (!ghAvailable) {
    console.error(chalk.red("GitHub CLI (gh) not available"));
    process.exit(1);
  }

  const task = await findTask(taskId, project.id);
  if (!task) {
    console.error(chalk.red(`Task not found: ${taskId}`));
    process.exit(1);
  }

  const pr = await getPrByTaskId(task.id);
  if (!pr) {
    console.error(chalk.red("No PR found for this task"));
    process.exit(1);
  }

  const spinner = ora(`Closing PR #${pr.number}...`).start();

  try {
    await ghClosePr(project.path, pr.number);
    await updatePrStatus(pr.id, "closed");

    spinner.succeed(`PR #${pr.number} closed`);
  } catch (error) {
    spinner.fail("Failed to close PR");
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
    process.exit(1);
  }
}

function generatePrBody(
  task: { id: string; title: string; description: string },
  plan: { title: string }
): string {
  return `## What
${task.description}

## Why
Part of plan: ${plan.title}

## Task ID
\`${task.id}\`

---
*Created with taskctl*
`;
}

function getPrStatusColor(status: string) {
  switch (status) {
    case "draft":
      return chalk.gray;
    case "open":
      return chalk.blue;
    case "in_review":
      return chalk.yellow;
    case "approved":
      return chalk.green;
    case "merged":
      return chalk.magenta;
    case "closed":
      return chalk.red;
    default:
      return chalk.white;
  }
}

async function findPlan(planId: string, projectId: string) {
  let plan = await getPlanById(planId);
  if (plan) return plan;

  const plans = await getPlansByProject(projectId);
  return plans.find((p) => p.id.startsWith(planId)) ?? null;
}

async function findTask(taskId: string, projectId: string) {
  const task = await getTaskById(taskId);
  if (task) return task;

  // Try prefix match
  const plans = await getPlansByProject(projectId);
  for (const plan of plans) {
    const tasks = await getTasksByPlan(plan.id);
    const found = tasks.find((t) => t.id.startsWith(taskId));
    if (found) return found;
  }

  return null;
}
