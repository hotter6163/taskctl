import { Command } from "commander";
import { resolve } from "node:path";
import chalk from "chalk";
import {
  getAllProjects,
  getProjectById,
  getProjectByPath,
  updateProject,
  deleteProject,
} from "../db/repositories/project.js";
import { deleteWorktreesByProject, getWorktreesByProject } from "../db/repositories/worktree.js";
import { loadProjectConfig, saveProjectConfig } from "../utils/config.js";
import { shortId } from "../utils/id.js";
import { removeWorktree } from "../integrations/git.js";
import { existsSync, rmSync } from "node:fs";
import ora from "ora";

export function registerProjectCommand(program: Command): void {
  const projectCmd = program
    .command("project")
    .description("Manage projects");

  projectCmd
    .command("list")
    .alias("ls")
    .description("List all projects")
    .action(async () => {
      await listProjects();
    });

  projectCmd
    .command("show [project-id]")
    .description("Show project details")
    .action(async (projectId?: string) => {
      await showProject(projectId);
    });

  projectCmd
    .command("current")
    .description("Show current project")
    .action(async () => {
      await showCurrentProject();
    });

  projectCmd
    .command("config")
    .description("Update project configuration")
    .option("-w, --worktrees <count>", "Update worktree count", parseInt)
    .option("-b, --main-branch <branch>", "Update main branch")
    .action(async (options: { worktrees?: number; mainBranch?: string }) => {
      await configureProject(options);
    });

  projectCmd
    .command("remove [project-id]")
    .description("Remove a project from taskctl")
    .option("-f, --force", "Force removal including worktrees")
    .action(async (projectId: string | undefined, options: { force?: boolean }) => {
      await removeProject(projectId, options);
    });
}

async function listProjects(): Promise<void> {
  const projects = await getAllProjects();

  if (projects.length === 0) {
    console.log(chalk.gray("No projects initialized"));
    console.log(chalk.gray("Run 'taskctl init' in a git repository to get started"));
    return;
  }

  console.log(chalk.bold("\nProjects:\n"));
  console.log(
    `  ${chalk.gray("ID".padEnd(10))} ${chalk.gray("Name".padEnd(20))} ${chalk.gray("Path")}`
  );
  console.log(chalk.gray("  " + "-".repeat(60)));

  for (const project of projects) {
    const idShort = shortId(project.id);
    const pathExists = existsSync(project.path);
    const pathDisplay = pathExists ? project.path : chalk.red(`${project.path} (not found)`);
    console.log(`  ${idShort.padEnd(10)} ${project.name.padEnd(20)} ${pathDisplay}`);
  }
  console.log("");
}

async function showProject(projectId?: string): Promise<void> {
  let project;

  if (projectId) {
    // Try to find by ID (full or short)
    const projects = await getAllProjects();
    project = projects.find((p) => p.id === projectId || p.id.startsWith(projectId));
    if (!project) {
      console.error(chalk.red(`Project not found: ${projectId}`));
      process.exit(1);
    }
  } else {
    // Use current directory
    project = await getCurrentProject();
    if (!project) {
      console.error(chalk.red("No project found in current directory"));
      console.error(chalk.gray("Run 'taskctl init' to initialize this repository"));
      process.exit(1);
    }
  }

  const worktrees = await getWorktreesByProject(project.id);
  const availableCount = worktrees.filter((w) => w.status === "available").length;

  console.log("");
  console.log(chalk.bold(`Project: ${project.name}`));
  console.log("");
  console.log(`  ${chalk.bold("ID:")}            ${project.id}`);
  console.log(`  ${chalk.bold("Path:")}          ${project.path}`);
  console.log(`  ${chalk.bold("Main branch:")}   ${project.mainBranch}`);
  console.log(`  ${chalk.bold("Worktrees:")}     ${availableCount}/${worktrees.length} available`);
  if (project.remoteUrl) {
    console.log(`  ${chalk.bold("Remote:")}        ${project.remoteUrl}`);
  }
  console.log(`  ${chalk.bold("Created:")}       ${project.createdAt}`);
  console.log(`  ${chalk.bold("Updated:")}       ${project.updatedAt}`);
  console.log("");
}

