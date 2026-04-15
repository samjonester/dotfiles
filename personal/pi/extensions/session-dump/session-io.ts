import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, basename, dirname } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";
import { execSync } from "child_process";

/**
 * Read the current session file and return its raw JSONL content.
 */
export function readSessionJSONL(sessionFile: string): string {
  return readFileSync(sessionFile, "utf-8").trimEnd();
}

/**
 * Write JSONL content to a new session file in Pi's sessions directory.
 * Returns the path to the written file.
 */
export function writeSessionFile(jsonl: string, cwd: string): string {
  const cwdSlug = cwd.replace(/\//g, "-").replace(/^-/, "");
  const agentDir =
    process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  const sessionsDir = join(agentDir, "sessions", `--${cwdSlug}--`);

  mkdirSync(sessionsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const uuid = randomUUID();
  const fileName = `${timestamp}_${uuid}.jsonl`;
  const filePath = join(sessionsDir, fileName);

  writeFileSync(filePath, jsonl + "\n", "utf-8");

  return filePath;
}

/**
 * Extract a preview (first user message) from JSONL entries.
 */
export function extractPreview(jsonl: string): string {
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === "message" && entry.message?.role === "user") {
        const content = entry.message.content;
        if (typeof content === "string") return content.slice(0, 120);
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text") return block.text.slice(0, 120);
          }
        }
      }
    } catch {
      continue;
    }
  }
  return "";
}

/**
 * Get the current user's email from git config.
 */
