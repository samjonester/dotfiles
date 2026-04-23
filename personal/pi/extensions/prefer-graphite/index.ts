/**
 * Prefer Graphite Extension
 *
 * Intercepts git commands in Graphite-managed repos and redirects the agent
 * to use gt equivalents instead. Auto-detects Graphite repos by walking up
 * from the cwd looking for a .graphite directory.
 *
 * Uses exit-code-2 style feedback: blocks the call and tells the agent
 * exactly which gt command to use, so it self-corrects without user intervention.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Git commands that have gt equivalents.
 * Messages are kept short — the graphite skill has full docs.
 */
const GIT_TO_GT: Array<{ pattern: RegExp; hint: string }> = [
  { pattern: /\bgit\s+checkout\s+-b\b/, hint: "gt create" },
  { pattern: /\bgit\s+checkout\b/, hint: "gt co, gt get, gt up, gt down" },
  { pattern: /\bgit\s+switch\s+(--create|-c)\b/, hint: "gt create" },
  { pattern: /\bgit\s+switch\b/, hint: "gt co, gt get" },
  { pattern: /\bgit\s+push\b/, hint: "gt submit, gt ss" },
  { pattern: /\bgit\s+pull\b/, hint: "gt get" },

  {
    pattern: /\bgit\s+rebase\b/,
    hint: "gt restack (see also ~/.claude/agents/gt-restack-resolver.md for conflict resolution)",
  },
  { pattern: /\bgit\s+merge\b/, hint: "gt fold" },
  { pattern: /\bgit\s+branch\s+(-d|-D|--delete)\b/, hint: "gt delete, gt delete --force" },
  { pattern: /\bgit\s+branch\b/, hint: "gt log, gt ls, gt create" },
  { pattern: /\bgit\s+commit\s+--amend\b/, hint: "gt modify" },
  { pattern: /\bgit\s+commit\b/, hint: "gt create, gt modify" },
];

/** Commands that are fine to use with plain git in any repo. */
const GIT_PASSTHROUGH = [
  /\bgit\s+status\b/,
  /\bgit\s+diff\b/,
  /\bgit\s+log\b/,
  /\bgit\s+show\b/,
  /\bgit\s+blame\b/,
  /\bgit\s+grep\b/,
  /\bgit\s+rev-parse\b/,
  /\bgit\s+describe\b/,
  /\bgit\s+ls-files\b/,
  /\bgit\s+ls-tree\b/,
  /\bgit\s+cat-file\b/,
  /\bgit\s+for-each-ref\b/,
  /\bgit\s+stash\b/,
  /\bgit\s+fetch\b/,
  /\bgit\s+add\b/,
  /\bgit\s+worktree\b/,
];

/**
 * Strip single-quoted and double-quoted string content before pattern-matching.
 * Prevents false positives from `git` appearing inside arguments
 * (e.g. `sed '/^diff --git/'`, `grep 'git commit'`).
 * Preserves the quotes themselves so word boundaries still work correctly.
 */
function stripQuotedContent(s: string): string {
  // Replace single-quoted content: 'anything' → ''
  let result = s.replace(/'[^']*'/g, "''");
  // Replace double-quoted content (handling escapes): "anything" → ""
  result = result.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  return result;
}

/** Cache: resolved dir → boolean (avoids repeated fs/git lookups on every tool call). */
const graphiteRepoCache = new Map<string, boolean>();

/**
 * Detect whether `dir` is inside a Graphite-managed repo.
 *
 * Strategy:
 * 1. Walk up looking for a `.graphite` directory (standard `gt init` layout).
 * 2. If not found, ask git for the common dir and check for `.graphite_repo_config`
 *    (worktree layout used by e.g. ~/world where the real git dir is shared).
 */
