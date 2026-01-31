import { Command } from "commander";
import { resolve, basename } from "node:path";
import chalk from "chalk";
import ora from "ora";
import {
  isGitRepo,
  getRepoRoot,
  getRemoteUrl,
  cloneRepo,
  getRepoName,
} from "../integrations/git.js";
import { createProject, getProjectByPath } from "../db/repositories/project.js";
import { loadGlobalConfig } from "../utils/config.js";

interface InitOptions {
  clone?: string;
  mainBranch?: string;
  name?: string;
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize a project under taskctl management")
    .option("-c, --clone <url>", "Clone a repository and initialize")
    .option("-b, --main-branch <branch>", "Main branch name")
    .option("-n, --name <name>", "Project name")
    .action(async (options: InitOptions) => {
      await initProject(options);
    });
}

async function initProject(options: InitOptions): Promise<void> {
  const globalConfig = loadGlobalConfig();
  const mainBranch = options.mainBranch ?? globalConfig.defaultMainBranch;

  let projectPath: string;
  let projectName: string;

  // Handle clone option
  if (options.clone) {
    const spinner = ora("Cloning repository...").start();
    try {
      projectName = options.name ?? getRepoName(options.clone);
      projectPath = resolve(process.cwd(), projectName);
      await cloneRepo(options.clone, projectPath);
      spinner.succeed(`Repository cloned to ${chalk.cyan(projectPath)}`);
    } catch (error) {
      spinner.fail("Failed to clone repository");
      throw error;
    }
  } else {
    // Initialize existing directory
    projectPath = resolve(process.cwd());
    projectName = options.name ?? basename(projectPath);

    // Check if it's a git repository
    const isRepo = await isGitRepo(projectPath);
    if (!isRepo) {
      console.error(chalk.red("Error: Current directory is not a git repository"));
      console.error(chalk.gray("Use 'git init' to initialize a git repository first"));
      console.error(chalk.gray("Or use 'taskctl init --clone <url>' to clone a repository"));
      process.exit(1);
    }

    // Get the repo root (in case we're in a subdirectory)
    projectPath = await getRepoRoot(projectPath);
  }

  // Check if already initialized
  const existingProject = await getProjectByPath(projectPath);
  if (existingProject) {
    console.error(chalk.red("Error: This project is already initialized"));
    console.error(chalk.gray(`Project ID: ${existingProject.id}`));
    process.exit(1);
  }

  // Get remote URL
  const remoteUrl = await getRemoteUrl(projectPath);

  const spinner = ora("Initializing project...").start();

  try {
    // Create project in database
    const project = await createProject({
      name: projectName,
      path: projectPath,
      remoteUrl,
      mainBranch,
    });

    spinner.succeed("Project registered");

    console.log("");
    console.log(chalk.green("Project initialized successfully!"));
    console.log("");
    console.log(`  ${chalk.bold("Project ID:")}    ${project.id}`);
    console.log(`  ${chalk.bold("Name:")}          ${projectName}`);
    console.log(`  ${chalk.bold("Path:")}          ${projectPath}`);
    console.log(`  ${chalk.bold("Main branch:")}   ${mainBranch}`);
    if (remoteUrl) {
      console.log(`  ${chalk.bold("Remote:")}        ${remoteUrl}`);
    }
    console.log("");
    console.log(chalk.gray("Next steps:"));
    console.log(chalk.gray("  1. taskctl plan new \"<title>\"     # Create a new plan"));
    console.log(chalk.gray("  2. taskctl plan ai generate      # Generate tasks with AI"));
    console.log(chalk.gray("  3. taskctl status                 # View project status"));
  } catch (error) {
    spinner.fail("Failed to initialize project");
    throw error;
  }
}
