import { Command } from "commander";
import { resolve } from "node:path";
import chalk from "chalk";
import {
  getAllProjects,
  getProjectByPath,
  getProjectByRemoteUrl,
  updateProject,
  deleteProject,
} from "../db/repositories/project.js";
import { getMainRepoPath, getRemoteUrl, isGitRepo } from "../integrations/git.js";
import { shortId } from "../utils/id.js";
import { existsSync } from "node:fs";
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
    .option("-b, --main-branch <branch>", "Update main branch")
    .action(async (options: { mainBranch?: string }) => {
      await configureProject(options);
    });

  projectCmd
    .command("remove [project-id]")
    .description("Remove a project from taskctl")
    .option("-f, --force", "Force removal")
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
      console.error(chalk.gray("Run 'taskctl init' to initialize this repository"));
      process.exit(1);
    }
  }

  console.log("");
  console.log(chalk.bold(`Project: ${project.name}`));
  console.log("");
  console.log(`  ${chalk.bold("ID:")}            ${project.id}`);
  console.log(`  ${chalk.bold("Path:")}          ${project.path}`);
  console.log(`  ${chalk.bold("Main branch:")}   ${project.mainBranch}`);
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
  mainBranch?: string;
}): Promise<void> {
  const project = await getCurrentProject();
  if (!project) {
    console.error(chalk.red("No project found in current directory"));
    process.exit(1);
  }

  const updates: { mainBranch?: string } = {};

  if (options.mainBranch !== undefined) {
    updates.mainBranch = options.mainBranch;
  }

  if (Object.keys(updates).length === 0) {
    console.error(chalk.yellow("No configuration options provided"));
    return;
  }

  await updateProject(project.id, updates);
  console.log(chalk.green("Project configuration updated"));
}

async function removeProject(
  projectId: string | undefined,
  _options: { force?: boolean }
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

  const spinner = ora("Removing project...").start();

  try {
    await deleteProject(project.id);
    spinner.succeed(`Project ${project.name} removed`);
  } catch (error) {
    spinner.fail("Failed to remove project");
    throw error;
  }
}

async function getCurrentProject() {
  const currentPath = resolve(process.cwd());

  // Check if we're in a git repo
  const isRepo = await isGitRepo(currentPath);
  if (!isRepo) return null;

  // Resolve to main repo path (handles worktrees)
  const mainPath = await getMainRepoPath(currentPath);

  // Try by path first
  const byPath = await getProjectByPath(mainPath);
  if (byPath) return byPath;

  // Try by remote URL (handles worktrees registered from a different path)
  const remoteUrl = await getRemoteUrl(mainPath);
  if (remoteUrl) {
    return getProjectByRemoteUrl(remoteUrl);
  }

  return null;
}

// Export for use in other commands
export { getCurrentProject };