async function showCurrentProject(): Promise<void> {
  const project = await getCurrentProject();
  if (!project) {
    console.error(chalk.red("No project found in current directory"));
    console.error(chalk.gray("Run 'taskctl init' to initialize this repository"));
    process.exit(1);
  }

  console.log(project.id);
}

async function configureProject(options: {
  worktrees?: number;
  mainBranch?: string;
}): Promise<void> {
  const project = await getCurrentProject();
  if (!project) {
    console.error(chalk.red("No project found in current directory"));
    process.exit(1);
  }

  const updates: { worktreeCount?: number; mainBranch?: string } = {};

  if (options.worktrees !== undefined) {
    updates.worktreeCount = options.worktrees;
  }
  if (options.mainBranch !== undefined) {
    updates.mainBranch = options.mainBranch;
  }

  if (Object.keys(updates).length === 0) {
    console.error(chalk.yellow("No configuration options provided"));
    return;
  }

  const updated = await updateProject(project.id, updates);
  if (updated) {
    // Update local config
    saveProjectConfig(project.path, {
      projectId: updated.id,
      name: updated.name,
      worktreeCount: updated.worktreeCount,
      mainBranch: updated.mainBranch,
    });

    console.log(chalk.green("Project configuration updated"));
    if (options.worktrees !== undefined) {
      console.log(chalk.yellow("Note: Changing worktree count does not add/remove worktrees"));
      console.log(chalk.yellow("Use 'taskctl wt init' to adjust worktree pool"));
    }
  }
}

async function removeProject(
  projectId: string | undefined,
  options: { force?: boolean }
): Promise<void> {
  let project;

  if (projectId) {
    const projects = await getAllProjects();
    project = projects.find((p) => p.id === projectId || p.id.startsWith(projectId));
    if (!project) {
      console.error(chalk.red(`Project not found: ${projectId}`));
      process.exit(1);
    }
  } else {
    project = await getCurrentProject();
    if (!project) {
      console.error(chalk.red("No project found in current directory"));
      process.exit(1);
    }
  }

  const worktrees = await getWorktreesByProject(project.id);
  const inUseWorktrees = worktrees.filter((w) => w.status !== "available");

  if (inUseWorktrees.length > 0 && !options.force) {
    console.error(chalk.red("Cannot remove project: some worktrees are in use"));
    console.error(chalk.gray("Use --force to remove anyway"));
    process.exit(1);
  }

  const spinner = ora("Removing project...").start();

  try {
    // Remove worktrees
    if (options.force) {
      for (const wt of worktrees) {
        try {
          spinner.text = `Removing worktree ${wt.name}...`;
          if (existsSync(wt.path)) {
            await removeWorktree(project.path, wt.path);
          }
        } catch {
          // Try to remove directory directly if git worktree remove fails
          if (existsSync(wt.path)) {
            rmSync(wt.path, { recursive: true, force: true });
          }
        }
      }
      await deleteWorktreesByProject(project.id);
    }

    // Remove project from database
    await deleteProject(project.id);

    // Remove local config
    const configPath = resolve(project.path, ".taskctl");
    if (existsSync(configPath)) {
      rmSync(configPath, { recursive: true, force: true });
    }

    spinner.succeed(`Project ${project.name} removed`);
  } catch (error) {
    spinner.fail("Failed to remove project");
    throw error;
  }
}

async function getCurrentProject() {
  const currentPath = resolve(process.cwd());

  // First try to get from local config
  const localConfig = loadProjectConfig(currentPath);
  if (localConfig) {
    return getProjectById(localConfig.projectId);
  }

  // Try to find by path
  return getProjectByPath(currentPath);
}

// Export for use in other commands
export { getCurrentProject };
