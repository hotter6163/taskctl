import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import {
  createPlan,
  getPlanById,
  getPlansByProject,
  updatePlanStatus,
  deletePlan,
} from "../db/repositories/plan.js";
import { getTasksByPlan, getAllDependenciesForPlan } from "../db/repositories/task.js";
import { getCurrentProject } from "./project.js";
import { getCurrentBranch } from "../integrations/git.js";
import { shortId } from "../utils/id.js";
import { generateAndSavePlan } from "../mastra/workflows/planning.js";
import type { PlanStatus } from "../db/schema.js";

export function registerPlanCommand(program: Command): void {
  const planCmd = program.command("plan").description("Manage plans");

  planCmd
    .command("new <title>")
    .description("Create a new plan")
    .option("-d, --description <description>", "Plan description")
    .option("-b, --branch <branch>", "Source branch (default: current branch)")
    .action(async (title: string, options: { description?: string; branch?: string }) => {
      await createNewPlan(title, options);
    });

  planCmd
    .command("list")
    .alias("ls")
    .description("List all plans")
    .option("-s, --status <status>", "Filter by status")
    .action(async (options: { status?: string }) => {
      await listPlans(options);
    });

  planCmd
    .command("show <plan-id>")
    .description("Show plan details")
    .action(async (planId: string) => {
      await showPlan(planId);
    });

  planCmd
    .command("graph <plan-id>")
    .description("Show dependency graph")
    .option("-f, --format <format>", "Output format (ascii|mermaid)", "ascii")
    .action(async (planId: string, options: { format: string }) => {
      await showGraph(planId, options.format);
    });

  planCmd
    .command("start <plan-id>")
    .description("Start a plan (set status to in_progress)")
    .action(async (planId: string) => {
      await startPlan(planId);
    });

  planCmd
    .command("delete <plan-id>")
    .description("Delete a plan")
    .action(async (planId: string) => {
      await removePlan(planId);
    });

  // AI subcommand
  const aiCmd = planCmd.command("ai").description("AI-powered planning");

  aiCmd
    .command("generate <prompt>")
    .description("Generate tasks from prompt using AI")
    .option("-p, --plan-id <id>", "Add to existing plan")
    .option("-b, --branch <branch>", "Source branch")
    .option("-m, --max-lines <lines>", "Max lines per task", parseInt)
    .option("-c, --context <files...>", "Additional context files to include")
    .action(
      async (
        prompt: string,
        options: {
          planId?: string;
          branch?: string;
          maxLines?: number;
          context?: string[];
        }
      ) => {
        await generateTasksWithAI(prompt, options);
      }
    );

  aiCmd
    .command("review <plan-id>")
    .description("Review AI-generated tasks")
    .action(async (planId: string) => {
      await reviewPlan(planId);
    });

  aiCmd
    .command("approve <plan-id>")
    .description("Approve AI-generated tasks")
    .action(async (planId: string) => {
      await approvePlan(planId);
    });
}

