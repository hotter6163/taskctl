import { Agent } from "@mastra/core/agent";
import { createAnthropic } from "@ai-sdk/anthropic";

const anthropicProvider = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface TaskPlan {
  id: string;
  title: string;
  description: string;
  estimatedLines: number;
  dependsOn: string[];
}

export interface PlanningResult {
  tasks: TaskPlan[];
  summary: string;
}

const PLANNING_INSTRUCTIONS = `You are a planning agent that helps decompose software development tasks into small, reviewable changesets following Google's Small CL (Changelist) best practices.

## Your Role
Analyze the given task/feature description and break it down into small, atomic tasks that can be implemented independently and reviewed efficiently.

## Guidelines for Task Decomposition

1. **Size**: Each task should result in ~100 lines of code changes (max 200)
2. **Atomicity**: Each task should be independently testable and deployable
3. **Single Responsibility**: Each task should do one thing well
4. **Clear Dependencies**: Identify which tasks must be completed before others

## Common Patterns for Ordering

For typical feature development, follow this order:
1. Data models / Schema changes
2. Business logic / Services
3. API endpoints / Controllers
4. UI components
5. Integration / E2E tests

For refactoring:
1. Add new abstraction alongside old code
2. Migrate usages incrementally
3. Remove old code

## Output Format

You must respond with a valid JSON object containing:
- tasks: Array of task objects, each with:
  - id: Unique identifier (e.g., "task_001", "task_002")
  - title: Short, descriptive title (max 60 chars)
  - description: Detailed description of what to implement
  - estimatedLines: Estimated lines of code change (number)
  - dependsOn: Array of task IDs this task depends on (empty array if none)
- summary: Brief summary of the overall plan

Example response:
{
  "tasks": [
    {
      "id": "task_001",
      "title": "Add User model with basic fields",
      "description": "Create User model with id, email, passwordHash, createdAt, updatedAt fields. Add migration.",
      "estimatedLines": 50,
      "dependsOn": []
    },
    {
      "id": "task_002",
      "title": "Add password hashing utility",
      "description": "Create utility functions for hashing and verifying passwords using bcrypt.",
      "estimatedLines": 30,
      "dependsOn": []
    },
    {
      "id": "task_003",
      "title": "Implement user registration endpoint",
      "description": "Create POST /api/auth/register endpoint that validates input and creates user.",
      "estimatedLines": 80,
      "dependsOn": ["task_001", "task_002"]
    }
  ],
  "summary": "3 tasks to implement basic user registration: model, password utility, and registration endpoint."
}

## Important Rules

1. ALWAYS respond with valid JSON only - no markdown, no explanations outside JSON
2. Tasks at the same dependency level can be worked on in parallel
3. Never create circular dependencies
4. Be specific in descriptions - mention file names, function names, etc. when possible
5. Consider error handling and edge cases in your estimates
`;

export const planningAgent = new Agent({
  name: "planning-agent",
  instructions: PLANNING_INSTRUCTIONS,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: anthropicProvider("claude-sonnet-4-20250514") as any,
});

/**
 * Generate a task plan from a prompt
 */
export async function generatePlan(
  prompt: string,
  context?: {
    projectStructure?: string;
    existingCode?: string;
    additionalContext?: string;
  }
): Promise<PlanningResult> {
  let fullPrompt = `## Task to Decompose\n\n${prompt}`;

  if (context?.projectStructure) {
    fullPrompt += `\n\n## Project Structure\n\n${context.projectStructure}`;
  }

  if (context?.existingCode) {
    fullPrompt += `\n\n## Relevant Existing Code\n\n${context.existingCode}`;
  }

  if (context?.additionalContext) {
    fullPrompt += `\n\n## Additional Context\n\n${context.additionalContext}`;
  }

  fullPrompt += "\n\nAnalyze this task and provide a decomposition plan as JSON.";

  const response = await planningAgent.generate(fullPrompt);

  // Parse the JSON response
  const text = response.text.trim();

  // Try to extract JSON from the response
  let jsonStr = text;

  // Handle case where model wraps JSON in markdown code block
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch?.[1]) {
    jsonStr = jsonMatch[1].trim();
  }

  try {
    const result = JSON.parse(jsonStr) as PlanningResult;

    // Validate structure
    if (!Array.isArray(result.tasks)) {
      throw new Error("Invalid response: tasks must be an array");
    }

    // Assign IDs if missing
    result.tasks = result.tasks.map((task, index) => ({
      id: task.id || `task_${String(index + 1).padStart(3, "0")}`,
      title: task.title || "Untitled task",
      description: task.description || task.title || "No description",
      estimatedLines: task.estimatedLines || 50,
      dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn : [],
    }));

    return result;
  } catch (error) {
    throw new Error(
      `Failed to parse planning response: ${error instanceof Error ? error.message : "Unknown error"}\n\nRaw response:\n${text}`
    );
  }
}

/**
 * Calculate task levels based on dependencies
 * Returns a map of taskId -> level
 */
export function calculateTaskLevels(tasks: TaskPlan[]): Map<string, number> {
  const levels = new Map<string, number>();
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  function getLevel(taskId: string, visited: Set<string> = new Set()): number {
    if (levels.has(taskId)) {
      return levels.get(taskId)!;
    }

    if (visited.has(taskId)) {
      throw new Error(`Circular dependency detected involving task: ${taskId}`);
    }

    visited.add(taskId);

    const task = taskMap.get(taskId);
    if (!task) {
      return 0;
    }

    if (task.dependsOn.length === 0) {
      levels.set(taskId, 0);
      return 0;
    }

    const maxDepLevel = Math.max(
      ...task.dependsOn.map((depId) => getLevel(depId, new Set(visited)))
    );

    const level = maxDepLevel + 1;
    levels.set(taskId, level);
    return level;
  }

  for (const task of tasks) {
    getLevel(task.id);
  }

  return levels;
}
