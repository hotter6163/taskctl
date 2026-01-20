import type { Task, Worktree } from "../db/schema.js";
import { buildDependencyGraph, getReadyTasks, type DependencyGraph } from "./dependency-graph.js";
import { getTasksByPlan, getAllDependenciesForPlan, updateTaskStatus } from "../db/repositories/task.js";
import {
  getAvailableWorktrees,
  assignWorktree,
  updateWorktreeStatus,
} from "../db/repositories/worktree.js";
import { updatePlanStatus } from "../db/repositories/plan.js";
import { createBranch, checkoutBranch } from "../integrations/git.js";
import { shortId } from "../utils/id.js";

export interface SchedulerContext {
  planId: string;
  projectId: string;
  projectPath: string;
  mainBranch: string;
  maxConcurrent: number;
}

export interface ScheduledTask {
  task: Task;
  worktree: Worktree;
  branchName: string;
}

export interface SchedulerState {
  graph: DependencyGraph;
  completedTaskIds: Set<string>;
  inProgressTaskIds: Set<string>;
  assignedWorktrees: Map<string, string>; // taskId -> worktreeId
}

/**
 * Initialize scheduler state for a plan
 */
export async function initializeScheduler(
  context: SchedulerContext
): Promise<SchedulerState> {
  const tasks = await getTasksByPlan(context.planId);
  const deps = await getAllDependenciesForPlan(context.planId);

  const graph = buildDependencyGraph(tasks, deps);

  // Build sets of completed and in-progress tasks
  const completedTaskIds = new Set<string>();
  const inProgressTaskIds = new Set<string>();
  const assignedWorktrees = new Map<string, string>();

  for (const task of tasks) {
    if (task.status === "completed") {
      completedTaskIds.add(task.id);
    } else if (
      task.status === "in_progress" ||
      task.status === "assigned" ||
      task.status === "pr_created" ||
      task.status === "in_review"
    ) {
      inProgressTaskIds.add(task.id);
      if (task.worktreeId) {
        assignedWorktrees.set(task.id, task.worktreeId);
      }
    }
  }

  return {
    graph,
    completedTaskIds,
    inProgressTaskIds,
    assignedWorktrees,
  };
}

/**
 * Get the next batch of tasks to execute
 */
export async function getNextBatch(
  context: SchedulerContext,
  state: SchedulerState
): Promise<ScheduledTask[]> {
  // Get ready tasks
  const readyTasks = getReadyTasks(state.graph, state.completedTaskIds);

  // Filter out tasks already in progress
  const pendingReadyTasks = readyTasks.filter(
    (task) => !state.inProgressTaskIds.has(task.id)
  );

  if (pendingReadyTasks.length === 0) {
    return [];
  }

  // Get available worktrees
  const availableWorktrees = await getAvailableWorktrees(context.projectId);

  // Calculate how many tasks we can schedule
  const currentInProgress = state.inProgressTaskIds.size;
  const slotsAvailable = Math.min(
    context.maxConcurrent - currentInProgress,
    availableWorktrees.length,
    pendingReadyTasks.length
  );

  if (slotsAvailable <= 0) {
    return [];
  }

  // Schedule tasks
  const scheduled: ScheduledTask[] = [];

  for (let i = 0; i < slotsAvailable; i++) {
    const task = pendingReadyTasks[i];
    const worktree = availableWorktrees[i];

    if (!task || !worktree) break;

    // Generate branch name
    const branchName = generateBranchName(context.planId, task);

    scheduled.push({
      task,
      worktree,
      branchName,
    });
  }

  return scheduled;
}

/**
 * Assign a worktree to a task and update state
 */
export async function assignTaskToWorktree(
  context: SchedulerContext,
  state: SchedulerState,
  scheduled: ScheduledTask
): Promise<void> {
  const { task, worktree, branchName } = scheduled;

  // Create branch in the worktree
  try {
    // First checkout main branch to get latest
    await checkoutBranch(worktree.path, context.mainBranch);

    // Create new branch
    await createBranch(worktree.path, branchName, context.mainBranch);
  } catch (error) {
    // If branch creation fails, try to just checkout if it exists
    try {
      await checkoutBranch(worktree.path, branchName);
    } catch {
      throw error;
    }
  }

  // Update worktree in database
  await assignWorktree(worktree.id, task.id, branchName);

  // Update task status
  await updateTaskStatus(task.id, "assigned");

  // Update local state
  state.inProgressTaskIds.add(task.id);
  state.assignedWorktrees.set(task.id, worktree.id);
}

/**
 * Mark a task as in progress
 */
export async function startTask(
  state: SchedulerState,
  taskId: string
): Promise<void> {
  await updateTaskStatus(taskId, "in_progress");

  const worktreeId = state.assignedWorktrees.get(taskId);
  if (worktreeId) {
    await updateWorktreeStatus(worktreeId, "in_progress");
  }
}

/**
 * Mark a task as completed and update state
 */
export async function completeTask(
  state: SchedulerState,
  taskId: string
): Promise<void> {
  await updateTaskStatus(taskId, "completed");

  state.completedTaskIds.add(taskId);
  state.inProgressTaskIds.delete(taskId);

  const worktreeId = state.assignedWorktrees.get(taskId);
  if (worktreeId) {
    await updateWorktreeStatus(worktreeId, "completed");
    state.assignedWorktrees.delete(taskId);
  }
}

/**
 * Mark a task as having a PR created
 */
export async function markPrCreated(
  state: SchedulerState,
  taskId: string
): Promise<void> {
  await updateTaskStatus(taskId, "pr_created");

  const worktreeId = state.assignedWorktrees.get(taskId);
  if (worktreeId) {
    await updateWorktreeStatus(worktreeId, "pr_pending");
  }
}

/**
 * Check if all tasks are completed
 */
export function isComplete(state: SchedulerState): boolean {
  return state.completedTaskIds.size === state.graph.nodes.size;
}

/**
 * Check if there are any tasks that can be scheduled
 */
export function hasWorkAvailable(state: SchedulerState): boolean {
  const readyTasks = getReadyTasks(state.graph, state.completedTaskIds);
  return readyTasks.some((task) => !state.inProgressTaskIds.has(task.id));
}

/**
 * Get progress information
 */
export function getProgress(state: SchedulerState): {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  percentComplete: number;
} {
  const total = state.graph.nodes.size;
  const completed = state.completedTaskIds.size;
  const inProgress = state.inProgressTaskIds.size;
  const pending = total - completed - inProgress;
  const percentComplete = total > 0 ? Math.round((completed / total) * 100) : 0;

  return { total, completed, inProgress, pending, percentComplete };
}

/**
 * Update plan status based on task progress
 */
export async function updatePlanProgress(
  planId: string,
  state: SchedulerState
): Promise<void> {
  if (isComplete(state)) {
    await updatePlanStatus(planId, "completed");
  } else if (state.inProgressTaskIds.size > 0 || state.completedTaskIds.size > 0) {
    await updatePlanStatus(planId, "in_progress");
  }
}

/**
 * Generate a branch name for a task
 */
function generateBranchName(planId: string, task: Task): string {
  const planShort = shortId(planId);
  const taskShort = shortId(task.id);
  const slug = slugify(task.title);
  return `feature/${planShort}/${taskShort}-${slug}`;
}

/**
 * Convert a string to a URL-safe slug
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 30);
}
