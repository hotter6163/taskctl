import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface PrInfo {
  number: number;
  title: string;
  url: string;
  state: string;
  headBranch: string;
  baseBranch: string;
  isDraft: boolean;
  reviewDecision: string | null;
}

export interface PrCreateOptions {
  title: string;
  body: string;
  baseBranch: string;
  headBranch: string;
  draft?: boolean;
}

/**
 * Execute a gh CLI command
 */
export async function ghExec(args: string[], cwd?: string): Promise<string> {
  const command = `gh ${args.join(" ")}`;
  try {
    const { stdout } = await execAsync(command, {
      cwd: cwd || process.cwd(),
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    return stdout.trim();
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string; message: string };
    throw new Error(
      `GitHub CLI command failed: ${command}\n${execError.stderr || execError.message}`
    );
  }
}

/**
 * Check if gh CLI is installed and authenticated
 */
export async function isGhAvailable(): Promise<boolean> {
  try {
    await ghExec(["auth", "status"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a pull request
 */
export async function createPr(
  repoPath: string,
  options: PrCreateOptions
): Promise<PrInfo> {
  const args = [
    "pr",
    "create",
    "--title",
    options.title,
    "--body",
    options.body,
    "--base",
    options.baseBranch,
    "--head",
    options.headBranch,
  ];

  if (options.draft) {
    args.push("--draft");
  }

  args.push("--json", "number,title,url,state,headRefName,baseRefName,isDraft,reviewDecision");

  const output = await ghExec(args, repoPath);
  const pr = JSON.parse(output);

  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state: pr.state,
    headBranch: pr.headRefName,
    baseBranch: pr.baseRefName,
    isDraft: pr.isDraft,
    reviewDecision: pr.reviewDecision,
  };
}

/**
 * Get pull request info
 */
export async function getPr(repoPath: string, prNumber: number): Promise<PrInfo> {
  const args = [
    "pr",
    "view",
    prNumber.toString(),
    "--json",
    "number,title,url,state,headRefName,baseRefName,isDraft,reviewDecision",
  ];

  const output = await ghExec(args, repoPath);
  const pr = JSON.parse(output);

  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state: pr.state,
    headBranch: pr.headRefName,
    baseBranch: pr.baseRefName,
    isDraft: pr.isDraft,
    reviewDecision: pr.reviewDecision,
  };
}

/**
 * List pull requests
 */
export async function listPrs(
  repoPath: string,
  state: "open" | "closed" | "merged" | "all" = "open"
): Promise<PrInfo[]> {
  const args = [
    "pr",
    "list",
    "--state",
    state,
    "--json",
    "number,title,url,state,headRefName,baseRefName,isDraft,reviewDecision",
  ];

  const output = await ghExec(args, repoPath);
  const prs = JSON.parse(output);

  return prs.map((pr: Record<string, unknown>) => ({
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state: pr.state,
    headBranch: pr.headRefName,
    baseBranch: pr.baseRefName,
    isDraft: pr.isDraft,
    reviewDecision: pr.reviewDecision,
  }));
}

/**
 * Merge a pull request
 */
export async function mergePr(
  repoPath: string,
  prNumber: number,
  options?: { squash?: boolean; rebase?: boolean; deleteAfterMerge?: boolean }
): Promise<void> {
  const args = ["pr", "merge", prNumber.toString()];

  if (options?.squash) {
    args.push("--squash");
  } else if (options?.rebase) {
    args.push("--rebase");
  } else {
    args.push("--merge");
  }

  if (options?.deleteAfterMerge !== false) {
    args.push("--delete-branch");
  }

  await ghExec(args, repoPath);
}

/**
 * Close a pull request without merging
 */
export async function closePr(repoPath: string, prNumber: number): Promise<void> {
  await ghExec(["pr", "close", prNumber.toString()], repoPath);
}

/**
 * Mark a pull request as ready for review
 */
export async function markPrReady(repoPath: string, prNumber: number): Promise<void> {
  await ghExec(["pr", "ready", prNumber.toString()], repoPath);
}

/**
 * Convert PR status to our internal status
 */
export function convertPrStatus(ghPr: PrInfo): string {
  if (ghPr.state === "MERGED") return "merged";
  if (ghPr.state === "CLOSED") return "closed";
  if (ghPr.isDraft) return "draft";
  if (ghPr.reviewDecision === "APPROVED") return "approved";
  if (ghPr.reviewDecision === "CHANGES_REQUESTED") return "in_review";
  if (ghPr.state === "OPEN") return "open";
  return "draft";
}
