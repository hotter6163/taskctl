import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { getGlobalConfigPath, ensureAppDataDir } from "./paths.js";

export interface GlobalConfig {
  defaultMainBranch: string;
  logLevel: "debug" | "info" | "warn" | "error";
}

const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
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
 * Get log level from environment or config
 */
export function getLogLevel(): string {
  return process.env.TASKCTL_LOG_LEVEL || loadGlobalConfig().logLevel;
}
