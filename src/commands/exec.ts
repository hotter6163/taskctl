import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { getCurrentProject } from "./project.js";
import { getPlanById, getPlansByProject } from "../db/repositories/plan.js";
import { getTaskById } from "../db/repositories/task.js";
import { getWorktreeById } from "../db/repositories/worktree.js";
import {
  initializeScheduler,
  getNextBatch,
  assignTaskToWorktree,
  getProgress,
  isComplete,
  hasWorkAvailable,
  type SchedulerContext,
} from "../graph/scheduler.js";
import { shortId } from "../utils/id.js";

export function registerExecCommand(program: Command): void {
  const execCmd = program.command("exec").description("Execute tasks");

  execCmd
    .command("parallel")
    .description("Execute ready tasks in parallel")
    .option("-p, --plan-id <id>", "Plan ID to execute")
    .option("-n, --max-concurrent <n>", "Maximum concurrent tasks", parseInt)
    .option("--dry-run", "Show what would be executed without executing")
    .action(
      async (options: {
        planId?: string;
        maxConcurrent?: number;
        dryRun?: boolean;
      }) => {
        await execParallel(options);
      }
    );

  execCmd
    .command("task <task-id>")
    .description("Assign a specific task to a worktree")
    .action(async (taskId: string) => {
      await execTask(taskId);
    });

  execCmd
    .command("status")
    .description("Show execution status")
    .option("-p, --plan-id <id>", "Plan ID")
    .action(async (options: { planId?: string }) => {
      await execStatus(options);
    });
}

async function execParallel(options: {
  planId?: string;
  maxConcurrent?: number;
  dryRun?: boolean;
}): Promise<void> {
  const project = await getCurrentProject();
  if (!project) {
    console.error(chalk.red("No project found in current directory"));
    process.exit(1);
  }

  // Find the plan
  let plan;
  if (options.planId) {
    plan = await findPlan(options.planId, project.id);
    if (!plan) {
      console.error(chalk.red(`Plan not found: ${options.planId}`));
      process.exit(1);
    }
  } else {
    // Find active plan
    const plans = await getPlansByProject(project.id);
    const activePlans = plans.filter(
      (p) => p.status === "in_progress" || p.status === "ready"
    );
    if (activePlans.length === 0) {
      console.error(chalk.red("No active plans found"));
      console.error(chalk.gray("Start a plan with 'taskctl plan start <plan-id>'"));
      process.exit(1);
    }
    if (activePlans.length > 1) {
      console.error(chalk.red("Multiple active plans found. Specify one with --plan-id"));
      for (const p of activePlans) {
        console.error(chalk.gray(`  ${shortId(p.id)} - ${p.title}`));
      }
      process.exit(1);
    }
    plan = activePlans[0];
  }

  if (!plan) {
    console.error(chalk.red("No plan found"));
    process.exit(1);
  }

  const maxConcurrent = options.maxConcurrent ?? project.worktreeCount;

  const context: SchedulerContext = {
    planId: plan.id,
    projectId: project.id,
    projectPath: project.path,
    mainBranch: project.mainBranch,
    maxConcurrent,
  };

  const spinner = ora("Initializing scheduler...").start();

  try {
    const state = await initializeScheduler(context);
    spinner.stop();

    // Show current progress
    const progress = getProgress(state);
    console.log(chalk.bold(`\nPlan: ${plan.title}`));
    console.log(
      `Progress: ${progress.completed}/${progress.total} completed ` +
        `(${progress.inProgress} in progress, ${progress.pending} pending)`
    );
    console.log("");

    if (isComplete(state)) {
      console.log(chalk.green("✓ All tasks completed!"));
      return;
    }

    if (!hasWorkAvailable(state)) {
      if (progress.inProgress > 0) {
        console.log(chalk.yellow("All available tasks are in progress"));
        console.log(chalk.gray("Complete current tasks to unlock more work"));
      } else {
        console.log(chalk.yellow("No tasks ready to execute"));
        console.log(chalk.gray("Check task dependencies"));
      }
      return;
    }

    // Get next batch
    const batch = await getNextBatch(context, state);

    if (batch.length === 0) {
      console.log(chalk.yellow("No worktrees available for scheduling"));
      return;
    }

    console.log(chalk.bold(`Scheduling ${batch.length} task(s):\n`));

    for (const scheduled of batch) {
      console.log(
        `  ${chalk.cyan(shortId(scheduled.task.id))} ${scheduled.task.title}`
      );
      console.log(chalk.gray(`    Worktree: ${scheduled.worktree.name}`));
      console.log(chalk.gray(`    Branch: ${scheduled.branchName}`));
      console.log("");
    }

    if (options.dryRun) {
      console.log(chalk.yellow("Dry run - no changes made"));
      return;
    }

    // Assign tasks
    const assignSpinner = ora("Assigning tasks to worktrees...").start();

    for (const scheduled of batch) {
      assignSpinner.text = `Assigning ${scheduled.task.title}...`;
      await assignTaskToWorktree(context, state, scheduled);
    }

    assignSpinner.succeed("Tasks assigned");

    console.log("");
    console.log(chalk.bold("Next steps for each task:"));
    for (const scheduled of batch) {
      console.log("");
      console.log(chalk.cyan(`Task: ${scheduled.task.title}`));
      console.log(chalk.gray(`  cd "${scheduled.worktree.path}"`));
      console.log(chalk.gray(`  # Implement the task`));
      console.log(chalk.gray(`  git add . && git commit -m "feat: ${scheduled.task.title}"`));
      console.log(
        chalk.gray(`  taskctl pr create ${shortId(scheduled.task.id)}`)
      );
    }
  } catch (error) {
    spinner.fail("Failed to execute");
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
    process.exit(1);
  }
}