async function generateTasksWithAI(
  prompt: string,
  options: {
    planId?: string;
    branch?: string;
    maxLines?: number;
    context?: string[];
  }
): Promise<void> {
  const project = await getCurrentProject();
  if (!project) {
    console.error(chalk.red("No project found in current directory"));
    console.error(chalk.gray("Run 'taskctl init' to initialize this repository"));
    process.exit(1);
  }

  // Check for API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(chalk.red("Error: ANTHROPIC_API_KEY environment variable not set"));
    console.error(chalk.gray("Set it with: export ANTHROPIC_API_KEY=your-api-key"));
    process.exit(1);
  }

  let plan;
  if (options.planId) {
    // Use existing plan
    plan = await findPlan(options.planId);
    if (!plan) {
      console.error(chalk.red(`Plan not found: ${options.planId}`));
      process.exit(1);
    }
  } else {
    // Create new plan
    const sourceBranch = options.branch ?? (await getCurrentBranch(project.path));
    const title = prompt.length > 50 ? prompt.substring(0, 47) + "..." : prompt;
    plan = await createPlan({
      projectId: project.id,
      title,
      description: prompt,
      sourceBranch,
      status: "draft",
    });
    console.log(chalk.green(`✓ Created plan: ${plan.title}`));
  }

  const spinner = ora("Generating tasks with AI...").start();

  try {
    const result = await generateAndSavePlan({
      prompt,
      plan,
      projectPath: project.path,
      maxLinesPerTask: options.maxLines ?? 100,
      contextFiles: options.context,
    });

    spinner.succeed(`Generated ${result.tasks.length} tasks`);

    console.log("");
    console.log(chalk.bold("Summary:"));
    console.log(chalk.gray(`  ${result.summary}`));
    console.log("");
    console.log(chalk.bold("Tasks:"));

    // Group by level
    const byLevel: Record<number, typeof result.tasks> = {};
    for (const task of result.tasks) {
      const levelTasks = byLevel[task.level] ?? [];
      levelTasks.push(task);
      byLevel[task.level] = levelTasks;
    }

    const levels = Object.keys(byLevel)
      .map(Number)
      .sort((a, b) => a - b);

    for (const level of levels) {
      const tasks = byLevel[level] ?? [];
      const isParallel = tasks.length > 1;
      console.log(
        chalk.cyan(`  Level ${level}`) + (isParallel ? chalk.gray(" (parallel)") : "") + ":"
      );
      for (const task of tasks) {
        console.log(`    ○ [${shortId(task.id)}] ${task.title} (~${task.estimatedLines} lines)`);
      }
    }

    console.log("");
    console.log(chalk.gray("Next steps:"));
    console.log(chalk.gray(`  taskctl plan show ${shortId(plan.id)}        # Review the plan`));
    console.log(chalk.gray(`  taskctl plan graph ${shortId(plan.id)}       # View dependency graph`));
    console.log(chalk.gray(`  taskctl plan start ${shortId(plan.id)}       # Start the plan`));
  } catch (error) {
    spinner.fail("Failed to generate tasks");
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
    process.exit(1);
  }
}

async function reviewPlan(planId: string): Promise<void> {
  const plan = await findPlan(planId);
  if (!plan) {
    console.error(chalk.red(`Plan not found: ${planId}`));
    process.exit(1);
  }

  const tasks = await getTasksByPlan(plan.id);
  const deps = await getAllDependenciesForPlan(plan.id);

  console.log("");
  console.log(chalk.bold(`Review Plan: ${plan.title}`));
  console.log(chalk.gray(`Status: ${plan.status}`));
  console.log("");

  if (tasks.length === 0) {
    console.log(chalk.yellow("No tasks in this plan"));
    return;
  }

  // Group by level
  const byLevel: Record<number, typeof tasks> = {};
  for (const task of tasks) {
    const levelTasks = byLevel[task.level] ?? [];
    levelTasks.push(task);
    byLevel[task.level] = levelTasks;
  }

  const levels = Object.keys(byLevel)
    .map(Number)
    .sort((a, b) => a - b);

  for (const level of levels) {
    const levelTasks = byLevel[level] ?? [];
    console.log(chalk.cyan(`Level ${level}:`));
    for (const task of levelTasks) {
      console.log(`  ${chalk.bold(shortId(task.id))} ${task.title}`);
      console.log(chalk.gray(`    ${task.description.substring(0, 100)}${task.description.length > 100 ? "..." : ""}`));
      if (task.estimatedLines) {
        console.log(chalk.gray(`    Estimated: ~${task.estimatedLines} lines`));
      }
      const taskDeps = deps.filter((d) => d.taskId === task.id);
      if (taskDeps.length > 0) {
        console.log(chalk.gray(`    Depends on: ${taskDeps.map((d) => shortId(d.dependsOnId)).join(", ")}`));
      }
      console.log("");
    }
  }

  console.log(chalk.gray("To modify tasks:"));
  console.log(chalk.gray(`  taskctl task edit <task-id> --title "New title"`));
  console.log(chalk.gray(`  taskctl task delete <task-id>`));
  console.log(chalk.gray(`  taskctl task depends <task-id> --on <dep-id>`));
  console.log("");
  console.log(chalk.gray("To approve and start:"));
  console.log(chalk.gray(`  taskctl plan start ${shortId(plan.id)}`));
}

