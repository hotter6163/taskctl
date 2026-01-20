import type { Task, TaskDep } from "../db/schema.js";

export interface TaskNode {
  task: Task;
  dependencies: string[]; // Task IDs this task depends on
  dependents: string[]; // Task IDs that depend on this task
  level: number;
}

export interface DependencyGraph {
  nodes: Map<string, TaskNode>;
  levels: Map<number, string[]>; // level -> task IDs
  maxLevel: number;
}

/**
 * Build a dependency graph from tasks and their dependencies
 */
export function buildDependencyGraph(tasks: Task[], deps: TaskDep[]): DependencyGraph {
  const nodes = new Map<string, TaskNode>();

  // Initialize nodes
  for (const task of tasks) {
    nodes.set(task.id, {
      task,
      dependencies: [],
      dependents: [],
      level: 0,
    });
  }

  // Add dependencies
  for (const dep of deps) {
    const node = nodes.get(dep.taskId);
    const depNode = nodes.get(dep.dependsOnId);

    if (node && depNode) {
      node.dependencies.push(dep.dependsOnId);
      depNode.dependents.push(dep.taskId);
    }
  }

  // Calculate levels using topological sort
  calculateLevels(nodes);

  // Group by levels
  const levels = new Map<number, string[]>();
  let maxLevel = 0;

  for (const [taskId, node] of nodes) {
    const level = node.level;
    if (!levels.has(level)) {
      levels.set(level, []);
    }
    levels.get(level)!.push(taskId);
    maxLevel = Math.max(maxLevel, level);
  }

  return { nodes, levels, maxLevel };
}

/**
 * Calculate levels for all nodes using Kahn's algorithm variant
 */
function calculateLevels(nodes: Map<string, TaskNode>): void {
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(nodeId: string, ancestors: Set<string>): number {
    if (ancestors.has(nodeId)) {
      throw new Error(`Circular dependency detected involving task: ${nodeId}`);
    }

    if (visited.has(nodeId)) {
      return nodes.get(nodeId)?.level ?? 0;
    }

    const node = nodes.get(nodeId);
    if (!node) return 0;

    ancestors.add(nodeId);
    visiting.add(nodeId);

    let maxDepLevel = -1;
    for (const depId of node.dependencies) {
      const depLevel = visit(depId, new Set(ancestors));
      maxDepLevel = Math.max(maxDepLevel, depLevel);
    }

    node.level = maxDepLevel + 1;
    visited.add(nodeId);
    visiting.delete(nodeId);

    return node.level;
  }

  for (const nodeId of nodes.keys()) {
    if (!visited.has(nodeId)) {
      visit(nodeId, new Set());
    }
  }
}

/**
 * Get tasks that are ready to be executed
 * (all dependencies completed)
 */
export function getReadyTasks(
  graph: DependencyGraph,
  completedTaskIds: Set<string>
): Task[] {
  const ready: Task[] = [];

  for (const [taskId, node] of graph.nodes) {
    // Skip already completed tasks
    if (completedTaskIds.has(taskId)) continue;

    // Skip tasks that are already in progress or have other non-ready status
    if (node.task.status !== "pending" && node.task.status !== "ready") {
      continue;
    }

    // Check if all dependencies are completed
    const allDepsCompleted = node.dependencies.every((depId) =>
      completedTaskIds.has(depId)
    );

    if (allDepsCompleted) {
      ready.push(node.task);
    }
  }

  return ready;
}

/**
 * Get tasks at a specific level
 */
export function getTasksAtLevel(graph: DependencyGraph, level: number): Task[] {
  const taskIds = graph.levels.get(level) ?? [];
  return taskIds
    .map((id) => graph.nodes.get(id)?.task)
    .filter((task): task is Task => task !== undefined);
}

/**
 * Check if the graph has any circular dependencies
 */
export function hasCyclicDependencies(tasks: Task[], deps: TaskDep[]): boolean {
  try {
    buildDependencyGraph(tasks, deps);
    return false;
  } catch (error) {
    if (error instanceof Error && error.message.includes("Circular dependency")) {
      return true;
    }
    throw error;
  }
}

/**
 * Get the critical path (longest path through the graph)
 */
export function getCriticalPath(graph: DependencyGraph): Task[] {
  if (graph.nodes.size === 0) return [];

  // Find tasks at the maximum level
  const maxLevelTasks = graph.levels.get(graph.maxLevel) ?? [];
  if (maxLevelTasks.length === 0) return [];

  // Start from a task at max level and trace back
  const startTaskId = maxLevelTasks[0];
  if (!startTaskId) return [];

  const path: Task[] = [];
  let currentId: string | undefined = startTaskId;

  while (currentId) {
    const node = graph.nodes.get(currentId);
    if (!node) break;

    path.unshift(node.task);

    // Find dependency with highest level
    let nextId: string | undefined;
    let maxLevel = -1;

    for (const depId of node.dependencies) {
      const depNode = graph.nodes.get(depId);
      if (depNode && depNode.level > maxLevel) {
        maxLevel = depNode.level;
        nextId = depId;
      }
    }

    currentId = nextId;
  }

  return path;
}

/**
 * Validate that all dependency references exist
 */
export function validateDependencies(
  tasks: Task[],
  deps: TaskDep[]
): { valid: boolean; errors: string[] } {
  const taskIds = new Set(tasks.map((t) => t.id));
  const errors: string[] = [];

  for (const dep of deps) {
    if (!taskIds.has(dep.taskId)) {
      errors.push(`Task ${dep.taskId} not found`);
    }
    if (!taskIds.has(dep.dependsOnId)) {
      errors.push(`Dependency ${dep.dependsOnId} not found for task ${dep.taskId}`);
    }
    if (dep.taskId === dep.dependsOnId) {
      errors.push(`Task ${dep.taskId} cannot depend on itself`);
    }
  }

  return { valid: errors.length === 0, errors };
}
