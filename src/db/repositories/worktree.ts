import { eq, and } from "drizzle-orm";
import {
  getDb,
  worktrees,
  type Worktree,
  type NewWorktree,
  type WorktreeStatus,
} from "../index.js";
import { generateId, now } from "../../utils/id.js";

/**
 * Create a new worktree record
 */
export async function createWorktree(
  data: Omit<NewWorktree, "id" | "createdAt" | "updatedAt">
): Promise<Worktree> {
  const db = getDb();
  const timestamp = now();
  const worktree: NewWorktree = {
    id: generateId(),
    ...data,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await db.insert(worktrees).values(worktree);
  return worktree as Worktree;
}

/**
 * Get a worktree by ID
 */
export async function getWorktreeById(id: string): Promise<Worktree | null> {
  const db = getDb();
  const result = await db.select().from(worktrees).where(eq(worktrees.id, id)).limit(1);
  return result[0] ?? null;
}

/**
 * Get a worktree by name within a project
 */
export async function getWorktreeByName(
  projectId: string,
  name: string
): Promise<Worktree | null> {
  const db = getDb();
  const result = await db
    .select()
    .from(worktrees)
    .where(and(eq(worktrees.projectId, projectId), eq(worktrees.name, name)))
    .limit(1);
  return result[0] ?? null;
}

/**
 * Get all worktrees for a project
 */
export async function getWorktreesByProject(projectId: string): Promise<Worktree[]> {
  const db = getDb();
  return db.select().from(worktrees).where(eq(worktrees.projectId, projectId)).orderBy(worktrees.name);
}

/**
 * Get available worktrees for a project
 */
export async function getAvailableWorktrees(projectId: string): Promise<Worktree[]> {
  const db = getDb();
  return db
    .select()
    .from(worktrees)
    .where(and(eq(worktrees.projectId, projectId), eq(worktrees.status, "available")))
    .orderBy(worktrees.name);
}

/**
 * Get worktrees by status
 */
export async function getWorktreesByStatus(
  projectId: string,
  status: WorktreeStatus
): Promise<Worktree[]> {
  const db = getDb();
  return db
    .select()
    .from(worktrees)
    .where(and(eq(worktrees.projectId, projectId), eq(worktrees.status, status)))
    .orderBy(worktrees.name);
}

/**
 * Update a worktree
 */
export async function updateWorktree(
  id: string,
  data: Partial<Omit<Worktree, "id" | "createdAt" | "updatedAt">>
): Promise<Worktree | null> {
  const db = getDb();
  const timestamp = now();

  await db
    .update(worktrees)
    .set({ ...data, updatedAt: timestamp })
    .where(eq(worktrees.id, id));

  return getWorktreeById(id);
}

/**
 * Assign a worktree to a task
 */
export async function assignWorktree(
  worktreeId: string,
  taskId: string,
  branch: string
): Promise<Worktree | null> {
  return updateWorktree(worktreeId, {
    taskId,
    branch,
    status: "assigned",
  });
}

/**
 * Release a worktree (make it available again)
 */
export async function releaseWorktree(id: string): Promise<Worktree | null> {
  return updateWorktree(id, {
    taskId: null,
    branch: null,
    status: "available",
  });
}

/**
 * Update worktree status
 */
export async function updateWorktreeStatus(
  id: string,
  status: WorktreeStatus
): Promise<Worktree | null> {
  return updateWorktree(id, { status });
}

/**
 * Delete a worktree record
 */
export async function deleteWorktree(id: string): Promise<boolean> {
  const db = getDb();
  const result = await db.delete(worktrees).where(eq(worktrees.id, id));
  return (result.rowsAffected ?? 0) > 0;
}

/**
 * Delete all worktrees for a project
 */
export async function deleteWorktreesByProject(projectId: string): Promise<number> {
  const db = getDb();
  const result = await db.delete(worktrees).where(eq(worktrees.projectId, projectId));
  return result.rowsAffected ?? 0;
}