async function execTask(taskId: string): Promise<void> {
  const project = await getCurrentProject();
  if (!project) {
    console.error(chalk.red("No project found in current directory"));
    process.exit(1);
  }

  // Find task
  const task = await findTask(taskId, project.id);
  if (!task) {
    console.error(chalk.red(`Task not found: ${taskId}`));
    process.exit(1);
  }

  // Check if task already has a worktree
  if (task.worktreeId) {
    const worktree = await getWorktreeById(task.worktreeId);
    if (worktree) {
      console.log(chalk.yellow("Task already assigned to a worktree"));
      console.log(`  Worktree: ${worktree.name}`);
      console.log(`  Path: ${worktree.path}`);
      console.log(`  Branch: ${task.branchName ?? "N/A"}`);
      return;
    }
  }

  const plan = await getPlanById(task.planId);
  if (!plan) {
    console.error(chalk.red("Plan not found for task"));
    process.exit(1);
  }

  const context: SchedulerContext = {
    planId: plan.id,
    projectId: project.id,
    projectPath: project.path,
    mainBranch: project.mainBranch,
    maxConcurrent: project.worktreeCount,
  };

  const spinner = ora("Assigning task to worktree...").start();

  try {
    const state = await initializeScheduler(context);
    const batch = await getNextBatch(context, state);

    // Find if this task is in the batch
    let scheduled = batch.find((s) => s.task.id === task.id);

    if (!scheduled) {
      // Check if task has unmet dependencies
      const node = state.graph.nodes.get(task.id);
      if (node) {
        const unmetDeps = node.dependencies.filter(
          (depId) => !state.completedTaskIds.has(depId)
        );
        if (unmetDeps.length > 0) {
          spinner.fail("Task has unmet dependencies");
          console.log(chalk.yellow("Complete these tasks first:"));
          for (const depId of unmetDeps) {
            const depNode = state.graph.nodes.get(depId);
            if (depNode) {
              console.log(
                `  ${shortId(depId)} - ${depNode.task.title} [${depNode.task.status}]`
              );
            }
          }
          process.exit(1);
        }
      }

      spinner.fail("Cannot schedule task");
      console.log(chalk.yellow("No available worktrees or task is not ready"));
      process.exit(1);
    }

    await assignTaskToWorktree(context, state, scheduled);
    spinner.succeed("Task assigned");

    console.log("");
    console.log(chalk.green(`✓ Task assigned to worktree`));
    console.log(`  Worktree: ${scheduled.worktree.name}`);
    console.log(`  Path: ${scheduled.worktree.path}`);
    console.log(`  Branch: ${scheduled.branchName}`);
    console.log("");
    console.log(chalk.gray("Next steps:"));
    console.log(chalk.gray(`  cd "${scheduled.worktree.path}"`));
    console.log(chalk.gray(`  # Implement the task`));
    console.log(chalk.gray(`  git add . && git commit -m "feat: ${task.title}"`));
    console.log(chalk.gray(`  taskctl pr create ${shortId(task.id)}`));
  } catch (error) {
    spinner.fail("Failed to assign task");
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
    process.exit(1);
  }
}

