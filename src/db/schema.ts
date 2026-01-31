import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// Status enums as TypeScript types
export const planStatuses = ["draft", "planning", "ready", "in_progress", "completed", "archived"] as const;
export type PlanStatus = (typeof planStatuses)[number];

export const taskStatuses = [
  "pending",
  "ready",
  "in_progress",
  "pr_created",
  "in_review",
  "completed",
  "blocked",
] as const;
export type TaskStatus = (typeof taskStatuses)[number];

export const prStatuses = ["draft", "open", "in_review", "approved", "merged", "closed"] as const;
export type PrStatus = (typeof prStatuses)[number];

// Projects table
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  path: text("path").notNull().unique(),
  remoteUrl: text("remote_url"),
  mainBranch: text("main_branch").notNull().default("main"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

// Plans table
export const plans = sqliteTable("plans", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  sourceBranch: text("source_branch").notNull(),
  status: text("status").notNull().default("draft").$type<PlanStatus>(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;

// Tasks table
export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  planId: text("plan_id")
    .notNull()
    .references(() => plans.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("pending").$type<TaskStatus>(),
  level: integer("level").notNull().default(0),
  estimatedLines: integer("estimated_lines"),
  branchName: text("branch_name"),
  sessionId: text("session_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

// Task dependencies table
export const taskDeps = sqliteTable("task_deps", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  dependsOnId: text("depends_on_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull(),
});

export type TaskDep = typeof taskDeps.$inferSelect;
export type NewTaskDep = typeof taskDeps.$inferInsert;

// Pull requests table
export const prs = sqliteTable("prs", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  url: text("url").notNull(),
  status: text("status").notNull().default("draft").$type<PrStatus>(),
  baseBranch: text("base_branch").notNull(),
  headBranch: text("head_branch").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type Pr = typeof prs.$inferSelect;
export type NewPr = typeof prs.$inferInsert;
