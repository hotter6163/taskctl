import { Command } from "commander";
import chalk from "chalk";
import {
  createTask,
  getTaskById,
  getTasksByPlan,
  updateTask,
  updateTaskStatus,
  deleteTask,
  addTaskDependency,
  removeTaskDependency,
  getTaskDependencies,
} from "../db/repositories/task.js";
import { getPlanById, getPlansByProject } from "../db/repositories/plan.js";
import { getAvailableWorktrees, assignWorktree } from "../db/repositories/worktree.js";
import { getCurrentProject } from "./project.js";
import { shortId } from "../utils/id.js";
import type { TaskStatus } from "../db/schema.js";

export function registerTaskCommand(program: Command): void {
  const taskCmd = program.command("task").description("Manage tasks");

  taskCmd
    .command("list")
    .alias("ls")
    .description("List tasks")
    .option("-p, --plan-id <id>", "Filter by plan ID")
    .option("-s, --status <status>", "Filter by status")
    .action(async (options: { planId?: string; status?: string }) => {
      await listTasks(options);
    });

  taskCmd
    .command("show <task-id>")
    .description("Show task details")
    .action(async (taskId: string) => {
      await showTask(taskId);
    });

  taskCmd
    .command("add")
    .description("Add a task manually")
    .requiredOption("-p, --plan-id <id>", "Plan ID")
    .requiredOption("-t, --title <title>", "Task title")
    .option("-d, --description <description>", "Task description")
    .option("--depends-on <ids...>", "Task IDs this task depends on")
    .option("-l, --level <level>", "Task level in DAG", parseInt)
    .option("-e, --estimated-lines <lines>", "Estimated lines of change", parseInt)
    .action(
      async (options: {
        planId: string;
        title: string;
        description?: string;
        dependsOn?: string[];
        level?: number;
        estimatedLines?: number;
      }) => {
        await addTask(options);
      }
    );

  taskCmd
    .command("edit <task-id>")
    .description("Edit a task")
    .option("-t, --title <title>", "New title")
    .option("-d, --description <description>", "New description")
    .option("-l, --level <level>", "New level", parseInt)
    .option("-e, --estimated-lines <lines>", "Estimated lines", parseInt)
    .action(
      async (
        taskId: string,
        options: {
          title?: string;
          description?: string;
          level?: number;
          estimatedLines?: number;
        }
      ) => {
        await editTask(taskId, options);
      }
    );

  taskCmd
    .command("delete <task-id>")
    .description("Delete a task")
    .action(async (taskId: string) => {
      await removeTask(taskId);
    });

  taskCmd
    .command("depends <task-id>")
    .description("Add a dependency")
    .requiredOption("--on <dependency-id>", "Task ID to depend on")
    .action(async (taskId: string, options: { on: string }) => {
      await addDependency(taskId, options.on);
    });

  taskCmd
    .command("undepends <task-id>")
    .description("Remove a dependency")
    .requiredOption("--on <dependency-id>", "Task ID to remove dependency from")
    .action(async (taskId: string, options: { on: string }) => {
      await removeDependency(taskId, options.on);
    });

  taskCmd
    .command("start <task-id>")
    .description("Start a task (assign worktree)")
    .action(async (taskId: string) => {
      await startTask(taskId);
    });

  taskCmd
    .command("complete <task-id>")
    .description("Mark a task as completed")
    .action(async (taskId: string) => {
      await completeTask(taskId);
    });
}

async function listTasks(options: { planId?: string; status?: string }): Promise<void> {
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

  let hasAnyTasks = false;

  for (const plan of plans) {
    let tasks = await getTasksByPlan(plan.id);

    if (options.status) {
      tasks = tasks.filter((t) => t.status === options.status);
    }

    if (tasks.length === 0) continue;
    hasAnyTasks = true;

    console.log("");
    console.log(chalk.bold(`Plan: ${plan.title}`));
    console.log(
      `  ${chalk.gray("ID".padEnd(10))} ${chalk.gray("Level".padEnd(6))} ${chalk.gray("Status".padEnd(12))} ${chalk.gray("Title")}`
    );
    console.log(chalk.gray("  " + "-".repeat(60)));

    for (const task of tasks) {
      const idShort = shortId(task.id);
      const statusColor = getStatusColor(task.status);
      console.log(
        `  ${idShort.padEnd(10)} ${task.level.toString().padEnd(6)} ${statusColor(task.status.padEnd(12))} ${task.title}`
      );
    }
  }

  if (!hasAnyTasks) {
    console.log(chalk.gray("No tasks found"));
    console.log(chalk.gray("Add tasks with 'taskctl task add --plan-id <id> --title \"<title>\"'"));
  }
  console.log("");
}

