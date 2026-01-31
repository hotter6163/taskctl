import { Command } from "commander";
import chalk from "chalk";
import {
  getTaskById,
  getTasksByPlan,
  setTaskSessionId,
  clearTaskSessionId,
} from "../db/repositories/task.js";
import { getPlanById, getPlansByProject } from "../db/repositories/plan.js";
import { getCurrentProject } from "./project.js";
import { shortId } from "../utils/id.js";

export function registerSessionCommand(program: Command): void {
  const sessionCmd = program.command("session").description("Manage Claude Code sessions");

  sessionCmd
    .command("set <task-id> <session-id>")
    .description("Register a Claude Code session ID for a task")
    .action(async (taskId: string, sessionId: string) => {
      await setSession(taskId, sessionId);
    });

  sessionCmd
    .command("list")
    .alias("ls")
    .description("List session-to-task mappings")
    .option("-p, --plan-id <id>", "Filter by plan ID")
    .action(async (options: { planId?: string }) => {
      await listSessions(options);
    });

  sessionCmd
    .command("clear <task-id>")
    .description("Clear the session ID for a task")
    .action(async (taskId: string) => {
      await clearSession(taskId);
    });
}

async function setSession(taskId: string, sessionId: string): Promise<void> {
  const task = await findTask(taskId);
  if (!task) {
    console.error(chalk.red(`Task not found: ${taskId}`));
    process.exit(1);
  }

  if (task.status !== "in_progress") {
    console.error(chalk.red(`Task must be in_progress to set a session (current: ${task.status})`));
    console.error(chalk.gray("Start the task first: taskctl task start " + shortId(task.id)));
    process.exit(1);
  }

  await setTaskSessionId(task.id, sessionId);
  console.log(chalk.green("Session registered"));
  console.log("");
  console.log(`  ${chalk.bold("Task:")}       ${task.title}`);
  console.log(`  ${chalk.bold("Branch:")}     ${task.branchName ?? "-"}`);
  console.log(`  ${chalk.bold("Session ID:")} ${sessionId}`);
  console.log("");
  console.log(chalk.gray(`Resume later: taskctl task open ${shortId(task.id)}`));
}

async function listSessions(options: { planId?: string }): Promise<void> {
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

  let hasAny = false;

  for (const plan of plans) {
    const tasks = await getTasksByPlan(plan.id);
    // Show tasks that have a branch or session
    const relevantTasks = tasks.filter((t) => t.branchName || t.sessionId);

    if (relevantTasks.length === 0) continue;
    hasAny = true;

    console.log("");
    console.log(chalk.bold(`Plan: ${plan.title}`));
    console.log(
      `  ${chalk.gray("Task ID".padEnd(10))} ${chalk.gray("Status".padEnd(14))} ${chalk.gray("Branch".padEnd(40))} ${chalk.gray("Session ID")}`
    );
    console.log(chalk.gray("  " + "-".repeat(90)));

    for (const task of relevantTasks) {
      const idShort = shortId(task.id);
      const branch = task.branchName ?? "-";
      const session = task.sessionId ?? "-";
      const statusColor = task.status === "in_progress" ? chalk.yellow : chalk.gray;
      console.log(
        `  ${idShort.padEnd(10)} ${statusColor(task.status.padEnd(14))} ${branch.padEnd(40)} ${session}`
      );
    }
  }

  if (!hasAny) {
    console.log(chalk.gray("No sessions found"));
    console.log(chalk.gray("Start a task and register a session:"));
    console.log(chalk.gray("  taskctl task start <task-id>"));
    console.log(chalk.gray("  taskctl session set <task-id> <session-id>"));
  }
  console.log("");
}

async function clearSession(taskId: string): Promise<void> {
  const task = await findTask(taskId);
  if (!task) {
    console.error(chalk.red(`Task not found: ${taskId}`));
    process.exit(1);
  }

  if (!task.sessionId) {
    console.log(chalk.yellow("Task has no session ID"));
    return;
  }

  await clearTaskSessionId(task.id);
  console.log(chalk.green("Session cleared for task: " + task.title));
}

async function findTask(taskId: string) {
  let task = await getTaskById(taskId);
  if (task) return task;

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