async function approvePlan(planId: string): Promise<void> {
  const plan = await findPlan(planId);
  if (!plan) {
    console.error(chalk.red(`Plan not found: ${planId}`));
    process.exit(1);
  }

  if (plan.status === "in_progress") {
    console.log(chalk.yellow("Plan is already in progress"));
    return;
  }

  await updatePlanStatus(plan.id, "ready");
  console.log(chalk.green(`✓ Plan "${plan.title}" approved and ready`));
  console.log(chalk.gray(`Run 'taskctl plan start ${shortId(plan.id)}' to begin execution`));
}

async function createNewPlan(
  title: string,
  options: { description?: string; branch?: string }
): Promise<void> {
  const project = await getCurrentProject();
  if (!project) {
    console.error(chalk.red("No project found in current directory"));
    console.error(chalk.gray("Run 'taskctl init' to initialize this repository"));
    process.exit(1);
  }

  // Get source branch
  let sourceBranch = options.branch;
  if (!sourceBranch) {
    sourceBranch = await getCurrentBranch(project.path);
  }

  const plan = await createPlan({
    projectId: project.id,
    title,
    description: options.description ?? null,
    sourceBranch,
    status: "draft",
  });

  console.log(chalk.green("✓ Plan created"));
  console.log("");
  console.log(`  ${chalk.bold("ID:")}           ${plan.id}`);
  console.log(`  ${chalk.bold("Title:")}        ${title}`);
  console.log(`  ${chalk.bold("Branch:")}       ${sourceBranch}`);
  console.log(`  ${chalk.bold("Status:")}       ${plan.status}`);
  console.log("");
  console.log(chalk.gray("Next steps:"));
  console.log(chalk.gray(`  taskctl plan ai generate "<prompt>" --plan-id ${shortId(plan.id)}`));
  console.log(chalk.gray(`  taskctl task add --plan-id ${shortId(plan.id)} --title "<title>"`));
}

async function listPlans(options: { status?: string }): Promise<void> {
  const project = await getCurrentProject();
  if (!project) {
    console.error(chalk.red("No project found in current directory"));
    process.exit(1);
  }

  let plans = await getPlansByProject(project.id);

  if (options.status) {
    plans = plans.filter((p) => p.status === options.status);
  }

  if (plans.length === 0) {
    console.log(chalk.gray("No plans found"));
    console.log(chalk.gray("Create one with 'taskctl plan new \"<title>\"'"));
    return;
  }

  console.log(chalk.bold("\nPlans:\n"));
  console.log(
    `  ${chalk.gray("ID".padEnd(10))} ${chalk.gray("Status".padEnd(12))} ${chalk.gray("Title")}`
  );
  console.log(chalk.gray("  " + "-".repeat(50)));

  for (const plan of plans) {
    const idShort = shortId(plan.id);
    const statusColor = getStatusColor(plan.status);
    console.log(
      `  ${idShort.padEnd(10)} ${statusColor(plan.status.padEnd(12))} ${plan.title}`
    );
  }
  console.log("");
}

async function showPlan(planId: string): Promise<void> {
  const plan = await findPlan(planId);
  if (!plan) {
    console.error(chalk.red(`Plan not found: ${planId}`));
    process.exit(1);
  }

  const tasks = await getTasksByPlan(plan.id);

  console.log("");
  console.log(chalk.bold(`Plan: ${plan.title}`));
  console.log("");
  console.log(`  ${chalk.bold("ID:")}           ${plan.id}`);
  console.log(`  ${chalk.bold("Status:")}       ${getStatusColor(plan.status)(plan.status)}`);
  console.log(`  ${chalk.bold("Branch:")}       ${plan.sourceBranch}`);
  if (plan.description) {
    console.log(`  ${chalk.bold("Description:")}  ${plan.description}`);
  }
  console.log(`  ${chalk.bold("Tasks:")}        ${tasks.length}`);
  console.log(`  ${chalk.bold("Created:")}      ${plan.createdAt}`);
  console.log(`  ${chalk.bold("Updated:")}      ${plan.updatedAt}`);
  console.log("");

  if (tasks.length > 0) {
    console.log(chalk.bold("Tasks:"));
    const groupedByLevel = groupByLevel(tasks);
    for (const [level, levelTasks] of Object.entries(groupedByLevel)) {
      console.log(chalk.gray(`\n  Level ${level}:`));
      for (const task of levelTasks) {
        const statusIcon = getStatusIcon(task.status);
        console.log(`    ${statusIcon} [${shortId(task.id)}] ${task.title}`);
      }
    }
    console.log("");
  }
}

