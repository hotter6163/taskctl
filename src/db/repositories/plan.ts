import { eq, and } from "drizzle-orm";
import { getDb, plans, type Plan, type NewPlan, type PlanStatus } from "../index.js";
import { generateId, now } from "../../utils/id.js";

/**
 * Create a new plan
 */
export async function createPlan(
  data: Omit<NewPlan, "id" | "createdAt" | "updatedAt">
): Promise<Plan> {
  const db = getDb();
  const timestamp = now();
  const plan: NewPlan = {
    id: generateId(),
    ...data,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await db.insert(plans).values(plan);
  return plan as Plan;
}

/**
 * Get a plan by ID
 */
export async function getPlanById(id: string): Promise<Plan | null> {
  const db = getDb();
  const result = await db.select().from(plans).where(eq(plans.id, id)).limit(1);
  return result[0] ?? null;
}

/**
 * Get all plans for a project
 */
export async function getPlansByProject(projectId: string): Promise<Plan[]> {
  const db = getDb();
  return db.select().from(plans).where(eq(plans.projectId, projectId)).orderBy(plans.createdAt);
}

/**
 * Get plans by status
 */
export async function getPlansByStatus(projectId: string, status: PlanStatus): Promise<Plan[]> {
  const db = getDb();
  return db
    .select()
    .from(plans)
    .where(and(eq(plans.projectId, projectId), eq(plans.status, status)))
    .orderBy(plans.createdAt);
}

/**
 * Update a plan
 */
export async function updatePlan(
  id: string,
  data: Partial<Omit<Plan, "id" | "createdAt" | "updatedAt">>
): Promise<Plan | null> {
  const db = getDb();
  const timestamp = now();

  await db
    .update(plans)
    .set({ ...data, updatedAt: timestamp })
    .where(eq(plans.id, id));

  return getPlanById(id);
}

/**
 * Update plan status
 */
export async function updatePlanStatus(id: string, status: PlanStatus): Promise<Plan | null> {
  return updatePlan(id, { status });
}

/**
 * Delete a plan
 */
export async function deletePlan(id: string): Promise<boolean> {
  const db = getDb();
  const result = await db.delete(plans).where(eq(plans.id, id));
  return (result.rowsAffected ?? 0) > 0;
}