async function showTask(taskId: string): Promise<void> {
  const task = await findTask(taskId);
  if (!task) {
    console.error(chalk.red(`Task not found: ${taskId}`));
    process.exit(1);
  }

  const deps = await getTaskDependencies(task.id);
  const plan = await getPlanById(task.planId);

  console.log("");
  console.log(chalk.bold(`Task: ${task.title}`));
  console.log("");
  console.log(`  ${chalk.bold("ID:")}              ${task.id}`);
  console.log(`  ${chalk.bold("Plan:")}            ${plan?.title ?? "Unknown"}`);
  console.log(`  ${chalk.bold("Status:")}          ${getStatusColor(task.status)(task.status)}`);
  console.log(`  ${chalk.bold("Level:")}           ${task.level}`);
  if (task.description) {
    console.log(`  ${chalk.bold("Description:")}     ${task.description}`);
  }
  if (task.estimatedLines) {
    console.log(`  ${chalk.bold("Estimated lines:")} ${task.estimatedLines}`);
  }
  if (task.worktreeId) {
    console.log(`  ${chalk.bold("Worktree:")}        ${task.worktreeId}`);
  }
  if (task.branchName) {
    console.log(`  ${chalk.bold("Branch:")}          ${task.branchName}`);
  }

  if (deps.length > 0) {
    const depIds = deps.map((d) => shortId(d.dependsOnId)).join(", ");
    console.log(`  ${chalk.bold("Depends on:")}      ${depIds}`);
  }

  console.log(`  ${chalk.bold("Created:")}         ${task.createdAt}`);
  console.log(`  ${chalk.bold("Updated:")}         ${task.updatedAt}`);
  console.log("");
}

async function addTask(options: {
  planId: string;
  title: string;
  description?: string;
  dependsOn?: string[];
  level?: number;
  estimatedLines?: number;
}): Promise<void> {
  const project = await getCurrentProject();
  if (!project) {
    console.error(chalk.red("No project found in current directory"));
    process.exit(1);
  }

  const plan = await findPlan(options.planId, project.id);
  if (!plan) {
    console.error(chalk.red(`Plan not found: ${options.planId}`));
    process.exit(1);
  }

  // Determine level from dependencies or use provided value
  let level = options.level ?? 0;
  if (options.dependsOn && options.dependsOn.length > 0 && options.level === undefined) {
    // Calculate level as max(dependency levels) + 1
    for (const depId of options.dependsOn) {
      const depTask = await findTask(depId);
      if (depTask) {
        level = Math.max(level, depTask.level + 1);
      }
    }
  }

  const task = await createTask({
    planId: plan.id,
    title: options.title,
    description: options.description || options.title,
    level,
    estimatedLines: options.estimatedLines ?? null,
    status: "pending",
  });

  // Add dependencies
  if (options.dependsOn) {
    for (const depId of options.dependsOn) {
      const depTask = await findTask(depId);
      if (depTask) {
        await addTaskDependency(task.id, depTask.id);
      }
    }
  }

  console.log(chalk.green("✓ Task created"));
  console.log("");
  console.log(`  ${chalk.bold("ID:")}     ${task.id}`);
  console.log(`  ${chalk.bold("Title:")}  ${task.title}`);
  console.log(`  ${chalk.bold("Level:")}  ${task.level}`);
  console.log("");
}

async function editTask(
  taskId: string,
  options: {
    title?: string;
    description?: string;
    level?: number;
    estimatedLines?: number;
  }
): Promise<void> {
  const task = await findTask(taskId);
  if (!task) {
    console.error(chalk.red(`Task not found: ${taskId}`));
    process.exit(1);
  }

  const updates: Parameters<typeof updateTask>[1] = {};

  if (options.title !== undefined) updates.title = options.title;
  if (options.description !== undefined) updates.description = options.description;
  if (options.level !== undefined) updates.level = options.level;
  if (options.estimatedLines !== undefined) updates.estimatedLines = options.estimatedLines;

  if (Object.keys(updates).length === 0) {
    console.error(chalk.yellow("No updates provided"));
    return;
  }

  await updateTask(task.id, updates);
  console.log(chalk.green("✓ Task updated"));
}

async function removeTask(taskId: string): Promise<void> {
  const task = await findTask(taskId);
  if (!task) {
    console.error(chalk.red(`Task not found: ${taskId}`));
    process.exit(1);
  }

  await deleteTask(task.id);
  console.log(chalk.green(`✓ Task "${task.title}" deleted`));
}

