import { Command } from "commander";
import chalk from "chalk";
import { getCurrentProject } from "./project.js";
import { getPlansByProject, getPlanById } from "../db/repositories/plan.js";
import { getTasksByPlan } from "../db/repositories/task.js";
import { getWorktreesByProject } from "../db/repositories/worktree.js";
import { shortId } from "../utils/id.js";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show overall project status")
    .option("-p, --plan-id <id>", "Show status for specific plan")
    .option("-j, --json", "Output as JSON")
    .action(async (options: { planId?: string; json?: boolean }) => {
      await showStatus(options);
    });
}

interface StatusData {
  project: {
    id: string;
    name: string;
    path: string;
    mainBranch: string;
  };
  plans: {
    id: string;
    title: string;
    status: string;
    taskCounts: {
      total: number;
      pending: number;
      inProgress: number;
      completed: number;
    };
  }[];
  worktrees: {
    total: number;
    available: number;
    inUse: number;
  };
}

async function showStatus(options: { planId?: string; json?: boolean }): Promise<void> {
  const project = await getCurrentProject();
  if (!project) {
    if (options.json) {
      console.log(JSON.stringify({ error: "No project found" }));
    } else {
      console.error(chalk.red("No project found in current directory"));
      console.error(chalk.gray("Run 'taskctl init' to initialize this repository"));
    }
    process.exit(1);
  }

  const worktrees = await getWorktreesByProject(project.id);

  let plans;
  if (options.planId) {
    const plan = await findPlan(options.planId, project.id);
    if (!plan) {
      if (options.json) {
        console.log(JSON.stringify({ error: "Plan not found" }));
      } else {
        console.error(chalk.red(`Plan not found: ${options.planId}`));
      }
      process.exit(1);
    }
    plans = [plan];
  } else {
    plans = await getPlansByProject(project.id);
  }

  // Build status data
  const statusData: StatusData = {
    project: {
      id: project.id,
      name: project.name,
      path: project.path,
      mainBranch: project.mainBranch,
    },
    plans: [],
    worktrees: {
      total: worktrees.length,
      available: worktrees.filter((w) => w.status === "available").length,
      inUse: worktrees.filter((w) => w.status !== "available").length,
    },
  };

  for (const plan of plans) {
    const tasks = await getTasksByPlan(plan.id);
    statusData.plans.push({
      id: plan.id,
      title: plan.title,
      status: plan.status,
      taskCounts: {
        total: tasks.length,
        pending: tasks.filter((t) => t.status === "pending" || t.status === "ready").length,
        inProgress: tasks.filter(
          (t) =>
            t.status === "assigned" ||
            t.status === "in_progress" ||
            t.status === "pr_created" ||
            t.status === "in_review"
        ).length,
        completed: tasks.filter((t) => t.status === "completed").length,
      },
    });
  }

  if (options.json) {
    console.log(JSON.stringify(statusData, null, 2));
    return;
  }

  // Print formatted output
  console.log("");
  console.log(chalk.bold(`Project: ${project.name}`));
  console.log(chalk.gray(`  ${project.path}`));
  console.log("");

  // Worktrees summary
  console.log(
    chalk.bold("Worktrees: ") +
      chalk.green(`${statusData.worktrees.available} available`) +
      chalk.gray(" / ") +
      chalk.yellow(`${statusData.worktrees.inUse} in use`) +
      chalk.gray(` / ${statusData.worktrees.total} total`)
  );
  console.log("");

  // Plans
  if (statusData.plans.length === 0) {
    console.log(chalk.gray("No plans"));
    console.log(chalk.gray("Create one with 'taskctl plan new \"<title>\"'"));
    return;
  }

  for (const planData of statusData.plans) {
    const plan = plans.find((p) => p.id === planData.id);
    if (!plan) continue;

    const statusColor = getPlanStatusColor(plan.status);
    console.log(
      chalk.bold(`Plan: ${plan.title}`) + chalk.gray(` (${shortId(plan.id)}) `) + statusColor(`[${plan.status}]`)
    );

    // Progress bar
    const total = planData.taskCounts.total;
    if (total > 0) {
      const completed = planData.taskCounts.completed;
      const inProgress = planData.taskCounts.inProgress;
      const pending = planData.taskCounts.pending;

      const progressPercent = Math.round((completed / total) * 100);
      const barWidth = 30;
      const completedWidth = Math.round((completed / total) * barWidth);
      const inProgressWidth = Math.round((inProgress / total) * barWidth);
      const pendingWidth = barWidth - completedWidth - inProgressWidth;

      const bar =
        chalk.green("█".repeat(completedWidth)) +
        chalk.yellow("█".repeat(inProgressWidth)) +
        chalk.gray("░".repeat(pendingWidth));

      console.log(`  ${bar} ${progressPercent}%`);
      console.log(
        chalk.gray(`  ${completed} completed, ${inProgress} in progress, ${pending} pending`)
      );
    }

    // Tasks by level
    const tasks = await getTasksByPlan(plan.id);
    if (tasks.length > 0) {
      const groupedByLevel = groupByLevel(tasks);
      const levels = Object.keys(groupedByLevel)
        .map(Number)
        .sort((a, b) => a - b);

      console.log("");
      console.log(chalk.gray("  Tasks:"));
      for (const level of levels) {
        const levelTasks = groupedByLevel[level] ?? [];
        const isParallel = levelTasks.length > 1;
        console.log(
          chalk.cyan(`    Level ${level}`) + (isParallel ? chalk.gray(" (parallel)") : "") + ":"
        );
        for (const task of levelTasks) {
          const statusIcon = getStatusIcon(task.status);
          const taskInfo = task.worktreeId
            ? chalk.gray(` → wt`)
            : "";
          console.log(`      ${statusIcon} [${shortId(task.id)}] ${task.title}${taskInfo}`);
        }
      }
    }

    console.log("");
  }

  // Show in-use worktrees detail
  const inUseWorktrees = worktrees.filter((w) => w.status !== "available");
  if (inUseWorktrees.length > 0) {
    console.log(chalk.bold("Active Worktrees:"));
    for (const wt of inUseWorktrees) {
      const statusColor = getWorktreeStatusColor(wt.status);
      console.log(`  ${wt.name}: ${statusColor(wt.status)}${wt.branch ? ` (${wt.branch})` : ""}`);
    }
    console.log("");
  }
}