async function execStatus(options: { planId?: string }): Promise<void> {
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
    plans = plans.filter(
      (p) => p.status === "in_progress" || p.status === "ready"
    );
  }

  if (plans.length === 0) {
    console.log(chalk.gray("No active plans"));
    return;
  }

  for (const plan of plans) {
    const context: SchedulerContext = {
      planId: plan.id,
      projectId: project.id,
      projectPath: project.path,
      mainBranch: project.mainBranch,
      maxConcurrent: project.worktreeCount,
    };

    const state = await initializeScheduler(context);
    const progress = getProgress(state);

    console.log("");
    console.log(chalk.bold(`Plan: ${plan.title}`));
    console.log(`Status: ${plan.status}`);

    // Progress bar
    const barWidth = 30;
    const completedWidth = Math.round(
      (progress.completed / progress.total) * barWidth
    );
    const inProgressWidth = Math.round(
      (progress.inProgress / progress.total) * barWidth
    );
    const pendingWidth = barWidth - completedWidth - inProgressWidth;

    const bar =
      chalk.green("█".repeat(completedWidth)) +
      chalk.yellow("█".repeat(inProgressWidth)) +
      chalk.gray("░".repeat(pendingWidth));

    console.log(`Progress: ${bar} ${progress.percentComplete}%`);
    console.log(
      chalk.gray(
        `  ${progress.completed} completed, ${progress.inProgress} in progress, ${progress.pending} pending`
      )
    );

    // Show in-progress tasks
    if (progress.inProgress > 0) {
      console.log("");
      console.log(chalk.bold("In Progress:"));
      for (const taskId of state.inProgressTaskIds) {
        const node = state.graph.nodes.get(taskId);
        if (node) {
          const worktreeId = state.assignedWorktrees.get(taskId);
          const wt = worktreeId ? await getWorktreeById(worktreeId) : null;
          console.log(
            `  → [${shortId(taskId)}] ${node.task.title}` +
              (wt ? chalk.gray(` (${wt.name})`) : "")
          );
        }
      }
    }

    // Show ready tasks
    if (hasWorkAvailable(state)) {
      const nextBatch = await getNextBatch(context, state);
      if (nextBatch.length > 0) {
        console.log("");
        console.log(chalk.bold("Ready to Start:"));
        for (const scheduled of nextBatch.slice(0, 5)) {
          console.log(`  ○ [${shortId(scheduled.task.id)}] ${scheduled.task.title}`);
        }
        if (nextBatch.length > 5) {
          console.log(chalk.gray(`  ... and ${nextBatch.length - 5} more`));
        }
      }
    }
  }

  console.log("");
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
    const state = await initializeScheduler({
      planId: plan.id,
      projectId,
      projectPath: "",
      mainBranch: "",
      maxConcurrent: 1,
    });

    for (const [id, node] of state.graph.nodes) {
      if (id.startsWith(taskId)) {
        return node.task;
      }
    }
  }

  return null;
}