async function addDependency(taskId: string, dependsOnId: string): Promise<void> {
  const task = await findTask(taskId);
  if (!task) {
    console.error(chalk.red(`Task not found: ${taskId}`));
    process.exit(1);
  }

  const depTask = await findTask(dependsOnId);
  if (!depTask) {
    console.error(chalk.red(`Dependency task not found: ${dependsOnId}`));
    process.exit(1);
  }

  await addTaskDependency(task.id, depTask.id);
  console.log(chalk.green(`✓ Dependency added: ${shortId(task.id)} depends on ${shortId(depTask.id)}`));
}

async function removeDependency(taskId: string, dependsOnId: string): Promise<void> {
  const task = await findTask(taskId);
  if (!task) {
    console.error(chalk.red(`Task not found: ${taskId}`));
    process.exit(1);
  }

  const depTask = await findTask(dependsOnId);
  if (!depTask) {
    console.error(chalk.red(`Dependency task not found: ${dependsOnId}`));
    process.exit(1);
  }

  const removed = await removeTaskDependency(task.id, depTask.id);
  if (removed) {
    console.log(chalk.green(`✓ Dependency removed`));
  } else {
    console.log(chalk.yellow("Dependency not found"));
  }
}

async function startTask(taskId: string): Promise<void> {
  const task = await findTask(taskId);
  if (!task) {
    console.error(chalk.red(`Task not found: ${taskId}`));
    process.exit(1);
  }

  const plan = await getPlanById(task.planId);
  if (!plan) {
    console.error(chalk.red("Plan not found"));
    process.exit(1);
  }

  const project = await getCurrentProject();
  if (!project) {
    console.error(chalk.red("Project not found"));
    process.exit(1);
  }

  // Check if task already has a worktree
  if (task.worktreeId) {
    console.log(chalk.yellow("Task already has a worktree assigned"));
    return;
  }

  // Get available worktree
  const available = await getAvailableWorktrees(project.id);
  if (available.length === 0) {
    console.error(chalk.red("No worktrees available"));
    console.error(chalk.gray("Wait for a worktree to become available or reset one"));
    process.exit(1);
  }

  const worktree = available[0];
  if (!worktree) {
    console.error(chalk.red("Failed to get worktree"));
    process.exit(1);
  }

  // Create branch name
  const branchName = `feature/${shortId(plan.id)}/${shortId(task.id)}-${slugify(task.title)}`;

  // Assign worktree
  await assignWorktree(worktree.id, task.id, branchName);
  await updateTask(task.id, {
    worktreeId: worktree.id,
    branchName,
    status: "in_progress",
  });

  console.log(chalk.green("✓ Task started"));
  console.log("");
  console.log(`  ${chalk.bold("Worktree:")}  ${worktree.name}`);
  console.log(`  ${chalk.bold("Path:")}      ${worktree.path}`);
  console.log(`  ${chalk.bold("Branch:")}    ${branchName}`);
  console.log("");
  console.log(chalk.gray(`cd ${worktree.path}`));
}

async function completeTask(taskId: string): Promise<void> {
  const task = await findTask(taskId);
  if (!task) {
    console.error(chalk.red(`Task not found: ${taskId}`));
    process.exit(1);
  }

  await updateTaskStatus(task.id, "completed");
  console.log(chalk.green(`✓ Task "${task.title}" marked as completed`));
}

async function findTask(taskId: string) {
  // First try exact match
  let task = await getTaskById(taskId);
  if (task) return task;

  // Try prefix match across all tasks in current project
  const project = await getCurrentProject();
  if (!project) return null;

  const plans = await getPlansByProject(project.id);
  for (const plan of plans) {
    const tasks = await getTasksByPlan(plan.id);
    const found = tasks.find((t) => t.id.startsWith(taskId));
    if (found) return found;
  }

  return null;
}

async function findPlan(planId: string, projectId: string) {
  let plan = await getPlanById(planId);
  if (plan) return plan;

  const plans = await getPlansByProject(projectId);
  return plans.find((p) => p.id.startsWith(planId)) ?? null;
}

function getStatusColor(status: TaskStatus) {
  switch (status) {
    case "pending":
      return chalk.gray;
    case "ready":
      return chalk.cyan;
    case "assigned":
      return chalk.blue;
    case "in_progress":
      return chalk.yellow;
    case "pr_created":
      return chalk.magenta;
    case "in_review":
      return chalk.magenta;
    case "completed":
      return chalk.green;
    case "blocked":
      return chalk.red;
    default:
      return chalk.white;
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 30);
}