async function findPlan(planId: string, projectId: string) {
  let plan = await getPlanById(planId);
  if (plan) return plan;

  const plans = await getPlansByProject(projectId);
  return plans.find((p) => p.id.startsWith(planId)) ?? null;
}

function groupByLevel(
  tasks: { id: string; level: number; title: string; status: string; worktreeId: string | null }[]
): Record<number, typeof tasks> {
  return tasks.reduce(
    (acc, task) => {
      const level = task.level;
      if (!acc[level]) acc[level] = [];
      acc[level].push(task);
      return acc;
    },
    {} as Record<number, typeof tasks>
  );
}

function getPlanStatusColor(status: string) {
  switch (status) {
    case "draft":
      return chalk.gray;
    case "planning":
      return chalk.blue;
    case "ready":
      return chalk.cyan;
    case "in_progress":
      return chalk.yellow;
    case "completed":
      return chalk.green;
    case "archived":
      return chalk.gray;
    default:
      return chalk.white;
  }
}

function getWorktreeStatusColor(status: string) {
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

function getStatusIcon(status: string): string {
  switch (status) {
    case "pending":
      return chalk.gray("○");
    case "ready":
      return chalk.cyan("◎");
    case "assigned":
      return chalk.blue("●");
    case "in_progress":
      return chalk.yellow("→");
    case "pr_created":
      return chalk.magenta("◆");
    case "in_review":
      return chalk.magenta("◇");
    case "completed":
      return chalk.green("✓");
    case "blocked":
      return chalk.red("✗");
    default:
      return chalk.gray("?");
  }
}
