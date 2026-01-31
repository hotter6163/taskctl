import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { getDbPath, ensureAppDataDir } from "../utils/paths.js";
import * as schema from "./schema.js";

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

/**
 * Get or create database connection
 */
export function getDb() {
  if (!db) {
    ensureAppDataDir();
    const dbPath = getDbPath();
    const client = createClient({
      url: `file:${dbPath}`,
    });
    db = drizzle(client, { schema });
  }
  return db;
}

/**
 * Initialize database with schema
 * Creates tables if they don't exist
 */
export async function initDb(): Promise<void> {
  const database = getDb();

  // Create tables using raw SQL since drizzle-kit migrations require CLI
  await database.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      remote_url TEXT,
      main_branch TEXT NOT NULL DEFAULT 'main',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await database.run(`
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      source_branch TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await database.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      level INTEGER NOT NULL DEFAULT 0,
      estimated_lines INTEGER,
      branch_name TEXT,
      session_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await database.run(`
    CREATE TABLE IF NOT EXISTS task_deps (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      depends_on_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      UNIQUE(task_id, depends_on_id)
    )
  `);

  await database.run(`
    CREATE TABLE IF NOT EXISTS prs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      number INTEGER NOT NULL,
      url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      base_branch TEXT NOT NULL,
      head_branch TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // Create indexes for common queries
  await database.run(`CREATE INDEX IF NOT EXISTS idx_plans_project_id ON plans(project_id)`);
  await database.run(`CREATE INDEX IF NOT EXISTS idx_tasks_plan_id ON tasks(plan_id)`);
  await database.run(`CREATE INDEX IF NOT EXISTS idx_tasks_session_id ON tasks(session_id)`);
  await database.run(`CREATE INDEX IF NOT EXISTS idx_tasks_branch_name ON tasks(branch_name)`);
  await database.run(`CREATE INDEX IF NOT EXISTS idx_task_deps_task_id ON task_deps(task_id)`);
  await database.run(
    `CREATE INDEX IF NOT EXISTS idx_task_deps_depends_on_id ON task_deps(depends_on_id)`
  );
  await database.run(`CREATE INDEX IF NOT EXISTS idx_prs_task_id ON prs(task_id)`);
}

/**
 * Close database connection (for cleanup)
 */
export function closeDb(): void {
  db = null;
}

// Re-export schema
export * from "./schema.js";
