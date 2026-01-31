import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const execAsync = promisify(exec);

export interface GitExecResult {
  stdout: string;
  stderr: string;
}

/**
 * Execute a git command
 */
export async function gitExec(args: string[], cwd?: string): Promise<GitExecResult> {
  const command = `git ${args.join(" ")}`;
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: cwd || process.cwd(),
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string; message: string };
    throw new Error(
      `Git command failed: ${command}\n${execError.stderr || execError.message}`
    );
  }
}

/**
 * Check if a directory is a git repository
 */
export async function isGitRepo(path: string): Promise<boolean> {
  try {
    await gitExec(["rev-parse", "--git-dir"], path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the root directory of a git repository
 */
export async function getRepoRoot(path: string): Promise<string> {
  const { stdout } = await gitExec(["rev-parse", "--show-toplevel"], path);
  return stdout;
}

/**
 * Get the current branch name
 */
export async function getCurrentBranch(path: string): Promise<string> {
  const { stdout } = await gitExec(["rev-parse", "--abbrev-ref", "HEAD"], path);
  return stdout;
}

/**
 * Get the remote URL (origin)
 */
export async function getRemoteUrl(path: string): Promise<string | null> {
  try {
    const { stdout } = await gitExec(["remote", "get-url", "origin"], path);
    return stdout || null;
  } catch {
    return null;
  }
}

/**
 * Clone a repository
 */
export async function cloneRepo(url: string, targetPath: string): Promise<void> {
  await gitExec(["clone", url, targetPath]);
}

/**
 * Create a new branch
 */
export async function createBranch(
  path: string,
  branchName: string,
  baseBranch?: string
): Promise<void> {
  if (baseBranch) {
    await gitExec(["checkout", "-b", branchName, baseBranch], path);
  } else {
    await gitExec(["checkout", "-b", branchName], path);
  }
}

/**
 * Checkout a branch
 */
export async function checkoutBranch(path: string, branchName: string): Promise<void> {
  await gitExec(["checkout", branchName], path);
}

/**
 * Check if a branch exists
 */
export async function branchExists(path: string, branchName: string): Promise<boolean> {
  try {
    await gitExec(["rev-parse", "--verify", branchName], path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get list of all branches
 */
export async function listBranches(path: string): Promise<string[]> {
  const { stdout } = await gitExec(["branch", "--list", "--format=%(refname:short)"], path);
  return stdout.split("\n").filter(Boolean);
}

// Worktree operations

/**
 * Add a new worktree
 */
export async function addWorktree(
  repoPath: string,
  worktreePath: string,
  branchName?: string
): Promise<void> {
  const args = ["worktree", "add"];
  if (branchName) {
    args.push("-b", branchName, worktreePath);
  } else {
    args.push("--detach", worktreePath);
  }
  await gitExec(args, repoPath);
}

/**
 * Remove a worktree
 */
export async function removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
  await gitExec(["worktree", "remove", "--force", worktreePath], repoPath);
}

/**
 * List all worktrees
 */
export async function listWorktrees(repoPath: string): Promise<{ path: string; branch: string }[]> {
  const { stdout } = await gitExec(["worktree", "list", "--porcelain"], repoPath);
  const worktrees: { path: string; branch: string }[] = [];
  let current: { path?: string; branch?: string } = {};

  for (const line of stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      current.path = line.substring(9);
    } else if (line.startsWith("branch ")) {
      current.branch = line.substring(7).replace("refs/heads/", "");
    } else if (line === "") {
      if (current.path) {
        worktrees.push({
          path: current.path,
          branch: current.branch || "detached",
        });
      }
      current = {};
    }
  }

  // Handle last entry
  if (current.path) {
    worktrees.push({
      path: current.path,
      branch: current.branch || "detached",
    });
  }

  return worktrees;
}

/**
 * Prune worktree references
 */
export async function pruneWorktrees(repoPath: string): Promise<void> {
  await gitExec(["worktree", "prune"], repoPath);
}

/**
 * Check if a path is a worktree
 */
export function isWorktreePath(path: string): boolean {
  const gitPath = join(path, ".git");
  if (!existsSync(gitPath)) return false;

  // Worktrees have a .git file (not directory) that points to the main repo
  try {
    const fs = require("node:fs");
    const stat = fs.statSync(gitPath);
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Get the main repository path from a worktree
 */
export async function getMainRepoFromWorktree(worktreePath: string): Promise<string> {
  const { stdout } = await gitExec(
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    worktreePath
  );
  // The common dir is the .git directory, we need the parent
  return resolve(stdout, "..");
}

/**
 * Fetch from remote
 */
export async function fetch(path: string, remote = "origin"): Promise<void> {
  await gitExec(["fetch", remote], path);
}

/**
 * Pull from remote
 */
export async function pull(path: string, remote = "origin", branch?: string): Promise<void> {
  const args = ["pull", remote];
  if (branch) args.push(branch);
  await gitExec(args, path);
}

/**
 * Push to remote
 */
export async function push(
  path: string,
  remote = "origin",
  branch?: string,
  setUpstream = false
): Promise<void> {
  const args = ["push"];
  if (setUpstream) args.push("-u");
  args.push(remote);
  if (branch) args.push(branch);
  await gitExec(args, path);
}

/**
 * Get the main repository path, resolving worktrees to their parent repo
 */
export async function getMainRepoPath(path: string): Promise<string> {
  const { stdout } = await gitExec(
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    path
  );
  // git-common-dir returns the .git directory; for a normal repo it's "<repo>/.git",
  // for a worktree it's "<main-repo>/.git". Either way, parent is the main repo root.
  return resolve(stdout, "..");
}

/**
 * Get repository name from path or URL
 */
export function getRepoName(pathOrUrl: string): string {
  // Handle URLs
  if (pathOrUrl.includes("://") || pathOrUrl.includes("@")) {
    const name = pathOrUrl.split("/").pop() || pathOrUrl;
    return name.replace(/\.git$/, "");
  }
  // Handle paths
  return resolve(pathOrUrl).split("/").pop() || "repo";
}
