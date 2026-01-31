import { eq, and, like, isNotNull } from "drizzle-orm";
import {
  getDb,
  tasks,
  taskDeps,
  type Task,
  type NewTask,
  type TaskDep,
  type NewTaskDep,
  type TaskStatus,
} from "../index.js";
import { generateId, now } from "../../utils/id.js";

/**
 * Create a new task
 */
export async function createTask(
  data: Omit<NewTask, "id" | "createdAt" | "updatedAt">
): Promise<Task> {
  const db = getDb();
  const timestamp = now();
  const task: NewTask = {
    id: generateId(),
    ...data,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await db.insert(tasks).values(task);
  return task as Task;
}

/**
 * Get a task by ID
 */
export async function getTaskById(id: string): Promise<Task | null> {
  const db = getDb();
  const result = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return result[0] ?? null;
}

/**
 * Get a task by ID prefix (for shorthand lookups)
 */
export async function getTaskByIdPrefix(prefix: string): Promise<Task | null> {
  const db = getDb();
  const result = await db
    .select()
    .from(tasks)
    .where(like(tasks.id, `${prefix}%`))
    .limit(2);
  if (result.length === 1) return result[0] ?? null;
  return null;
}

/**
 * Get all tasks for a plan
 */
export async function getTasksByPlan(planId: string): Promise<Task[]> {
  const db = getDb();
  return db.select().from(tasks).where(eq(tasks.planId, planId)).orderBy(tasks.level, tasks.id);
}

/**
 * Get tasks by status within a plan
 */
export async function getTasksByStatus(planId: string, status: TaskStatus): Promise<Task[]> {
  const db = getDb();
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.planId, planId), eq(tasks.status, status)))
    .orderBy(tasks.level, tasks.id);
}

/**
 * Get tasks by level within a plan
 */
export async function getTasksByLevel(planId: string, level: number): Promise<Task[]> {
  const db = getDb();
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.planId, planId), eq(tasks.level, level)))
    .orderBy(tasks.id);
}

/**
 * Update a task
 */
export async function updateTask(
  id: string,
  data: Partial<Omit<Task, "id" | "createdAt" | "updatedAt">>
): Promise<Task | null> {
  const db = getDb();
  const timestamp = now();

  await db
    .update(tasks)
    .set({ ...data, updatedAt: timestamp })
    .where(eq(tasks.id, id));

  return getTaskById(id);
}

/**
 * Update task status
 */
export async function updateTaskStatus(id: string, status: TaskStatus): Promise<Task | null> {
  return updateTask(id, { status });
}

/**
 * Delete a task
 */
export async function deleteTask(id: string): Promise<boolean> {
  const db = getDb();
  const result = await db.delete(tasks).where(eq(tasks.id, id));
  return (result.rowsAffected ?? 0) > 0;
}

/**
 * Find task by session ID
 */
export async function getTaskBySessionId(sessionId: string): Promise<Task | null> {
  const db = getDb();
  const result = await db
    .select()
    .from(tasks)
    .where(eq(tasks.sessionId, sessionId))
    .limit(1);
  return result[0] ?? null;
}

/**
 * Find task by branch name
 */
export async function getTaskByBranchName(branchName: string): Promise<Task | null> {
  const db = getDb();
  const result = await db
    .select()
    .from(tasks)
    .where(eq(tasks.branchName, branchName))
    .limit(1);
  return result[0] ?? null;
}

/**
 * Set session ID for a task
 */
export async function setTaskSessionId(taskId: string, sessionId: string): Promise<Task | null> {
  return updateTask(taskId, { sessionId });
}

/**
 * Clear session ID for a task
 */
export async function clearTaskSessionId(taskId: string): Promise<Task | null> {
  return updateTask(taskId, { sessionId: null });
}

/**
 * Get tasks that have active sessions
 */
export async function getTasksWithSessions(planId?: string): Promise<Task[]> {
  const db = getDb();
  if (planId) {
    return db
      .select()
      .from(tasks)
      .where(and(eq(tasks.planId, planId), isNotNull(tasks.sessionId)))
      .orderBy(tasks.level, tasks.id);
  }
  return db
    .select()
    .from(tasks)
    .where(isNotNull(tasks.sessionId))
    .orderBy(tasks.level, tasks.id);
}

/**
 * Add a dependency between tasks
 */
export async function addTaskDependency(taskId: string, dependsOnId: string): Promise<TaskDep> {
  const db = getDb();
  const dep: NewTaskDep = {
    id: generateId(),
    taskId,
    dependsOnId,
    createdAt: now(),
  };

  await db.insert(taskDeps).values(dep);
  return dep as TaskDep;
}

/**
 * Remove a dependency between tasks
 */
export async function removeTaskDependency(taskId: string, dependsOnId: string): Promise<boolean> {
  const db = getDb();
  const result = await db
    .delete(taskDeps)
    .where(and(eq(taskDeps.taskId, taskId), eq(taskDeps.dependsOnId, dependsOnId)));
  return (result.rowsAffected ?? 0) > 0;
}

/**
 * Get all dependencies for a task
 */
export async function getTaskDependencies(taskId: string): Promise<TaskDep[]> {
  const db = getDb();
  return db.select().from(taskDeps).where(eq(taskDeps.taskId, taskId));
}

/**
 * Get all tasks that depend on a specific task
 */
export async function getTaskDependents(taskId: string): Promise<TaskDep[]> {
  const db = getDb();
  return db.select().from(taskDeps).where(eq(taskDeps.dependsOnId, taskId));
}

/**
 * Get all dependencies for tasks in a plan
 */
export async function getAllDependenciesForPlan(planId: string): Promise<TaskDep[]> {
  const planTasks = await getTasksByPlan(planId);
  const taskIds = planTasks.map((t) => t.id);

  if (taskIds.length === 0) return [];

  const allDeps: TaskDep[] = [];
  for (const taskId of taskIds) {
    const deps = await getTaskDependencies(taskId);
    allDeps.push(...deps);
  }
  return allDeps;
}
