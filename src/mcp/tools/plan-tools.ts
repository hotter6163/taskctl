import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getPlanById, getPlansByProject, getPlansByStatus } from "../../db/repositories/plan.js";
import {
  getTasksByPlan,
  getAllDependenciesForPlan,
} from "../../db/repositories/task.js";
import type { PlanStatus } from "../../db/schema.js";

export function registerPlanTools(server: McpServer, projectId: string): void {
  server.tool(
    "get_plan",
    "Get plan details with all tasks, dependencies, and progress",
    {
      plan_id: z.string().describe("Plan ID (prefix match supported)"),
    },
    async ({ plan_id }) => {
      const plan = await findPlan(plan_id, projectId);
      if (!plan) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Plan not found" }) }],
        };
      }

      const tasks = await getTasksByPlan(plan.id);
      const dependencies = await getAllDependenciesForPlan(plan.id);

      const completed = tasks.filter((t) => t.status === "completed").length;
      const inProgress = tasks.filter(
        (t) =>
          t.status === "in_progress" ||
          t.status === "pr_created" ||
          t.status === "in_review"
      ).length;
      const pending = tasks.filter(
        (t) => t.status === "pending" || t.status === "ready"
      ).length;

      const result = {
        plan: {
          id: plan.id,
          title: plan.title,
          description: plan.description,
          status: plan.status,
          sourceBranch: plan.sourceBranch,
        },
        tasks: tasks.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          status: t.status,
          level: t.level,
          estimatedLines: t.estimatedLines,
          branchName: t.branchName,
          sessionId: t.sessionId,
        })),
        dependencies: dependencies.map((d) => ({
          taskId: d.taskId,
          dependsOnId: d.dependsOnId,
        })),
        progress: {
          total: tasks.length,
          completed,
          inProgress,
          pending,
          percentComplete:
            tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0,
        },
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "list_plans",
    "List all plans for the current project",
    {
      status: z
        .string()
        .optional()
        .describe("Filter by status (draft, planning, ready, in_progress, completed, archived)"),
    },
    async ({ status }) => {
      let plans;
      if (status) {
        plans = await getPlansByStatus(projectId, status as PlanStatus);
      } else {
        plans = await getPlansByProject(projectId);
      }

      const result = await Promise.all(
        plans.map(async (plan) => {
          const tasks = await getTasksByPlan(plan.id);
          const completed = tasks.filter((t) => t.status === "completed").length;

          return {
            id: plan.id,
            title: plan.title,
            status: plan.status,
            sourceBranch: plan.sourceBranch,
            taskCount: tasks.length,
            completedCount: completed,
            percentComplete:
              tasks.length > 0
                ? Math.round((completed / tasks.length) * 100)
                : 0,
          };
        })
      );

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}

async function findPlan(planId: string, projectId: string) {
  let plan = await getPlanById(planId);
  if (plan) return plan;

  const plans = await getPlansByProject(projectId);
  return plans.find((p) => p.id.startsWith(planId)) ?? null;
}