async function showGraph(planId: string, format: string): Promise<void> {
  const plan = await findPlan(planId);
  if (!plan) {
    console.error(chalk.red(`Plan not found: ${planId}`));
    process.exit(1);
  }

  const tasks = await getTasksByPlan(plan.id);
  const deps = await getAllDependenciesForPlan(plan.id);

  if (tasks.length === 0) {
    console.log(chalk.gray("No tasks in this plan"));
    return;
  }

  if (format === "mermaid") {
    printMermaidGraph(tasks, deps);
  } else {
    printAsciiGraph(tasks, deps);
  }
}

async function startPlan(planId: string): Promise<void> {
  const plan = await findPlan(planId);
  if (!plan) {
    console.error(chalk.red(`Plan not found: ${planId}`));
    process.exit(1);
  }

  if (plan.status === "in_progress") {
    console.log(chalk.yellow("Plan is already in progress"));
    return;
  }

  await updatePlanStatus(plan.id, "in_progress");
  console.log(chalk.green(`✓ Plan "${plan.title}" started`));
}

async function removePlan(planId: string): Promise<void> {
  const plan = await findPlan(planId);
  if (!plan) {
    console.error(chalk.red(`Plan not found: ${planId}`));
    process.exit(1);
  }

  await deletePlan(plan.id);
  console.log(chalk.green(`✓ Plan "${plan.title}" deleted`));
}

async function findPlan(planId: string) {
  // First try exact match
  let plan = await getPlanById(planId);
  if (plan) return plan;

  // Try prefix match
  const project = await getCurrentProject();
  if (!project) return null;

  const plans = await getPlansByProject(project.id);
  return plans.find((p) => p.id.startsWith(planId)) ?? null;
}

function getStatusColor(status: PlanStatus) {
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

function groupByLevel(
  tasks: { id: string; level: number; title: string; status: string }[]
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

function printAsciiGraph(
  tasks: { id: string; level: number; title: string; status: string }[],
  deps: { taskId: string; dependsOnId: string }[]
): void {
  const groupedByLevel = groupByLevel(tasks);
  const levels = Object.keys(groupedByLevel)
    .map(Number)
    .sort((a, b) => a - b);

  console.log("");
  console.log(chalk.bold("Dependency Graph:"));
  console.log("");

  for (const level of levels) {
    const levelTasks = groupedByLevel[level] ?? [];
    const isParallel = levelTasks.length > 1;

    console.log(
      chalk.cyan(`Level ${level}`) + (isParallel ? chalk.gray(" (parallel)") : "") + ":"
    );

    for (const task of levelTasks) {
      const statusIcon = getStatusIcon(task.status);
      console.log(`  ${statusIcon} [${shortId(task.id)}] ${task.title}`);

      // Show dependencies
      const taskDeps = deps.filter((d) => d.taskId === task.id);
      if (taskDeps.length > 0) {
        const depIds = taskDeps.map((d) => shortId(d.dependsOnId)).join(", ");
        console.log(chalk.gray(`      depends on: ${depIds}`));
      }
    }

    // Draw arrow to next level
    const nextLevelIdx = levels.indexOf(level) + 1;
    if (nextLevelIdx < levels.length) {
      console.log(chalk.gray("      │"));
      console.log(chalk.gray("      ▼"));
    }
  }
  console.log("");
}

function printMermaidGraph(
  tasks: { id: string; level: number; title: string; status: string }[],
  deps: { taskId: string; dependsOnId: string }[]
): void {
  console.log("```mermaid");
  console.log("graph TD");

  // Define nodes
  for (const task of tasks) {
    const sid = shortId(task.id);
    const label = task.title.replace(/"/g, "'");
    console.log(`    ${sid}["${label}"]`);
  }

  // Define edges
  for (const dep of deps) {
    console.log(`    ${shortId(dep.dependsOnId)} --> ${shortId(dep.taskId)}`);
  }

  console.log("```");
}