function isGraphiteRepo(dir: string): boolean {
  const resolved = path.resolve(dir);
  const cached = graphiteRepoCache.get(resolved);
  if (cached !== undefined) return cached;

  // Strategy 1: walk up looking for .graphite directory
  let current = resolved;
  while (true) {
    if (fs.existsSync(path.join(current, ".graphite"))) {
      graphiteRepoCache.set(resolved, true);
      return true;
    }
    const parent = path.dirname(current);
    if (parent === current) break; // filesystem root
    current = parent;
  }

  // Strategy 2: check git common dir for graphite config files (worktrees)
  try {
    const gitCommonDir = execFileSync(
      "git",
      ["rev-parse", "--git-common-dir"],
      { cwd: resolved, encoding: "utf-8", timeout: 3000 },
    ).trim();

    if (fs.existsSync(path.join(gitCommonDir, ".graphite_repo_config"))) {
      graphiteRepoCache.set(resolved, true);
      return true;
    }
  } catch {
    // Not a git repo or git not available — fall through
  }

  graphiteRepoCache.set(resolved, false);
  return false;
}

/**
 * Strip heredoc bodies from a shell command before pattern matching.
 * `git` appearing inside a heredoc is not a git invocation — it's data.
 */
function stripHeredocBodies(command: string): string {
  return command.replace(
    /<<\s*['"]?(\w+)['"]?\n[\s\S]*?\n[ \t]*\1[ \t]*(\n|$)/gm,
    (_match, delimiter) => `<< '${delimiter}'\n`,
  );
}

/**
 * Split a command string into sub-commands on shell operators (&&, ||, ;, |, \n).
 * Quote-aware: operators inside single or double quotes are treated as literals.
 * Not a full shell parser — doesn't recurse into $() or backtick subshells —
 * but sufficient for agent-generated commands.
 */
function splitSubCommands(command: string): string[] {
  const commands: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let i = 0;

  while (i < command.length) {
    const ch = command[i];

    // Handle escapes outside single quotes
    if (ch === "\\" && !inSingle && i + 1 < command.length) {
      current += ch + command[i + 1];
      i += 2;
      continue;
    }

    // Toggle quote state
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      i++;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      i++;
      continue;
    }

    // Outside quotes: detect operators
    if (!inSingle && !inDouble) {
      // && or ||
      if (
        (ch === "&" && command[i + 1] === "&") ||
        (ch === "|" && command[i + 1] === "|")
      ) {
        commands.push(current);
        current = "";
        i += 2;
        continue;
      }
      // ; or | or newline
      if (ch === ";" || ch === "|" || ch === "\n") {
        commands.push(current);
        current = "";
        i++;
        continue;
      }
    }

    current += ch;
    i++;
  }

  commands.push(current);
  return commands.map((s) => s.trim()).filter(Boolean);
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return undefined;

    const command = event.input.command || "";
    const cwd = ctx.cwd;
    if (!cwd) return undefined;

    // Only apply in Graphite-managed repos
    if (!isGraphiteRepo(cwd)) return undefined;

    // Strip heredoc bodies — git inside a heredoc is data, not a command
    const commandSansHeredocs = stripHeredocBodies(command);

    // Early bail: does the command contain a git invocation outside quotes at all?
    if (!/\bgit\s+/.test(stripQuotedContent(commandSansHeredocs))) return undefined;

    // Split into sub-commands (quote-aware) and check each independently.
    // A mutating git command in ANY sub-command blocks the entire call.
    const subCommands = splitSubCommands(commandSansHeredocs);

    for (const sub of subCommands) {
      // Strip quoted content before checking — git inside string arguments
      // (e.g. sed '/^diff --git/', grep 'git commit') is data, not a command
      const subToCheck = stripQuotedContent(sub);

      // Skip sub-commands that don't involve git
      if (!/\bgit\s+/.test(subToCheck)) continue;

      // Allow read-only git commands through to the next sub-command
      if (GIT_PASSTHROUGH.some((p) => p.test(subToCheck))) continue;

      // Check for gt redirects
      for (const { pattern, hint } of GIT_TO_GT) {
        if (pattern.test(subToCheck)) {
          return {
            block: true,
            reason: `This repo uses Graphite — use gt instead of git. Try: ${hint}\n\nLoad the graphite skill for full command reference.`,
          };
        }
      }

      // Catch-all for any other git mutating commands we didn't map
      return {
        block: true,
        reason: `This repo uses Graphite — prefer gt over raw git commands.\n\nLoad the graphite skill for the equivalent gt command.`,
      };
    }

    // All git sub-commands were read-only passthroughs (or no git sub-commands)
    return undefined;
  });
}