export function getUserEmail(): string {
  try {
    return execSync("git config user.email", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * Extract the project name from a cwd path.
 */
export function getProjectName(cwd: string): string {
  return basename(cwd) || "unknown";
}

/**
 * Get the current git branch name, or empty string if not in a repo.
 */
export function getGitBranch(): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

/**
 * Get the git remote URL as an HTTPS GitHub link, or empty string.
 * e.g. "https://github.com/Shopify/some-repo"
 */
export function getGitRepo(): string {
  try {
    const raw = execSync("git remote get-url origin", { encoding: "utf-8" }).trim();
    // Convert SSH to HTTPS: git@github.com:Org/repo.git → https://github.com/Org/repo
    const sshMatch = raw.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
    if (sshMatch) return `https://${sshMatch[1]}/${sshMatch[2]}`;
    // Strip trailing .git from HTTPS URLs
    return raw.replace(/\.git$/, "");
  } catch {
    return "";
  }
}

/**
 * Get a full link to the current branch on GitHub, or empty string.
 * e.g. "https://github.com/Shopify/some-repo/tree/my-branch"
 */
export function getGitBranchUrl(): string {
  const repo = getGitRepo();
  const branch = getGitBranch();
  if (!repo || !branch) return "";
  return `${repo}/tree/${branch}`;
}

/**
 * Detect the world monorepo project and slice from the cwd.
 * Walks up from the cwd looking for slices.yml — the universal
 * project boundary marker in world. The project path relative to
 * the repo root is the project name (e.g. "areas/core/shopify",
 * "libraries/javascript/jest-analytics", "system/windex").
 *
 * Returns { area, slice } — both empty strings if not in world.
 */
export function getWorldAreaAndSlice(cwd: string): { area: string; slice: string } {
  try {
    const repoRoot = execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
      cwd,
    }).trim();

    const rel = cwd.startsWith(repoRoot) ? cwd.slice(repoRoot.length + 1) : "";
    if (!rel) return { area: "", slice: "" };

    // Walk up from cwd looking for slices.yml
    let searchDir = cwd;
    let slicesPath = "";
    while (searchDir.length > repoRoot.length) {
      const candidate = join(searchDir, "slices.yml");
      try {
        readFileSync(candidate, "utf-8");
        slicesPath = candidate;
        break;
      } catch {
        searchDir = dirname(searchDir);
      }
    }

    if (!slicesPath) return { area: "", slice: "" };

    // Project root is the dir containing slices.yml
    const projectRoot = slicesPath.replace(/\/slices\.yml$/, "");
    const area = projectRoot.slice(repoRoot.length + 1);

    // Find matching slice
    let slice = "";
    try {
      const slicesRaw = readFileSync(slicesPath, "utf-8");
      slice = matchSlice(slicesRaw, rel);
    } catch {
      // Already read it above, shouldn't fail, but be safe
    }

    return { area, slice };
  } catch {
    return { area: "", slice: "" };
  }
}

/**
 * Find the best matching slice for a relative path.
 * Picks the slice whose paths have the longest prefix match.
 * Falls back to the default slice if no path matches.
 */
export function matchSlice(slicesYml: string, relPath: string): string {
  // Simple YAML parsing — slices.yml is structured enough for this
  const slices: { name: string; paths: string[]; isDefault: boolean }[] = [];
  let current: { name: string; paths: string[]; isDefault: boolean } | null = null;
  let inPaths = false;

  for (const line of slicesYml.split("\n")) {
    const nameMatch = line.match(/^- name:\s*(.+)/);
    if (nameMatch) {
      if (current) slices.push(current);
      current = { name: nameMatch[1].trim(), paths: [], isDefault: false };
      inPaths = false;
      continue;
    }
    if (current && /^\s+default:\s*true/.test(line)) {
      current.isDefault = true;
      continue;
    }
    if (current && /^\s+paths:/.test(line)) {
      inPaths = true;
      continue;
    }
    if (inPaths && current) {
      const pathMatch = line.match(/^\s+-\s+(.+)/);
      if (pathMatch) {
        current.paths.push(pathMatch[1].trim());
      } else if (!/^\s*$/.test(line) && !/^\s+-/.test(line)) {
        inPaths = false;
      }
    }
  }
  if (current) slices.push(current);

  // Find best match by longest prefix
  let bestSlice = "";
  let bestLen = 0;

  for (const s of slices) {
    for (const p of s.paths) {
      const clean = p.replace(/\*.*$/, "").replace(/\/$/, "");
      if (relPath.startsWith(clean) && clean.length > bestLen) {
        bestLen = clean.length;
        bestSlice = s.name;
      }
    }
  }

  if (bestSlice) return bestSlice;

  // Fall back to default slice
  const defaultSlice = slices.find((s) => s.isDefault);
  return defaultSlice?.name || "";
}

/**
 * Count user + assistant messages in the JSONL.
 */
export function countMessages(jsonl: string): number {
  let count = 0;
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (
        entry.type === "message" &&
        (entry.message?.role === "user" || entry.message?.role === "assistant")
      ) {
        count++;
      }
    } catch {
      continue;
    }
  }
  return count;
}

export interface SessionStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  totalCost: number;
  models: string[];
}

/**
 * Aggregate token usage and cost from all assistant messages in the JSONL.
 */
export function getSessionStats(jsonl: string): SessionStats {
  const stats: SessionStats = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    models: [],
  };

  const seenModels = new Set<string>();

  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type !== "message" || entry.message?.role !== "assistant") continue;

      const msg = entry.message;
      const usage = msg.usage;
      if (usage) {
        stats.inputTokens += usage.input || 0;
        stats.outputTokens += usage.output || 0;
        stats.cacheReadTokens += usage.cacheRead || 0;
        stats.cacheWriteTokens += usage.cacheWrite || 0;
        stats.totalTokens += usage.totalTokens || 0;
        stats.totalCost += usage.cost?.total || 0;
      }

      if (msg.model) {
        const key = msg.provider ? `${msg.provider}/${msg.model}` : msg.model;
        if (!seenModels.has(key)) {
          seenModels.add(key);
          stats.models.push(key);
        }
      }
    } catch {
      continue;
    }
  }

  // Round cost to 4 decimal places to avoid float noise
  stats.totalCost = Math.round(stats.totalCost * 10000) / 10000;

  return stats;
}
