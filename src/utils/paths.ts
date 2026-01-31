import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

/**
 * Get the application data directory based on platform
 * macOS: ~/Library/Application Support/taskctl
 * Linux: ~/.local/share/taskctl
 * Windows: %APPDATA%/taskctl
 */
export function getAppDataDir(): string {
  const platform = process.platform;
  let appDataDir: string;

  if (platform === "darwin") {
    appDataDir = join(homedir(), "Library", "Application Support", "taskctl");
  } else if (platform === "win32") {
    appDataDir = join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "taskctl");
  } else {
    appDataDir = join(homedir(), ".local", "share", "taskctl");
  }

  return appDataDir;
}

/**
 * Get the database file path
 */
export function getDbPath(): string {
  return process.env.TASKCTL_DB_PATH || join(getAppDataDir(), "taskctl.db");
}

/**
 * Get the global config file path
 */
export function getGlobalConfigPath(): string {
  return join(getAppDataDir(), "config.json");
}

/**
 * Get the logs directory path
 */
export function getLogsDir(): string {
  return join(getAppDataDir(), "logs");
}

/**
 * Ensure a directory exists, create it if it doesn't
 */
export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Ensure the app data directory exists
 */
export function ensureAppDataDir(): void {
  ensureDir(getAppDataDir());
  ensureDir(getLogsDir());
}
