import { eq } from "drizzle-orm";
import { getDb, prs, type Pr, type NewPr, type PrStatus } from "../index.js";
import { generateId, now } from "../../utils/id.js";

/**
 * Create a new PR record
 */
export async function createPr(
  data: Omit<NewPr, "id" | "createdAt" | "updatedAt">
): Promise<Pr> {
  const db = getDb();
  const timestamp = now();
  const pr: NewPr = {
    id: generateId(),
    ...data,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await db.insert(prs).values(pr);
  return pr as Pr;
}

/**
 * Get a PR by ID
 */
export async function getPrById(id: string): Promise<Pr | null> {
  const db = getDb();
  const result = await db.select().from(prs).where(eq(prs.id, id)).limit(1);
  return result[0] ?? null;
}

/**
 * Get a PR by task ID
 */
export async function getPrByTaskId(taskId: string): Promise<Pr | null> {
  const db = getDb();
  const result = await db.select().from(prs).where(eq(prs.taskId, taskId)).limit(1);
  return result[0] ?? null;
}

/**
 * Get a PR by GitHub PR number
 */
export async function getPrByNumber(number: number): Promise<Pr | null> {
  const db = getDb();
  const result = await db.select().from(prs).where(eq(prs.number, number)).limit(1);
  return result[0] ?? null;
}

/**
 * Get all PRs for a worktree
 */
export async function getPrsByWorktree(worktreeId: string): Promise<Pr[]> {
  const db = getDb();
  return db.select().from(prs).where(eq(prs.worktreeId, worktreeId)).orderBy(prs.createdAt);
}

/**
 * Update a PR
 */
export async function updatePr(
  id: string,
  data: Partial<Omit<Pr, "id" | "createdAt" | "updatedAt">>
): Promise<Pr | null> {
  const db = getDb();
  const timestamp = now();

  await db
    .update(prs)
    .set({ ...data, updatedAt: timestamp })
    .where(eq(prs.id, id));

  return getPrById(id);
}

/**
 * Update PR status
 */
export async function updatePrStatus(id: string, status: PrStatus): Promise<Pr | null> {
  return updatePr(id, { status });
}

/**
 * Delete a PR record
 */
export async function deletePr(id: string): Promise<boolean> {
  const db = getDb();
  const result = await db.delete(prs).where(eq(prs.id, id));
  return (result.rowsAffected ?? 0) > 0;
}
