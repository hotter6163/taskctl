import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { generatePlan, calculateTaskLevels } from "../agents/planning.js";
import { createTask, addTaskDependency } from "../../db/repositories/task.js";
import { updatePlanStatus } from "../../db/repositories/plan.js";
import type { Plan } from "../../db/schema.js";

export interface PlanGenerationOptions {
  prompt: string;
  plan: Plan;
  projectPath: string;
  maxLinesPerTask?: number;
  contextFiles?: string[];
}

export interface PlanGenerationResult {
  tasks: Array<{
    id: string;
    title: string;
    description: string;
    level: number;
    estimatedLines: number;
  }>;
  summary: string;
}

/**
 * Gather project context for the planning agent
 */
async function gatherProjectContext(
  projectPath: string,
  contextFiles?: string[]
): Promise<{ projectStructure: string; existingCode?: string }> {
  // Get directory structure (limited depth)
  const structure = getDirectoryStructure(projectPath, 3);
  const projectStructure = `\`\`\`\n${structure}\n\`\`\``;

  // Read context files if provided
  let existingCode: string | undefined;
  if (contextFiles && contextFiles.length > 0) {
    const codeSnippets: string[] = [];
    for (const file of contextFiles) {
      try {
        const filePath = join(projectPath, file);
        const content = readFileSync(filePath, "utf-8");
        codeSnippets.push(`### ${file}\n\`\`\`\n${content.slice(0, 2000)}\n\`\`\``);
      } catch {
        // Skip files that can't be read
      }
    }
    if (codeSnippets.length > 0) {
      existingCode = codeSnippets.join("\n\n");
    }
  }

  // Try to read package.json for additional context
  try {
    const packageJson = readFileSync(join(projectPath, "package.json"), "utf-8");
    const pkg = JSON.parse(packageJson);
    const techStack = [
      pkg.dependencies ? `Dependencies: ${Object.keys(pkg.dependencies).join(", ")}` : "",
      pkg.devDependencies
        ? `Dev Dependencies: ${Object.keys(pkg.devDependencies).join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    if (techStack) {
      return {
        projectStructure: `${projectStructure}\n\n### Tech Stack\n${techStack}`,
        existingCode,
      };
    }
  } catch {
    // No package.json, that's fine
  }

  return { projectStructure, existingCode };
}

/**
 * Get directory structure as a string
 */
function getDirectoryStructure(
  dirPath: string,
  maxDepth: number,
  currentDepth = 0,
  prefix = ""
): string {
  if (currentDepth >= maxDepth) return "";

  const entries = readdirSync(dirPath);
  const lines: string[] = [];

  // Filter and sort entries
  const filteredEntries = entries
    .filter((entry) => {
      // Skip common non-essential directories and files
      const skip = [
        "node_modules",
        ".git",
        ".next",
        "dist",
        "build",
        ".cache",
        "coverage",
        ".DS_Store",
        "*.log",
      ];
      return !skip.some((pattern) => {
        if (pattern.includes("*")) {
          return entry.endsWith(pattern.replace("*", ""));
        }
        return entry === pattern;
      });
    })
    .sort((a, b) => {
      // Directories first
      const aIsDir = statSync(join(dirPath, a)).isDirectory();
      const bIsDir = statSync(join(dirPath, b)).isDirectory();
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      return a.localeCompare(b);
    });

  for (let i = 0; i < filteredEntries.length; i++) {
    const entry = filteredEntries[i];
    if (!entry) continue;

    const isLast = i === filteredEntries.length - 1;
    const entryPath = join(dirPath, entry);
    const isDir = statSync(entryPath).isDirectory();

    const connector = isLast ? "└── " : "├── ";
    lines.push(`${prefix}${connector}${entry}${isDir ? "/" : ""}`);

    if (isDir) {
      const newPrefix = prefix + (isLast ? "    " : "│   ");
      const subTree = getDirectoryStructure(entryPath, maxDepth, currentDepth + 1, newPrefix);
      if (subTree) {
        lines.push(subTree);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Generate tasks from a prompt and save them to the database
 */
export async function generateAndSavePlan(
  options: PlanGenerationOptions
): Promise<PlanGenerationResult> {
  const { prompt, plan, projectPath, maxLinesPerTask = 100, contextFiles } = options;

  // Update plan status to planning
  await updatePlanStatus(plan.id, "planning");

  // Gather project context
  const context = await gatherProjectContext(projectPath, contextFiles);

  // Add max lines constraint to context
  const additionalContext = `Target: Each task should be approximately ${maxLinesPerTask} lines of code changes.`;

  // Generate plan using AI
  const planResult = await generatePlan(prompt, {
    ...context,
    additionalContext,
  });

  // Calculate task levels
  const levels = calculateTaskLevels(planResult.tasks);

  // Create task ID mapping (AI IDs -> DB IDs)
  const taskIdMap = new Map<string, string>();

  // First pass: create all tasks without dependencies
  const createdTasks: Array<{
    id: string;
    aiId: string;
    title: string;
    description: string;
    level: number;
    estimatedLines: number;
  }> = [];

  for (const taskPlan of planResult.tasks) {
    const level = levels.get(taskPlan.id) ?? 0;

    const task = await createTask({
      planId: plan.id,
      title: taskPlan.title,
      description: taskPlan.description,
      level,
      estimatedLines: taskPlan.estimatedLines,
      status: level === 0 ? "ready" : "pending",
    });

    taskIdMap.set(taskPlan.id, task.id);
    createdTasks.push({
      id: task.id,
      aiId: taskPlan.id,
      title: task.title,
      description: task.description,
      level,
      estimatedLines: taskPlan.estimatedLines,
    });
  }

  // Second pass: add dependencies
  for (const taskPlan of planResult.tasks) {
    const taskId = taskIdMap.get(taskPlan.id);
    if (!taskId) continue;

    for (const depAiId of taskPlan.dependsOn) {
      const depId = taskIdMap.get(depAiId);
      if (depId) {
        await addTaskDependency(taskId, depId);
      }
    }
  }

  // Update plan status to ready
  await updatePlanStatus(plan.id, "ready");

  return {
    tasks: createdTasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      level: t.level,
      estimatedLines: t.estimatedLines,
    })),
    summary: planResult.summary,
  };
}
