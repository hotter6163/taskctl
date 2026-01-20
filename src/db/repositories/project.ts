import { eq } from "drizzle-orm";
import { getDb, projects, type Project, type NewProject } from "../index.js";
import { generateId, now } from "../../utils/id.js";

/**
 * Create a new project
 */
export async function createProject(
  data: Omit<NewProject, "id" | "createdAt" | "updatedAt">
): Promise<Project> {
  const db = getDb();
  const timestamp = now();
  const project: NewProject = {
    id: generateId(),
    ...data,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await db.insert(projects).values(project);
  return project as Project;
}

/**
 * Get a project by ID
 */
export async function getProjectById(id: string): Promise<Project | null> {
  const db = getDb();
  const result = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return result[0] ?? null;
}

/**
 * Get a project by path
 */
export async function getProjectByPath(path: string): Promise<Project | null> {
  const db = getDb();
  const result = await db.select().from(projects).where(eq(projects.path, path)).limit(1);
  return result[0] ?? null;
}

/**
 * Get all projects
 */
export async function getAllProjects(): Promise<Project[]> {
  const db = getDb();
  return db.select().from(projects).orderBy(projects.createdAt);
}

/**
 * Update a project
 */
export async function updateProject(
  id: string,
  data: Partial<Omit<Project, "id" | "createdAt" | "updatedAt">>
): Promise<Project | null> {
  const db = getDb();
  const timestamp = now();

  await db
    .update(projects)
    .set({ ...data, updatedAt: timestamp })
    .where(eq(projects.id, id));

  return getProjectById(id);
}

/**
 * Delete a project
 */
export async function deleteProject(id: string): Promise<boolean> {
  const db = getDb();
  const result = await db.delete(projects).where(eq(projects.id, id));
  return (result.rowsAffected ?? 0) > 0;
}
