import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  getGlobalConfigPath,
  getProjectConfigPath,
  getProjectConfigDir,
  ensureDir,
  ensureAppDataDir,
} from "./paths.js";

export interface GlobalConfig {
  defaultWorktreeCount: number;
  defaultMainBranch: string;
  logLevel: "debug" | "info" | "warn" | "error";
}

export interface ProjectConfig {
  projectId: string;
  name: string;
  worktreeCount: number;
  mainBranch: string;
}

const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  defaultWorktreeCount: 10,
  defaultMainBranch: "main",
  logLevel: "info",
};

/**
 * Load global configuration
 */
export function loadGlobalConfig(): GlobalConfig {
  ensureAppDataDir();
  const configPath = getGlobalConfigPath();

  if (!existsSync(configPath)) {
    saveGlobalConfig(DEFAULT_GLOBAL_CONFIG);
    return DEFAULT_GLOBAL_CONFIG;
  }

  try {
    const content = readFileSync(configPath, "utf-8");
    return { ...DEFAULT_GLOBAL_CONFIG, ...JSON.parse(content) };
  } catch {
    return DEFAULT_GLOBAL_CONFIG;
  }
}

/**
 * Save global configuration
 */
export function saveGlobalConfig(config: GlobalConfig): void {
  ensureAppDataDir();
  const configPath = getGlobalConfigPath();
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Load project-local configuration
 */
export function loadProjectConfig(projectPath: string): ProjectConfig | null {
  const configPath = getProjectConfigPath(projectPath);

  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const content = readFileSync(configPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Save project-local configuration
 */
export function saveProjectConfig(projectPath: string, config: ProjectConfig): void {
  const configDir = getProjectConfigDir(projectPath);
  ensureDir(configDir);
  const configPath = getProjectConfigPath(projectPath);
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Check if a directory is a taskctl-managed project
 */
export function isTaskctlProject(projectPath: string): boolean {
  return existsSync(getProjectConfigPath(projectPath));
}

/**
 * Get log level from environment or config
 */
export function getLogLevel(): string {
  return process.env.TASKCTL_LOG_LEVEL || loadGlobalConfig().logLevel;
}
