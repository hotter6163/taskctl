import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getTaskById,
  getTaskByIdPrefix,
  getTasksByPlan,
  getTasksByStatus,
  getTaskDependencies,
  getTaskDependents,
  getTaskBySessionId,
  getTaskByBranchName,
} from "../../db/repositories/task.js";
import { getPrByTaskId } from "../../db/repositories/pr.js";
import { getPlanById, getPlansByProject } from "../../db/repositories/plan.js";
import type { TaskStatus } from "../../db/schema.js";

export function registerTaskTools(server: McpServer, projectId: string): void {
  server.tool(
    "get_task",
    "Get task details including dependencies, dependents, PR info, and plan context",
    {
      task_id: z.string().describe("Task ID (prefix match supported)"),
    },
    async ({ task_id }) => {
      const task = await findTask(task_id, projectId);
      if (!task) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Task not found" }) }],
        };
      }

      // Get dependencies (tasks this task depends on)
      const deps = await getTaskDependencies(task.id);
      const dependencies = await Promise.all(
        deps.map(async (dep) => {
          const depTask = await getTaskById(dep.dependsOnId);
          return depTask
            ? { taskId: depTask.id, title: depTask.title, status: depTask.status }
            : null;
        })
      );

      // Get dependents (tasks that depend on this task)
      const depts = await getTaskDependents(task.id);
      const dependents = await Promise.all(
        depts.map(async (dep) => {
          const depTask = await getTaskById(dep.taskId);
          return depTask
            ? { taskId: depTask.id, title: depTask.title, status: depTask.status }
            : null;
        })
      );

      // Get PR info
      const pr = await getPrByTaskId(task.id);

      // Get plan info
      const plan = await getPlanById(task.planId);

      const result = {
        task: {
          id: task.id,
          title: task.title,
          description: task.description,
          status: task.status,
          level: task.level,
          estimatedLines: task.estimatedLines,
          branchName: task.branchName,
          sessionId: task.sessionId,
        },
        dependencies: dependencies.filter(Boolean),
        dependents: dependents.filter(Boolean),
        pr: pr
          ? { number: pr.number, url: pr.url, status: pr.status }
          : null,
        plan: plan
          ? { id: plan.id, title: plan.title }
          : null,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "list_tasks",
    "List tasks with optional filters by plan, status, or level",
    {
      plan_id: z.string().optional().describe("Filter by plan ID (prefix match supported)"),
      status: z
        .string()
        .optional()
        .describe("Filter by status (pending, ready, in_progress, pr_created, in_review, completed, blocked)"),
      level: z.number().optional().describe("Filter by DAG level"),
    },
    async ({ plan_id, status, level }) => {
      let plans;
      if (plan_id) {
        const plan = await findPlan(plan_id, projectId);
        if (!plan) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "Plan not found" }) }],
          };
        }
        plans = [plan];
      } else {
        plans = await getPlansByProject(projectId);
      }

      const allTasks = [];
      for (const plan of plans) {
        let tasks;
        if (status) {
          tasks = await getTasksByStatus(plan.id, status as TaskStatus);
        } else {
          tasks = await getTasksByPlan(plan.id);
        }

        if (level !== undefined) {
          tasks = tasks.filter((t) => t.level === level);
        }

        for (const task of tasks) {
          allTasks.push({
            id: task.id,
            planId: task.planId,
            planTitle: plan.title,
            title: task.title,
            status: task.status,
            level: task.level,
            estimatedLines: task.estimatedLines,
            branchName: task.branchName,
            sessionId: task.sessionId,
          });
        }
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(allTasks, null, 2) }],
      };
    }
  );

  server.tool(
    "get_current_task",
    "Get the task associated with the current branch or Claude Code session",
    {
      branch_name: z.string().optional().describe("Current git branch name"),
      session_id: z.string().optional().describe("Claude Code session ID"),
    },
    async ({ branch_name, session_id }) => {
      let task = null;

      // Search by session_id first
      if (session_id) {
        task = await getTaskBySessionId(session_id);
      }

      // Fall back to branch_name
      if (!task && branch_name) {
        task = await getTaskByBranchName(branch_name);
      }

      if (!task) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "No task found for the given branch or session",
              }),
            },
          ],
        };
      }

      // Get full task info including plan
      const plan = await getPlanById(task.planId);
      const pr = await getPrByTaskId(task.id);

      // Get dependencies
      const deps = await getTaskDependencies(task.id);
      const dependencies = await Promise.all(
        deps.map(async (dep) => {
          const depTask = await getTaskById(dep.dependsOnId);
          return depTask
            ? { taskId: depTask.id, title: depTask.title, status: depTask.status }
            : null;
        })
      );

      const result = {
        task: {
          id: task.id,
          title: task.title,
          description: task.description,
          status: task.status,
          level: task.level,
          branchName: task.branchName,
          sessionId: task.sessionId,
        },
        dependencies: dependencies.filter(Boolean),
        pr: pr
          ? { number: pr.number, url: pr.url, status: pr.status }
          : null,
        plan: plan
          ? { id: plan.id, title: plan.title, sourceBranch: plan.sourceBranch }
          : null,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}

async function findTask(taskId: string, projectId: string) {
  let task = await getTaskById(taskId);
  if (task) return task;

  // Try prefix match
  task = await getTaskByIdPrefix(taskId);
  if (task) return task;

  // Fallback: search through all plans
  const plans = await getPlansByProject(projectId);
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
