/**
 * Bash Guard — Adversarial Security Review Extension
 *
 * Three-stage interception for bash tool calls:
 *
 * Stage 1 — Remote mutation gate (deterministic, instant):
 *   Pattern-matches commands that modify remote state (git push, gh pr create,
 *   etc.). Always prompts with a lightweight y/n dialog — no LLM
 *   voters, no override memory. Deny shows a text input for redirect instructions.
 *   Runs even when the guard is toggled off (instant, zero cost).
 *   Exception: when Stage 1.5's commit policy is 'auto-allow', safe pushes
 *   (git push) targeting the current non-protected
 *   branch are silently auto-allowed — see canAutoAllowPush.
 *
 * Stage 1.5 — Commit gate (session-scoped policy):
 *   Pattern-matches commit-like commands (git commit, git commit --amend).
 *   On first encounter in a session, shows a policy dialog:
 *     a = auto-allow all commits this session
 *     c = confirm each commit individually (y/n per command)
 *     n = deny (with optional redirect instructions)
 *   Policy persists for the session; resets on new session. Change mid-session
 *   with `/guard commits auto|confirm|reset`. When auto-allow is active, push
 *   commands targeting the current branch are also silently allowed (Stage 1).
 *
 * Stage 2 — Adversarial security review (LLM voters):
 *   Runs 3 parallel security reviews using fast models. Based on vote consensus:
 *     Unanimous YES  → auto-allow (notification, or debug dialog)
 *     Unanimous NO   → markdown dialog with explanation + override
 *     Split / mixed  → markdown dialog with explanation + override
 *   Timeouts and errors count as abstentions (ignored in vote tally).
 *   Toggle with `/guard on|off|debug`. Not exposed as a tool — LLM cannot disable it.
 *
 * Stage 0 — Teammate autonomy gate (only when running as a spawned teammate):
 *   Spawned teammates have a TUI but no human watching — interactive dialogs
 *   would deadlock. When isTeammateSession() is true, we replace Stage 1 / 1.5
 *   for a narrow set of "draft-PR-safe" commands:
 *     • Commit-like commands (git commit, git commit --amend) → auto-allow
 *     • `git push` (no force, non-protected target) → contextual voter pass
 *   Voter pass receives current branch + user message context. Unanimous YES
 *   from at least 2 voters allows; anything else blocks with a reason the model
 *   can read. Hard-block list (publish, ready, merge, edit, force-push, push to
 *   main/master/production) returns block immediately — no voting. Other
 *   remote mutations (gh pr create, gh issue, etc.) also hard-block, since the
 *   teammate cannot confirm interactively. Stages 1/1.5 dialog-blocking paths
 *   also fall through to non-interactive `block: true` for teammates so nothing
 *   deadlocks.
 *
 * Override memory: when the user overrides a NO/split decision with `y`, the
 * command is recorded. Exact repeat commands are auto-allowed with a notification.
 * Past overrides are provided as context to voters so they can learn user
 * preferences. Pressing `o` allows the command once without recording it —
 * the same command will be reviewed again next time.
 */

import {
  complete,
  type Model,
  type TextContent,
  type ThinkingContent,
  type ToolCall,
  type ToolResultMessage,
  type UserMessage,
} from "@mariozechner/pi-ai";
import {
  isToolCallEventType,
  DynamicBorder,
  getMarkdownTheme,
  type ExtensionAPI,
  type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
  Container,
  Input,
  Markdown,
  matchesKey,
  Key,
  Spacer,
  Text,
  type Component,
  type KeybindingsManager,
  type TUI,
} from "@mariozechner/pi-tui";
import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ── Focus / control-sequence filtering ──────────────────────────────────────────
//
// Guard dialogs only care about user keypresses (y/n/a/c/esc). Terminal control
// sequences — focus events, mouse reports, device-status responses — must be
// silently dropped so they don't dismiss the dialog or trigger TUI re-renders.
//
// Previous approach wrote raw DECSET 1004 suppress/restore sequences directly to
// process.stdout. This bypassed the TUI render pipeline and could interleave
// with kitty graphics APC sequences (\x1b_G…\x1b\), corrupting tmux's
// passthrough parser and causing base64 image data to render as visible text.
//
// Current approach: filter control sequences in handleInput only. No writes to
// stdout — the TUI owns the output stream exclusively.

// ── User alert (cmux-aware notification) ──────────────────────────────────────

/**
 * Alert the user that bash-guard needs their attention.
 *
 * Strategy depends on whether we're inside cmux:
 * - Inside cmux (CMUX_SURFACE_ID set): fire `cmux notify` so the alert is
 *   bound to this pane — blue ring, sidebar badge, dock badge, Tink sound
 *   (same channel cmux uses for waiting agent sessions). No osascript banner,
 *   which would otherwise post a rogue system-wide notification untethered
 *   from the pane.
 * - Outside cmux: fall back to osascript display notification so kitty /
 *   iTerm / raw ssh still get a macOS-native popup.
 *
 * BEL is always emitted — it triggers tmux's monitor-bell window flag for
 * users still on tmux, and cmux/other terminals ignore it harmlessly. BEL
 * was previously avoided because kitty's window_alert_on_bell triggered tmux
 * focus events (\x1b[I) that PTY read splitting delivered as bare \x1b, which
 * matchesKey() interpreted as ESC — auto-dismissing the dialog in a loop.
 * This is now safe: isTerminalControlSequence() filters bare ESC and all CSI
 * sequences in every dialog handleInput handler.
 */
function alertUser(label: string) {
  // BEL: triggers tmux monitor-bell (shows ! flag on the window in the status bar)
  process.stderr.write("\x07");

  // Inside cmux: structured notification bound to this pane. Replaces (does
  // not augment) the osascript banner so we don't double-notify.
  const surfaceId = process.env.CMUX_SURFACE_ID;
  if (surfaceId) {
    const args = [
      "notify",
      "--surface",
      surfaceId,
      "--title",
      "🔒 Bash Guard",
      "--body",
      label,
    ];
    const workspaceId = process.env.CMUX_WORKSPACE_ID;
    if (workspaceId) {
      args.splice(1, 0, "--workspace", workspaceId);
    }
    execFile("cmux", args, () => {});
    return;
  }

  // Outside cmux: macOS-native notification.
  execFile(
    "osascript",
    ["-e", `display notification "${label}" with title "🔒 Bash Guard"`],
    () => {},
  );
}

// ── Herdr blocked-state reporting ────────────────────────────────────────────
//
// Herdr's pi integration (~/.pi/agent/extensions/herdr-agent-state.ts) derives
// working/idle from agent_start/agent_settled, so a guard dialog waiting on a
// keypress reports "working" — indistinguishable from a running turn. It also
// counts a `herdr:blocked` event on pi's inter-extension bus, so paired
// active/inactive emits around a dialog are what flip the sidebar to blocked.
// The counter tolerates nesting; unpaired `active: true` pins the pane blocked
// for the rest of the session, so the clear must run in a finally.
let piRef: ExtensionAPI | undefined;

type DialogComponent = Component & { dispose?(): void };

async function blockingCustom<T>(
  ctx: ExtensionContext,
  label: string,
  factory: (
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (result: T) => void,
  ) => DialogComponent | Promise<DialogComponent>,
): Promise<T> {
  piRef?.events.emit("herdr:blocked", { active: true, label });
  try {
    return await ctx.ui.custom<T>(factory);
  } finally {
    piRef?.events.emit("herdr:blocked", { active: false });
  }
}

/**
 * Check if input data is a terminal control sequence (not a user keypress).
 * Filters out focus events, mouse reports, device status responses, etc.
 * These should never be interpreted as user input by guard dialogs.
 */
function isTerminalControlSequence(data: string): boolean {
  // Bare ESC from PTY read splitting (incomplete sequence, not a user keypress)
  if (data === "\x1b") return true;
  // CSI sequences: ESC [ ... (focus events, mouse, device status)
  if (data.startsWith("\x1b[") && data.length > 2) return true;
  // SS3 sequences: ESC O ... (some function keys, but also SS3 prefix)
  if (data.startsWith("\x1bO") && data.length > 2) return true;
  // OSC sequences: ESC ] ...
  if (data.startsWith("\x1b]")) return true;
  // DCS sequences: ESC P ...
  if (data.startsWith("\x1bP")) return true;
  // APC sequences: ESC _ ...
  if (data.startsWith("\x1b_")) return true;
  return false;
}

// ── Teammate session detection (Stage 0) ───────────────────────────────────────
//
// Pi's agent-teams extension sets PI_TEAM_ROLE="teammate" for spawned
// teammates. Any session you start manually has PI_TEAM_ROLE unset or "lead".
// Cached after first call — the role of a process doesn't change mid-session.
//
// Previous approach scanned ~/.pi/teams/*/config.json for TMUX_PANE matches,
// but stale configs from dead teams poisoned the lookup after tmux server
// restarts (pane IDs reset to %0 and walk back into teammate entries from
// old sessions). The env var is set at spawn time and immune to this.

let _teammateCache: boolean | null = null;

function isTeammateSession(): boolean {
  if (_teammateCache !== null) return _teammateCache;
  return (_teammateCache = process.env.PI_TEAM_ROLE === "teammate");
}

// ── Teammate gate patterns (Stage 0) ─────────────────────────────────────────

interface TeammateBlockedPattern {
  pattern: RegExp;
  label: string;
  reason: string;
}

/**
 * Commands that are NEVER allowed for unattended teammates. The lead must
 * perform these. Order matters: more specific patterns (e.g. --publish)
 * come before general matches.
 */
const TEAMMATE_BLOCKED_PATTERNS: TeammateBlockedPattern[] = [
  // Publishing draft → ready
  {
    pattern: /\bgh\s+pr\s+ready\b/,
    label: "gh pr ready",
    reason: "publishes draft → ready; lead must approve.",
  },
  // PR mutations beyond submit.
  //
  // Binks reply workflow: posting review comments, reacting, and resolving
  // threads are non-destructive annotate operations — safe for teammates.
  // The following are intentionally NOT in this regex (they are allowed):
  //   - `gh pr comment`              (top-level PR comment)
  //   - `gh pr review --comment`     (review submitted as COMMENT event)
  // Blocked review verdicts (--approve / --request-changes) are matched by
  // the next pattern.
  {
    pattern: /\bgh\s+pr\s+(merge|edit|create|close|reopen|convert-to-draft)\b/,
    label: "gh pr (mutating)",
    reason: "PR mutation requires lead.",
  },
  // gh pr review verdicts (approve / request-changes) require lead. The
  // COMMENT event variant (`gh pr review --comment`) is allowed.
  {
    pattern: /\bgh\s+pr\s+review\b[^|;&]*--(approve|request-changes)\b/,
    label: "gh pr review (verdict)",
    reason: "review approve/request-changes requires lead.",
  },
  // gs (gitstream / Meteorite) — mirrors the gh patterns above. Same
  // Binks-reply carve-out: `gs pr comment`, `gs pr review --comment`,
  // `gs pr react`, and `gs pr resolve`/`unresolve` are intentionally NOT
  // matched, so teammates can reply, react, and resolve threads.
  {
    pattern: /\bgs\s+pr\s+ready\b/,
    label: "gs pr ready",
    reason: "publishes draft → ready; lead must approve.",
  },
  {
    pattern: /\bgs\s+pr\s+(merge|edit|create|close|reopen)\b/,
    label: "gs pr (mutating)",
    reason: "PR mutation requires lead.",
  },
  {
    pattern: /\bgs\s+pr\s+review\b[^|;&]*--(approve|request-changes)\b/,
    label: "gs pr review (verdict)",
    reason: "review approve/request-changes requires lead.",
  },
  // `gs submit` pushes AND creates/retargets PRs in one step, so it lands
  // on the blocked side of the same line `gh pr create` does. `gs push` can
  // silently escalate to --force-with-lease when the branch has diverged,
  // which is the case `git push --force` is blocked for. Teammates use
  // plain `git push` (votable) instead.
  {
    pattern: /\bgs\s+(submit|push)\b/,
    label: "gs submit/push",
    reason: "creates or force-updates a PR; lead must approve.",
  },
  {
    pattern:
      /\bgs\s+api\b(?![^\n]*(?:pulls\/[^\s\/]+\/comments|\/reactions(?:\b|\/)|\/threads\/[^\s\/]+\/resolve|resolveReviewThread))[^\n]*(--method|-X)\s+(POST|PATCH|PUT|DELETE)\b/i,
    label: "gs api (mutating)",
    reason: "API mutation requires lead.",
  },
  // Issue / release / repo / api mutations
  {
    pattern: /\bgh\s+issue\s+(create|close|reopen|edit|comment|delete)\b/,
    label: "gh issue (mutating)",
    reason: "issue mutation requires lead.",
  },
  {
    pattern: /\bgh\s+release\s+(create|delete|edit|upload)\b/,
    label: "gh release (mutating)",
    reason: "release mutation requires lead.",
  },
  {
    pattern: /\bgh\s+repo\s+(create|fork|delete|rename|transfer)\b/,
    label: "gh repo (mutating)",
    reason: "repo mutation requires lead.",
  },
  // gh api mutations are blocked by default, with a Binks-reply allowlist:
  //   - repos/*/pulls/*/comments     (PR review comments + threaded replies)
  //   - */reactions                  (reactions on issues / PR comments)
  //   - */threads/*/resolve          (resolving review threads)
  //   - GraphQL `resolveReviewThread` mutation
  // These are non-destructive annotate operations safe for teammates. All
  // other mutating endpoints (releases, issues, dispatches, repos, etc.)
  // remain blocked.
  {
    pattern:
      /\bgh\s+api\b(?![^\n]*(?:pulls\/[^\s\/]+\/comments|\/reactions(?:\b|\/)|\/threads\/[^\s\/]+\/resolve|resolveReviewThread))[^\n]*(--method|-X)\s+(POST|PATCH|PUT|DELETE)\b/i,
    label: "gh api (mutating)",
    reason: "API mutation requires lead.",
  },
  // Deploy
  {
    pattern: /\bquick\s+deploy\b/,
    label: "quick deploy",
    reason: "deployment requires lead.",
  },
  // Force pushes
  {
    pattern: /\bgit\s+push\b[^|;&]*(--force(?:-with-lease)?|\s-f\b|\s\+)/,
    label: "git push --force",
    reason: "force push requires lead.",
  },
  // Push to protected branches (positional refspec or src:dst)
  {
    pattern:
      /\bgit\s+push\s+\S+\s+(?:[^\s:]+:)?(?:main|master|production|staging|prod|release(?:\/[^\s]+)?)\b/,
    label: "git push to protected branch",
    reason: "push to protected branch requires lead.",
  },
];

/**
 * Commands that may be allowed for teammates after a contextual voter pass
 * (must verify branch is appropriate). Checked AFTER blocked patterns.
 */
const TEAMMATE_VOTABLE_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bgit\s+push\b/, label: "git push" },
];

/** Branches we never allow teammates to target, regardless of voter outcome. */
const PROTECTED_BRANCH_RE =
  /^(main|master|production|prod|staging|release(?:\/.+)?|hotfix(?:\/.+)?)$/i;

/**
 * Run a small process and capture stdout. Times out after 2s. Returns null
 * on any failure — callers treat null as "unknown".
 */
function runProcess(
  cmd: string,
  args: string[],
  cwd?: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    let resolved = false;
    const child = execFile(cmd, args, { cwd, timeout: 2000 }, (err, stdout) => {
      if (resolved) return;
      resolved = true;
      if (err) return resolve(null);
      resolve(stdout.toString().trim());
    });
    // Belt + braces in case the timeout option doesn't fire on this platform.
    setTimeout(() => {
      if (resolved) return;
      resolved = true;
      try {
        child.kill("SIGKILL");
      } catch {}
      resolve(null);
    }, 2500);
  });
}

/**
 * Extract an effective working directory from a leading `cd <dir> && ...`,
 * `cd <dir>; ...`, or `pushd <dir> && ...`. Falls back to process.cwd().
 * Used to resolve `git rev-parse --abbrev-ref HEAD` in the right repo when
 * teammates work in worktrees and start commands with `cd <worktree>`.
 */
function extractEffectiveCwd(command: string, fallback: string): string {
  const m = command.match(
    /^\s*(?:cd|pushd)\s+(['"]?)([^'"\s;&]+)\1\s*(?:&&|;)/,
  );
  if (!m) return fallback;
  let dir = m[2];
  if (dir.startsWith("~")) dir = path.join(os.homedir(), dir.slice(1));
  return path.isAbsolute(dir) ? dir : path.resolve(fallback, dir);
}

async function getCurrentBranch(cwd: string): Promise<string | null> {
  return runProcess("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd);
}

// ── Teammate voter prompt (Stage 0 contextual review) ─────────────────────

const TEAMMATE_VOTER_SYSTEM_PROMPT = `You are a security reviewer for an autonomous AI coding assistant running unattended on a developer's workstation. Your job is to decide if a git command is safe to run without human supervision.

The agent is a TEAMMATE: spawned by the lead to autonomously implement a feature and end up at a DRAFT pull request. There is no human watching to confirm prompts.

You will receive:
- <command>: the bash command being attempted
- <git_branch>: the current branch in the working directory the command will run in
- <git_cwd>: the working directory itself (worktree path)
- <last_user_message>: the most recent instruction from the lead
- <turns_since_request>: how many turns ago the lead spoke

Vote YES only if ALL of these hold:
- <git_branch> is clearly a feature branch — NOT main, master, production, prod, staging, release/*, hotfix/*
- The command does not include --force, --force-with-lease, -f, or a + refspec
- For \`git push\`: the target is a feature branch on origin (or a fork) — not a protected branch
- The lead's last instruction is consistent with the agent making a draft PR (e.g. "end at a draft PR", "submit draft", "create a feature branch")

Vote NO if ANY of these hold:
- <git_branch> is a protected branch (main/master/production/staging/release/hotfix)
- The command targets a protected branch via positional ref or src:dst refspec
- Force push or any flag that leaves draft state
- The lead's last instruction does NOT clearly authorize autonomous commit/submit (e.g. they said "don't commit", or there's no relevant context)
- The command does anything beyond pushing the current feature branch as a draft PR
- ANYTHING ambiguous — when in doubt, vote NO. The lead can re-issue the command directly.

Respond with exactly one word: YES or NO. No explanation.`;

interface TeammateVoteContext {
  command: string;
  branch: string;
  cwd: string;
  lastUserMessage: string;
  turnsSinceUserMessage: number;
}

function buildTeammateVoterMessage(c: TeammateVoteContext): string {
  return [
    `<command>${c.command}</command>`,
    `<git_branch>${c.branch}</git_branch>`,
    `<git_cwd>${c.cwd}</git_cwd>`,
    `<last_user_message>${c.lastUserMessage || "(none)"}</last_user_message>`,
    `<turns_since_request>${c.turnsSinceUserMessage}</turns_since_request>`,
  ].join("\n");
}

// ── Remote mutation patterns (Stage 1 — checked before whitelist/voters) ─────

interface RemoteMutationPattern {
  pattern: RegExp;
  label: string;
}

const REMOTE_MUTATION_PATTERNS: RemoteMutationPattern[] = [
  // git
  { pattern: /\bgit\s+push\b/, label: "git push" },

  // gh pr — mirrors TEAMMATE_BLOCKED_PATTERNS. Binks-reply primitives
  // (`gh pr comment`, `gh pr review --comment`) are intentionally NOT
  // matched here so they pass through with no dialog for the lead and no
  // hard-block for teammates (which fall through to matchRemoteMutation
  // at teammateGate step 4). Verdict reviews and `gh pr ready` are caught
  // by their own patterns below.
  {
    pattern: /\bgh\s+pr\s+ready\b/,
    label: "gh pr ready",
  },
  {
    pattern: /\bgh\s+pr\s+(edit|create|merge|close|reopen|convert-to-draft)\b/,
    label: "gh pr (mutating)",
  },
  {
    pattern: /\bgh\s+pr\s+review\b[^|;&]*--(approve|request-changes)\b/,
    label: "gh pr review (verdict)",
  },

  // gs (gitstream / Meteorite) — mirrors the gh pr block above, including the
  // Binks-reply carve-out (`gs pr comment`, `gs pr review --comment`,
  // `gs pr react`, `gs pr resolve`/`unresolve` are not matched).
  {
    pattern: /\bgs\s+pr\s+ready\b/,
    label: "gs pr ready",
  },
  {
    pattern: /\bgs\s+pr\s+(edit|create|merge|close|reopen)\b/,
    label: "gs pr (mutating)",
  },
  {
    pattern: /\bgs\s+pr\s+review\b[^|;&]*--(approve|request-changes)\b/,
    label: "gs pr review (verdict)",
  },
  // `gs submit` = push + create/retarget PRs; `gs push` may escalate to
  // --force-with-lease on a diverged branch.
  {
    pattern: /\bgs\s+(submit|push)\b/,
    label: "gs submit/push",
  },
  {
    pattern:
      /\bgs\s+api\b(?![^\n]*(?:pulls\/[^\s\/]+\/comments|\/reactions(?:\b|\/)|\/threads\/[^\s\/]+\/resolve|resolveReviewThread))[^\n]*(--method|-X)\s+(POST|PATCH|PUT|DELETE)\b/i,
    label: "gs api (mutating)",
  },
  // Implicit POST: gh/gs api infer the method from a body flag, so a review
  // verdict posts as `gs api .../reviews/N/events -f event=REQUEST_CHANGES`
  // with no -X anywhere. That shape cleared Stage 1, then failed the
  // whitelist on the same body flag, and paid a 3-voter LLM review for a
  // decision this pattern makes outright. Same Binks-reply carve-out.
  {
    pattern:
      /\bgs\s+api\b(?![^\n]*(?:pulls\/[^\s\/]+\/comments|\/reactions(?:\b|\/)|\/threads\/[^\s\/]+\/resolve|resolveReviewThread))[^\n]*\s(?:-f|-F|--field|--raw-field|--input)[\s=]/,
    label: "gs api (implicit POST)",
  },

  // gh issue
  {
    pattern: /\bgh\s+issue\s+(create|close|reopen|edit|comment|delete)\b/,
    label: "gh issue (mutating)",
  },

  // gh release
  {
    pattern: /\bgh\s+release\s+(create|delete|edit|upload)\b/,
    label: "gh release (mutating)",
  },

  // gh repo
  {
    pattern: /\bgh\s+repo\s+(create|fork|delete|rename|transfer)\b/,
    label: "gh repo (mutating)",
  },

  // gh api (mutating methods only — GET calls pass through). Binks-reply
  // endpoints are excluded via the same negative-lookahead carve-out used
  // in TEAMMATE_BLOCKED_PATTERNS, so they bypass both the lead's dialog and
  // the teammate hard-block. Excluded URL fragments:
  //   - repos/*/pulls/*/comments      (PR review comments + threaded replies)
  //   - */reactions                   (reactions on issues / PR comments)
  //   - */threads/*/resolve           (resolving review threads, REST)
  //   - GraphQL `resolveReviewThread` mutation (resolving review threads)
  // Lead UX impact is suppressing a y/n confirmation for these specific
  // safe endpoints — leads who run them directly never had to think about
  // them. All other mutations (releases, dispatches, repo contents, etc.)
  // still prompt as before.
  {
    pattern:
      /\bgh\s+api\b(?![^\n]*(?:pulls\/[^\s\/]+\/comments|\/reactions(?:\b|\/)|\/threads\/[^\s\/]+\/resolve|resolveReviewThread))[^\n]*(--method|-X)\s+(POST|PATCH|PUT|DELETE)\b/i,
    label: "gh api (mutating)",
  },
  // Implicit POST — see the `gs api` twin above. `gh api graphql -f query=`
  // is exempted when the document is a query: reading the GraphQL API is a
  // GET in every sense but the transport.
  {
    pattern:
      /\bgh\s+api\b(?![^\n]*(?:pulls\/[^\s\/]+\/comments|\/reactions(?:\b|\/)|\/threads\/[^\s\/]+\/resolve|resolveReviewThread))(?![^\n]*graphql[^\n]*-f\s+query=['"]?\s*query\b)[^\n]*\s(?:-f|-F|--field|--raw-field|--input)[\s=]/,
    label: "gh api (implicit POST)",
  },

  // GitHub Actions
  {
    pattern: /\bgh\s+workflow\s+(run|enable|disable)\b/,
    label: "gh workflow (mutating)",
  },
  {
    pattern: /\bgh\s+run\s+(rerun|cancel|delete)\b/,
    label: "gh run (mutating)",
  },

  // Shopify deploy
  { pattern: /\bquick\s+deploy\b/, label: "quick deploy" },
];

/**
 * Check if a command matches any remote mutation pattern.
 * Returns the matched pattern or undefined.
 */
function matchRemoteMutation(
  command: string,
): RemoteMutationPattern | undefined {
  return REMOTE_MUTATION_PATTERNS.find(({ pattern }) => pattern.test(command));
}

// ── Commit gate patterns (Stage 1.5 — session-scoped policy) ─────────────────

interface CommitPattern {
  pattern: RegExp;
  label: string;
}

const COMMIT_PATTERNS: CommitPattern[] = [
  { pattern: /\bgit\s+commit\b/, label: "git commit" },
  // `gs` passes unowned verbs through to git, so `gs commit` is `git commit`.
  // `gs modify` rewrites the current commit and restacks descendants.
  { pattern: /\bgs\s+commit\b/, label: "gs commit" },
  { pattern: /\bgs\s+modify\b/, label: "gs modify (amend + restack)" },
];

type CommitPolicy = "unset" | "auto-allow" | "confirm-each";

function matchCommitCommand(command: string): CommitPattern | undefined {
  return COMMIT_PATTERNS.find(({ pattern }) => pattern.test(command));
}

// ── Push auto-allow helpers (Stage 1 × Stage 1.5 bridge) ─────────────────────────────────
// When commit policy is 'auto-allow', safe pushes to the current branch skip
// the Stage 1 remote mutation dialog entirely. These helpers classify commands.

/**
 * Detect dangerous force-push indicators in a git push command.
 * --force-with-lease is SAFE (used by CI auto-fix loops).
 * --force (without -with-lease), -f, and + refspec prefix are DANGEROUS.
 */
function isDangerousPush(command: string): boolean {
  const m = command.match(/\bgit\s+push\b([^|;&]*)/);
  if (!m) return false;
  const args = m[1];
  if (/--force(?!-with-lease)\b/.test(args)) return true;
  if (/(?:^|\s)-[a-zA-Z]*f[a-zA-Z]*(?:\s|$)/.test(args)) return true;
  if (/\s\+\S/.test(args)) return true;
  return false;
}

/**
 * Extract the explicit target branch from a git push command, if any.
 * Returns null when the command pushes the current branch implicitly,
 * the string branch name when an explicit target is found, or 'deletion'
 * when the refspec is a branch deletion (e.g., `git push origin :branch`).
 */
function parsePushTargetBranch(command: string): string | null | "deletion" {
  const m = command.match(/\bgit\s+push\b([^|;&]*)/);
  if (!m) return null;
  const tokens = m[1]
    .trim()
    .split(/\s+/)
    .filter((t) => t && !t.startsWith("-"));
  // tokens[0] = remote (e.g., "origin"), tokens[1] = refspec
  if (tokens.length < 2) return null;
  let refspec = tokens[1].replace(/^\+/, "");
  if (refspec === "HEAD" || refspec === "") return null;
  const colon = refspec.indexOf(":");
  if (colon >= 0) {
    const src = refspec.slice(0, colon);
    const dst = refspec.slice(colon + 1).replace(/^refs\/heads\//, "");
    if (src === "") return "deletion"; // :branch = delete remote branch
    return dst || null;
  }
  return refspec;
}

/**
 * Check if a remote mutation qualifies for silent auto-allow when commit
 * policy is 'auto-allow'. Only git push can qualify. Returns false for all
 * other remote mutations.
 *
 * Conditions for auto-allow:
 * - getCurrentBranch() returns a known, non-protected branch
 * - No dangerous force flags (--force/-f/+ refspec)
 * - Explicit target branch (if any) matches current branch
 * - Not a deletion refspec
 */
async function canAutoAllowPush(command: string): Promise<boolean> {
  const cwd = extractEffectiveCwd(command, process.cwd());

  // git push
  if (/\bgit\s+push\b/.test(command)) {
    if (isDangerousPush(command)) return false;
    const branch = await getCurrentBranch(cwd);
    if (!branch || branch === "HEAD") return false;
    if (PROTECTED_BRANCH_RE.test(branch)) return false;
    const target = parsePushTargetBranch(command);
    if (target === "deletion") return false;
    if (target === null) return true; // push to upstream of current branch
    return target === branch;
  }

  // Anything else (gh pr, gh issue, quick deploy, etc.) — always dialog
  return false;
}

// ── Teammate gate (Stage 0) ── helpers ─────────────────────────────────────────

/**
 * Cast a single teammate vote using the contextual prompt. Returns "yes",
 * "no", or null on timeout/error/unexpected response. Mirrors `castVote`
 * but with a different system prompt and message shape. Kept separate so
 * the main voter path is untouched.
 */
async function castTeammateVote(
  voter: { model: any; apiKey: string; label: string },
  voteCtx: TeammateVoteContext,
): Promise<"yes" | "no" | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VOTE_TIMEOUT_MS);
  try {
    const response = await complete(
      voter.model,
      {
        systemPrompt: TEAMMATE_VOTER_SYSTEM_PROMPT,
        messages: [
          {
            role: "user" as const,
            content: [
              {
                type: "text" as const,
                text: buildTeammateVoterMessage(voteCtx),
              },
            ],
            timestamp: Date.now(),
          },
        ],
      },
      { apiKey: voter.apiKey, maxTokens: 16, signal: controller.signal },
    );
    if (response.stopReason === "error") return null;
    const text = extractText(response.content).trim().toUpperCase();
    if (text.startsWith("YES")) return "yes";
    if (text.startsWith("NO")) return "no";
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Result of running the teammate Stage 0 gate.
 *   "allow"        — silently allow the command
 *   "fall-through" — not a teammate-relevant command, run remaining stages
 *   { block }      — block with a model-readable reason
 */
type TeammateGateResult =
  "allow" | "fall-through" | { block: true; reason: string };

async function teammateGate(
  command: string,
  ctx: ExtensionContext,
): Promise<TeammateGateResult> {
  // 1. Hard-block list — no voting, no dialog.
  for (const { pattern, label, reason } of TEAMMATE_BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return {
        block: true,
        reason: `[teammate] Blocked ${label}: ${reason} Report back to the lead instead of retrying.`,
      };
    }
  }

  // 2. Commit-gate commands — silent allow. Teammates working in their own
  //    worktree on a feature branch are expected to commit autonomously.
  if (matchCommitCommand(command)) {
    return "allow";
  }

  // 3. Votable mutations — git push to feature branch.
  for (const { pattern, label } of TEAMMATE_VOTABLE_PATTERNS) {
    if (!pattern.test(command)) continue;

    const cwd = extractEffectiveCwd(command, process.cwd());
    const branch = (await getCurrentBranch(cwd)) ?? "unknown";

    // Deterministic safety: hard-block if branch looks protected. Belt-and-
    // braces with the voter prompt — if voters miss it, we still catch it.
    if (PROTECTED_BRANCH_RE.test(branch)) {
      return {
        block: true,
        reason: `[teammate] Blocked ${label}: working branch '${branch}' is protected. Report back to the lead.`,
      };
    }
    if (branch === "unknown" || branch === "HEAD") {
      return {
        block: true,
        reason: `[teammate] Blocked ${label}: could not determine branch in '${cwd}' (detached HEAD or not a git repo). Report back to the lead.`,
      };
    }

    // Run the contextual voter pass. Fail closed: no voters → block.
    const voterModels = await resolveVoterModels(ctx);
    if (voterModels.length === 0) {
      return {
        block: true,
        reason: `[teammate] Blocked ${label}: no voter models available to verify branch safety. Report back to the lead.`,
      };
    }
    const voters = distributeVoters(voterModels);
    const voterContext = extractVoterContext(ctx.sessionManager.getBranch());
    const voteCtx: TeammateVoteContext = {
      command,
      branch,
      cwd,
      lastUserMessage: voterContext.lastUserMessage,
      turnsSinceUserMessage: voterContext.turnsSinceUserMessage,
    };

    const results = await Promise.all(
      voters.map((v) => castTeammateVote(v, voteCtx)),
    );
    const yes = results.filter((r) => r === "yes").length;
    const no = results.filter((r) => r === "no").length;
    const decided = yes + no;

    // Require at least 2 decided voters AND unanimous YES.
    if (decided >= 2 && no === 0) {
      if (ctx.hasUI) {
        ctx.ui.notify(
          `🤝 teammate-gate: allowed ${label} on '${branch}' (${yes}/${decided} YES)`,
          "info",
        );
      }
      return "allow";
    }

    return {
      block: true,
      reason: `[teammate] Blocked ${label} on branch '${branch}': voter consensus ${yes} YES / ${no} NO / ${results.length - decided} abstained. Verify the branch is appropriate or report back to the lead.`,
    };
  }

  // 4. Any other remote mutation — hard-block. Teammate cannot confirm
  //    interactively, so we deny rather than deadlock on a dialog.
  const otherRemote = matchRemoteMutation(command);
  if (otherRemote) {
    return {
      block: true,
      reason: `[teammate] Cannot prompt interactively for ${otherRemote.label}. The lead must perform this action.`,
    };
  }

  return "fall-through";
}

/**
 * Show a lightweight y/n confirmation dialog for remote mutations.
 * Pressing `n` enters feedback mode where the user can type redirect instructions.
 */
async function showRemoteMutationDialog(
  ctx: ExtensionContext,
  command: string,
  matched: RemoteMutationPattern,
): Promise<{ allowed: boolean; instructions?: string }> {
  return blockingCustom<{ allowed: boolean; instructions?: string }>(
    ctx,
    `Remote mutation (${matched.label})`,
    (tui, theme, _kb, done) => {
      let mode: "decide" | "feedback" = "decide";
      let resolved = false;
      // Ignore keypresses for 500ms to prevent accidental input from typing
      // or stray terminal control sequences (e.g. tmux focus events via PTY splitting)
      const dialogOpenedAt = Date.now();
      const INPUT_COOLDOWN_MS = 500;

      const container = new Container();
      container.addChild(border(theme));
      container.addChild(new Spacer(1));
      container.addChild(
        new Text(
          "  " +
            theme.fg(
              "accent",
              theme.bold(`🌐 Remote mutation (${matched.label})`),
            ),
          1,
          0,
        ),
      );
      container.addChild(new Spacer(1));
      container.addChild(
        new Text(
          "  " +
            theme.fg("muted", "$ ") +
            theme.fg("warning", truncateCmd(command)),
          1,
          0,
        ),
      );

      const feedbackInput = new Input();
      feedbackInput.onSubmit = (value: string) => {
        if (resolved) return;
        resolved = true;
        done({ allowed: false, instructions: value || undefined });
      };
      feedbackInput.onEscape = () => {
        if (resolved) return;
        resolved = true;
        done({ allowed: false });
      };

      const footerSpacer = new Spacer(1);
      const hintsText = new Text(
        "  " +
          theme.fg("dim", "y") +
          theme.fg("muted", " allow  ") +
          theme.fg("dim", "n") +
          theme.fg("muted", " deny  ") +
          theme.fg("dim", "esc") +
          theme.fg("muted", " dismiss"),
        1,
        0,
      );
      const bottomSpacer = new Spacer(1);
      const bottomBorder = border(theme);

      container.addChild(footerSpacer);
      container.addChild(hintsText);
      container.addChild(bottomSpacer);
      container.addChild(bottomBorder);

      const repaint = () => {
        container.invalidate();
        tui.requestRender();
      };

      const enterFeedbackMode = () => {
        mode = "feedback";

        container.removeChild(footerSpacer);
        container.removeChild(hintsText);
        container.removeChild(bottomSpacer);
        container.removeChild(bottomBorder);

        container.addChild(
          new Text(
            "  " + theme.fg("muted", "Tell the agent what to do instead:"),
            1,
            0,
          ),
        );
        container.addChild(feedbackInput);
        container.addChild(new Spacer(1));

        hintsText.setText(
          "  " +
            theme.fg("dim", "enter") +
            theme.fg("muted", " submit  ") +
            theme.fg("dim", "esc") +
            theme.fg("muted", " skip"),
        );
        container.addChild(hintsText);
        container.addChild(bottomSpacer);
        container.addChild(bottomBorder);

        feedbackInput.focused = true;
        repaint();
      };

      return {
        render: (w: number) => container.render(w),
        invalidate: () => container.invalidate(),
        handleInput: (data: string) => {
          if (resolved) return;
          if (isTerminalControlSequence(data)) return;
          if (Date.now() - dialogOpenedAt < INPUT_COOLDOWN_MS) return;
          if (mode === "feedback") {
            feedbackInput.handleInput(data);
            repaint();
            return;
          }
          if (data === "y" || data === "Y") {
            resolved = true;
            done({ allowed: true });
          } else if (data === "n" || data === "N") {
            enterFeedbackMode();
          } else if (matchesKey(data, Key.escape)) {
            resolved = true;
            done({ allowed: false });
          }
        },
        get focused() {
          return feedbackInput.focused;
        },
        set focused(v: boolean) {
          feedbackInput.focused = v;
        },
      };
    },
  );
}

// ── Commit gate dialogs (Stage 1.5) ──────────────────────────────────────────

/**
 * First-encounter dialog: set session policy for commit-like commands.
 * Returns the chosen policy and optional instructions if denied.
 */
async function showCommitPolicyDialog(
  ctx: ExtensionContext,
  command: string,
  matched: CommitPattern,
): Promise<{ policy: CommitPolicy; instructions?: string }> {
  return blockingCustom<{ policy: CommitPolicy; instructions?: string }>(
    ctx,
    `Commit gate (${matched.label})`,
    (tui, theme, _kb, done) => {
      let mode: "decide" | "feedback" = "decide";
      let resolved = false;
      // Ignore keypresses for 500ms to prevent accidental input from typing
      // or stray terminal control sequences (e.g. tmux focus events via PTY splitting)
      const dialogOpenedAt = Date.now();
      const INPUT_COOLDOWN_MS = 500;

      const container = new Container();
      container.addChild(border(theme));
      container.addChild(new Spacer(1));
      container.addChild(
        new Text(
          "  " +
            theme.fg("accent", theme.bold(`📝 Commit gate (${matched.label})`)),
          1,
          0,
        ),
      );
      container.addChild(new Spacer(1));
      container.addChild(
        new Text(
          "  " +
            theme.fg("muted", "$ ") +
            theme.fg("warning", truncateCmd(command)),
          1,
          0,
        ),
      );

      container.addChild(new Spacer(1));
      container.addChild(
        new Text(
          "  " +
            theme.fg("muted", "How should commits be handled this session?"),
          1,
          0,
        ),
      );

      const feedbackInput = new Input();
      feedbackInput.onSubmit = (value: string) => {
        if (resolved) return;
        resolved = true;
        done({ policy: "unset", instructions: value || undefined });
      };
      feedbackInput.onEscape = () => {
        if (resolved) return;
        resolved = true;
        done({ policy: "unset" });
      };

      const footerSpacer = new Spacer(1);
      const hintsText = new Text(
        "  " +
          theme.fg("dim", "a") +
          theme.fg("muted", " auto-allow all  ") +
          theme.fg("dim", "c") +
          theme.fg("muted", " confirm each  ") +
          theme.fg("dim", "n") +
          theme.fg("muted", " deny"),
        1,
        0,
      );
      const bottomSpacer = new Spacer(1);
      const bottomBorder = border(theme);

      container.addChild(footerSpacer);
      container.addChild(hintsText);
      container.addChild(bottomSpacer);
      container.addChild(bottomBorder);

      const repaint = () => {
        container.invalidate();
        tui.requestRender();
      };

      const enterFeedbackMode = () => {
        mode = "feedback";

        container.removeChild(footerSpacer);
        container.removeChild(hintsText);
        container.removeChild(bottomSpacer);
        container.removeChild(bottomBorder);

        container.addChild(
          new Text(
            "  " + theme.fg("muted", "Tell the agent what to do instead:"),
            1,
            0,
          ),
        );
        container.addChild(feedbackInput);
        container.addChild(new Spacer(1));

        hintsText.setText(
          "  " +
            theme.fg("dim", "enter") +
            theme.fg("muted", " submit  ") +
            theme.fg("dim", "esc") +
            theme.fg("muted", " skip"),
        );
        container.addChild(hintsText);
        container.addChild(bottomSpacer);
        container.addChild(bottomBorder);

        feedbackInput.focused = true;
        repaint();
      };

      return {
        render: (w: number) => container.render(w),
        invalidate: () => container.invalidate(),
        handleInput: (data: string) => {
          if (resolved) return;
          if (isTerminalControlSequence(data)) return;
          if (Date.now() - dialogOpenedAt < INPUT_COOLDOWN_MS) return;
          if (mode === "feedback") {
            feedbackInput.handleInput(data);
            repaint();
            return;
          }
          if (data === "a" || data === "A") {
            resolved = true;
            done({ policy: "auto-allow" });
          } else if (data === "c" || data === "C") {
            resolved = true;
            done({ policy: "confirm-each" });
          } else if (data === "n" || data === "N") {
            enterFeedbackMode();
          } else if (matchesKey(data, Key.escape)) {
            resolved = true;
            done({ policy: "unset" });
          }
        },
        get focused() {
          return feedbackInput.focused;
        },
        set focused(v: boolean) {
          feedbackInput.focused = v;
        },
      };
    },
  );
}

/**
 * Confirm-each dialog for subsequent commits (simple y/n like remote mutations).
 */
async function showCommitConfirmDialog(
  ctx: ExtensionContext,
  command: string,
  matched: CommitPattern,
): Promise<{ allowed: boolean; instructions?: string }> {
  // Reuse the remote mutation dialog — same UX, different label
  return showRemoteMutationDialog(ctx, command, {
    pattern: matched.pattern,
    label: `commit: ${matched.label}`,
  });
}

// ── Configuration (Stage 2 — voter review) ───────────────────────────────────

/** Number of votes per available model. Total voters = available models × this.
 * With a single model (haiku-4.5), 5 votes are highly correlated and just
 * amplify the same bias. 3 votes still get majority signal with less cost/latency
 * and fewer false-unanimous-NO results from prompt miscalibration. */
const VOTES_PER_MODEL = 1;
// 8s (raised from 5s): fast review models occasionally exceed 5s under load,
// and a fully-timed-out vote (all abstentions) falls through to a blocking
// dialog — a reliability false-alert, not a safety signal. The Stage-2 path
// also retries once on full abstention (see runVoteTracking call site).
const VOTE_TIMEOUT_MS = 8000;

const EXPLAINER_PROVIDER = "anthropic";
const EXPLAINER_MODEL_ID = "claude-haiku-4-5";
const EXPLAINER_CONTEXT_MESSAGES = 20;

const VOTER_SYSTEM_PROMPT = `You review ONE question for a coding assistant running on a professional developer's macOS workstation:

**Is this command obtaining, exposing, or moving a credential through a path the developer did not sanction — or evading a guard in order to do so?**

You are NOT a general safety reviewer. Destructive commands, remote mutations, and commits are gated elsewhere and are not your concern. A command only reaches you because it touched the credential or bypass surface. Most of what reaches you is legitimate. Say so.

Input arrives as <command>. You may also get:
- <triggered_rules> — which surface rules matched. A rule firing is a reason to look, never a verdict.
- <recent_failure> — the last tool or command error in this session, if any.
- <user_context> — the developer's last message and how many turns ago it was.
- <previous_decisions> — commands the developer already ruled on, with their feedback.

## The distinction that matters

Sanctioned: the credential is obtained from the tool that owns it, through that tool's own interface, for the purpose the developer asked for.
  export CLOUDSDK_AUTH_ACCESS_TOKEN="$(gcloud auth application-default print-access-token)"   → YES
  gh api repos/foo/bar/pulls/1        (gh manages its own auth)                               → YES
  aws sso login                                                                               → YES

Workaround: the credential is dug out of storage that belongs to something else, or a shim is evaded to reach a raw binary.
  FIGMA_TOKEN=$(grep -o 'figd_[A-Za-z0-9_-]*' ~/.pi/agent/extensions/figma-plugin/config.json) → NO
  security find-generic-password -s anthropic -a api_key -w                                    → NO
  export GH_TOKEN=ghp_<literal>                                                                → NO
  curl -H "Authorization: bearer $(gh auth token)" https://api.github.com/...                  → NO   (gh api does this correctly)
  env -i PATH=/usr/bin git ...  /  command git ...                                             → NO   (evading a hook or shim)
  ejson decrypt config/secrets.*.ejson                                                         → NO

## Weigh these

- <recent_failure> is the strongest signal you have. A credential-shaped command immediately after a tool, auth, or MCP failure is very likely an improvised workaround. Vote NO and let the developer re-authenticate or fix the tool.
- A dedicated tool existing for the job makes hand-rolled auth a workaround, even when it would work. Passing a token to curl when \`gh\`/\`gs\` would do it is NO.
- A literal secret pasted into the command is always NO. It came from somewhere it should not have.
- Reading source code that merely *mentions* a credential name is not credential access. \`git grep GITSTREAM_TOKEN\`, \`grep -c attachment_token file.rb\`, reading a provider class → YES.
- Reading or listing a developer's own non-secret config (\`ls ~/.config/herdr\`, \`grep font ~/.config/kitty/kitty.conf\`) → YES.
- \`<previous_decisions>\`: if the developer allowed this exact shape before, vote YES unless this instance reaches somewhere new. If they denied it, vote NO and honour the reason in <user_feedback>.
- The developer asking for the outcome does not sanction the method. "get me the Figma file" does not authorise harvesting a Figma token out of a config file.

Respond with exactly one word: YES or NO. No explanation.

YES = the credential path is sanctioned, or no credential is actually being obtained.
NO  = the assistant is acquiring, exposing, relocating, or evading a guard for a credential.

For a compound or multi-line script, judge every command in it. If any one of them is a workaround, the answer for the whole script is NO.`;

const EXPLAINER_SYSTEM_PROMPT = `You are reviewing a bash command that an AI coding assistant is attempting to execute. A panel of security reviewers flagged this command.

Based on the conversation context provided, respond with a JSON object in exactly this format:
{
  "explanation": "**What it does:** ...\n\n**Why it's being run:** ...\n\n**Risk:** ...",
  "vote": "YES or NO"
}

For the "explanation" field, include:
- **What it does:** One sentence describing what the command does.
- **Why it's being run:** One sentence explaining why the assistant is trying to run it, referencing the user's request.
- **Risk:** One sentence flagging any potential risks or confirming it's safe.

For the "vote" field: reconsider the original NO vote in light of the full conversation context.
- Vote "YES" ONLY if you are very confident the command is safe AND it was clearly requested or required by the user.
- Vote "NO" if there is any genuine risk, ambiguity, or if the command goes beyond what the user asked for.
- When in doubt, vote "NO".

Respond with ONLY the JSON object. No other text.`;

const AGGREGATOR_SYSTEM_PROMPT = `You are combining security explanations from multiple reviewers who flagged a bash command as unsafe.

Synthesize their explanations into exactly this format:

**What it does:** One sentence describing what the command does.

**Why it's being run:** One sentence explaining why the assistant is trying to run it.

**Risk:** Synthesize all reviewer concerns into 1-2 sentences.

Be factual and concise. Do not add any other text outside this format.`;

// ── Safe-command whitelist ────────────────────────────────────────────────────
//
// Architecture: compound-command-aware parsing
//
//   1. Strip safe stderr redirects (2>&1, 2>/dev/null)
//   2. Split on command separators (&&, ||, ;, \n)
//   3. Within each segment, split pipe chains on spaced ` | `
//      (quote-aware, so jq/awk programs containing ` | ` stay intact)
//   4. Validate each atomic command against safe patterns + dangerous-flag checks
//
// Shell metacharacters (`, >, |) are only meaningful OUTSIDE quotes. Every
// check below scans with quote tracking — a naive substring test flags
// `echo "a -> b"`, markdown code spans in `gh api -f body='…`x`…'`, and
// arrow functions in `node -e '…=>…'` as redirects/subshells.
//
// Commands with conditionally-safe patterns (sed, find, sort) are allowed
// only when dangerous flags are absent (-i, -exec/-delete, -o respectively).
//
// awk is intentionally omitted: system() builtin and internal file I/O make
// it impossible to whitelist safely without parsing the awk program.

/** Patterns for commands that are always safe (read-only, no side effects). */
const SAFE_COMMAND_PATTERNS: RegExp[] = [
  // ── File reading & text processing ──
  /^\s*ls\b/,
  /^\s*cat\b/,
  /^\s*echo\b/,
  /^\s*printf\b/,
  /^\s*pwd\s*$/,
  /^\s*whoami\s*$/,
  /^\s*date\b/,
  /^\s*head\b/,
  /^\s*tail\b/,
  /^\s*wc\b/,
  /^\s*grep\b/,
  /^\s*rg\b/,
  /^\s*sed\b/, // conditionally safe: blocked if -i / --in-place
  /^\s*find\b/, // conditionally safe: blocked if -exec / -delete / -ok
  /^\s*sort\b/, // conditionally safe: blocked if -o
  /^\s*which\b/,
  /^\s*type\b/,
  /^\s*file\b/,
  /^\s*stat\b/,
  /^\s*du\b/,
  /^\s*df\b/,
  /^\s*tree\b/,
  /^\s*man\b/,
  /^\s*diff\b/,
  /^\s*md5(sum)?\b/,
  /^\s*sha\d+sum\b/,
  /^\s*uniq\b/,
  /^\s*cut\b/,
  /^\s*tr\b/,
  /^\s*jq\b/,

  // ── Path & environment ──
  /^\s*cd\b/,
  /^\s*command\s+-[vV]\b/, // lookup only; `command <cmd>` runs it
  /^\s*hash\s+-\w+\b/,
  /^\s*tty\s*$/,
  /^\s*(date|whoami|groups|locale)\b/,
  /^\s*basename\b/,
  /^\s*dirname\b/,
  /^\s*realpath\b/,
  /^\s*readlink\b/,
  /^\s*env\s*$/,
  /^\s*printenv\b/,
  /^\s*uname\b/,
  /^\s*id\s*$/,
  /^\s*hostname\b/,
  /^\s*nproc\s*$/,
  /^\s*free\b/,
  /^\s*uptime\s*$/,
  /^\s*test\b/,
  /^\s*\[\s/,
  /^\s*true\s*$/,
  /^\s*false\s*$/,
  /^\s*break\s*$/,
  /^\s*continue\s*$/,
  /^\s*return\b/,
  /^\s*sleep\b/,
  /^\s*read\b/, // shell builtin for reading input (not file modification)

  // ── Shell control-flow keywords (safe standalone tokens after ; splitting) ──
  /^\s*else\s*$/,
  /^\s*fi\s*$/,
  /^\s*done\s*$/,
  /^\s*esac\s*$/,
  /^\s*do\s*$/,

  // ── System inspection (read-only) ──
  /^\s*ps\b/,
  /^\s*tput\b/,

  // ── Shell comments ──
  /^\s*#/,

  // ── xargs with safe targets ──
  /^\s*xargs\s+(grep|rg|ls|cat|head|tail|wc|file|stat)\b/,

  // ── Git read-only operations ──
  /^\s*git\s+(status|log|diff|show|branch|tag|remote|fetch)\b/,
  /^\s*git\s+(reflog|blame|annotate|shortlog)\b/,
  /^\s*git\s+(ls-files|rev-parse|describe|merge-base|name-rev)\b/,
  /^\s*git\s+(symbolic-ref|cat-file|show-ref|for-each-ref|var|ls-remote|check-ref-format|check-ignore)\b/,
  /^\s*git\s+worktree\s+(list|add|prune)\b/,
  /^\s*git\s+stash\s+(list|show)\b/,
  /^\s*git\s+config\s+(--get|--list|-l)\b/,
  // Plumbing that only reads the object database or the index. `grep` and
  // `ls-tree` against a ref are the two most common — searching tracked source
  // is code reading, not filesystem access (secrets in-tree are ejson).
  /^\s*git\s+(grep|ls-tree|rev-list|merge-tree|range-diff|hash-object|count-objects|whatchanged|verify-pack|diff-tree|diff-index)\b/,
  // --stat/--check/--numstat/--summary inspect a patch; bare `git apply` writes.
  /^\s*git\s+apply\b(?=[^|;&]*--(stat|check|numstat|summary)\b)/,

  // ── GitHub CLI read operations ──
  /^\s*gh\s+pr\s+(view|list|diff|checks|status)\b/,
  /^\s*gh\s+issue\s+(view|list|status)\b/,
  /^\s*gh\s+label\s+list\b/,
  /^\s*gh\s+repo\s+(view|list)\b/,
  /^\s*gh\s+project\s+(view|list|field-list)\b/,
  /^\s*gh\s+auth\s+(status|token|refresh|login|setup-git)\b/,
  /^\s*gh\s+run\s+(view|list|watch)\b/,
  /^\s*gh\s+workflow\s+(view|list)\b/,

  // ── GitHub CLI API (read-only by default; mutating methods caught by Stage 1,
  //    data flags caught by hasDangerousFlags) ──
  /^\s*gh\s+api\b/,

  // ── GitHub CLI search (always read-only) ──
  /^\s*gh\s+search\b/,

  // ── Gitstream CLI reads (Meteorite PRs). Mutating verbs (create/edit/ready/
  //    merge/review verdicts/submit/push) are caught by Stage 1; `gs api` data
  //    flags are caught by hasDangerousFlags. `gs pr comment|react|resolve|
  //    unresolve` are the Binks-reply primitives, carved out of Stage 1 the
  //    same way their gh counterparts are. ──
  /^\s*gs\s+pr\s+(view|list|diff|checks|open|oplog|stack)\b/,
  /^\s*gs\s+pr\s+(comment|react|resolve|unresolve)\b/,
  /^\s*gs\s+pr\s+review\b(?![^\n]*--(approve|request-changes)\b)/,
  /^\s*gs\s+api\b/,
  /^\s*gs\s+pr\s+(comments|files|reviews|threads)\b/,
  /^\s*gs\s+(log|ls|status|auth|version|track)\b/,
  /^\s*gs\s+(up|down|top|bottom|b|t|u|d)\b/,
  /^\s*(gs|gh|gt)\s+(--version|--help|-h)\b/,

  // ── Shopify dev tooling ──
  /^\s*(\/opt\/dev\/bin\/dev|dev)\s+(up|server|backend|cd|test|typecheck|style|console|migrate|stop|ps|lint|github|tree|internal|runner)\b/,
  /^\s*shadowenv\s+exec\b/,
  /^\s*quick\s+auth\b/,
  /^\s*_?wtp\b/,
  /^\s*\$\{?WTP_BIN\}?\b/, // variable-expanded WTP invocations
  /^\s*\$\{?HOME\}?\/src\/.*\/wtp\/bin\/_wtp\b/, // full-path WTP invocations
  /^\s*devx\s+(ci|pi|skill|config)\b/,

  // ── Local build / test / lint toolchain ──
  // These run project code that is already on disk. They reach the network
  // only to resolve declared dependencies, which `npm`/`pnpm` already do.
  /^\s*(dbt|uv|uvx|tsc|bundle|rubocop|srb|pytest|ruff|biome|prettier|eslint|vitest|jest|mise|rbenv|pyenv|poetry|make)\b/,
  /^\s*bash\s+-n\b/, // syntax check only; does not execute the script

  // ── Herdr (local terminal multiplexer) ──
  // Panes, tabs, workspaces and agents are all local processes on this
  // machine. `herdr agent prompt` drives another pi instance, which runs its
  // own bash-guard — gating the handoff buys nothing and costs a dialog.
  /^\s*herdr\b/,

  // ── Text/binary inspection (read-only) ──
  /^\s*(comm|join|paste|expand|unexpand|column|fold|nl|shuf|iconv|strings|cksum|shasum|xxd|hexdump|od)\b/,

  // ── Process signalling (local processes only) ──
  /^\s*pkill\b/,

  // ── Symlinks ── (creation only; hasDangerousFlags has no ln rule because
  //    `ln` cannot overwrite without -f, and -f is scoped by the target path)
  /^\s*ln\s+-[a-zA-Z]*s/,

  // ── Local databases over dev hosts ──
  //    Mozart's shared dev MySQL. Not reachable outside the dev network, and
  //    the alternative is the agent guessing at schema instead of reading it.
  /^\s*mysql\s+[^|;&]*-h\s+\S*(?:\.dev\.internal|localhost|127\.0\.0\.1)\b/,

  // ── Shell function definitions ──
  //    `run() { ... }` — the body is checked as its own segments by the
  //    splitter, so the definition header itself carries no risk.
  /^\s*[A-Za-z_]\w*\s*\(\)\s*\{/,

  // ── Block/loop redirect terminators ──
  //    `} > /tmp/out.md` and `done > /tmp/out.md` are the tail of a grouped
  //    command whose body was already checked segment by segment.
  /^\s*[}]\s*>>?\s*\S+/,
  /^\s*done\s*>>?\s*\S+/,

  // ── Tech checkout (read-only) ──
  /^\s*tec\s+(checkout|list|status|info|show)\b/,

  // ── File system operations (non-destructive) ──
  /^\s*mkdir\s+-p\b/,
  /^\s*ln\s+-s[f]?\b/,
  /^\s*cp\b/, // conditionally safe: blocked if targeting outside working tree (TODO)
  /^\s*mv\b/, // conditionally safe: blocked if targeting outside working tree (TODO)
  /^\s*chmod\s+\+[rwx]+\b/, // only additive permissions (no 777, no recursive)
  /^\s*rm\s+-f\s+\S*\.lock\b/, // removing stale lock files only

  // ── HTTP read operations ──
  /^\s*curl\b/, // conditionally safe: blocked if -X POST/PUT/DELETE or -d (see hasDangerousFlags)

  // ── DNS / network inspection (read-only) ──
  /^\s*dig\b/,
  /^\s*nslookup\b/,
  /^\s*host\b/,

  // ── Process inspection ──
  /^\s*pgrep\b/,
  /^\s*lsof\b/,

  // ── Node/npm/Python operations ──
  /^\s*npm\s+(info|view|ls|list|outdated|pack\s+--dry-run)\b/,
  /^\s*npx\b/,
  /^\s*pnpm\b/,
  /^\s*node\b/,
  /^\s*python3?\b/,
  /^\s*base64\b/,

  // ── macOS clipboard ──
  /^\s*pbcopy\b/,
  /^\s*pbpaste\b/,

  // ── macOS automation (conditionally safe: `do shell script` blocked) ──
  /^\s*osascript\b/,

  // ── Local databases (conditionally safe: DML/DDL + write dot-commands blocked) ──
  /^\s*sqlite3\b/,

  // ── Image inspection & transformation ──
  /^\s*(magick|convert|identify)\b/,

  // ── Infrastructure inspection (conditionally safe: only read-only subcommands) ──
  /^\s*terraform\b/,

  // ── Archive & checksum (conditionally safe: gzip/gunzip need -c/-l/-t) ──
  /^\s*(gzip|gunzip|zcat|shasum|cksum)\b/,

  // ── Inline interpreters (peers of the already-allowed node/python3) ──
  /^\s*ruby\b/,
  /^\s*perl\b/, // conditionally safe: blocked if -i (in-place edit)
  /^\s*(bin\/rails|rails)\s+runner\b/,
  /^\s*dev\s+runner\b/,

  // ── GPG inspection & signing (conditionally safe: key mutation blocked) ──
  /^\s*gpgconf\b/,
  /^\s*gpg\b/,

  // ── Package managers (read-only; install intentionally NOT whitelisted) ──
  /^\s*brew\s+(info|list|search|doctor|outdated|deps|desc|home|cat|log|uses|tap-info)\b/,

  // ── MCP tool read operations ──
  /^\s*slack-mcp\s+(get-messages|get-thread|get-unreads|get-channel-sections|get-channel-info|get-status|get-user-profile|get-reactions|get-saved-items|get-file|search|list|test|mcp|auth)\b/,

  // ── Pi and CI tooling ──
  /^\s*pi\s+(tool|session|model|config|extension|install|remove|uninstall|update|list|introspect)\b/,
  /^\s*bk\b/,

  // ── cmux terminal/window manager (UI, panes, notifications, read-only inspection) ──
  // Dangerous subcommands (vm/cloud/rpc/ssh, hooks install, auth login/logout) blocked via hasDangerousFlags.
  // `cmux send` treated like `tmux send-keys` — blast radius limited to user's own panes.
  /^\s*cmux\b/,

  // ── Ruby/Gem read operations ──
  /^\s*gem\s+(contents|list|search|info|spec|which|environment)\b/,

  // ── Google Cloud / BigQuery (read-only; mutating verbs blocked in hasDangerousFlags) ──
  // gcloud/bq are whitelisted broadly here, then hasDangerousFlags rejects
  // deploy/run/delete/create/update/storage-write/bq-DML/etc. This allows
  // routine read ops (list, describe, get-value, logging read, storage ls,
  // test-iam-permissions, bq show/ls/head) while still flagging mutations.
  /^\s*gcloud\b/,
  /^\s*bq\b/,

  // ── dbt read-only subcommands (compile/parse/ls/deps/debug — never run/build/seed) ──
  /^\s*(?:uv\s+run\s+)?dbt\s+(compile|parse|ls|list|deps|debug)\b/,

  // ── awk (read/transform; system()/getline/-f/in-program writes blocked in hasDangerousFlags) ──
  /^\s*awk\b/,

  // ── rmdir (removes only empty directories — non-destructive) ──
  /^\s*rmdir\b/,

  // ── Git write operations (normal dev workflow) ──
  // Note: git push is handled by the remote mutation gate (Stage 1)
  /^\s*git\s+(add|checkout|switch|restore|stash|cherry-pick|rebase|reset)\b/,

  // ── Shell builtins that are always safe ──
  /^\s*set\s+-[euo]/,
  /^\s*export\s+\w+=/,
  /^\s*[A-Za-z_]\w*=\S/, // variable assignment (no spaces — simple)
];

/** Stderr redirects that are always safe to strip before analysis. */
const STDERR_REDIRECT = /\s*2>(?:&1|\/dev\/null)/g;

// Top-level command separators (&&, ||, ;, \n) are split by the quote-aware
// splitTopLevel() helper rather than a regex split, so quoted arguments
// containing those tokens are not shattered into bogus segments.

/**
 * Extract the bodies of all top-level `$( … )` substitutions, honouring nesting.
 * `X=$(gh api … -f body="$(cat f)")` yields both the gh call and the cat.
 */
function extractCommandSubstitutions(cmd: string): string[] {
  const found: string[] = [];
  for (let i = 0; i < cmd.length - 1; i++) {
    if (cmd[i] !== "$" || cmd[i + 1] !== "(") continue;
    if (i > 0 && cmd[i - 1] === "\\") continue;
    // `$(( … ))` is arithmetic expansion — pure math, no command runs.
    if (cmd[i + 2] === "(") continue;
    let depth = 0;
    for (let j = i + 1; j < cmd.length; j++) {
      if (cmd[j] === "(") depth++;
      else if (cmd[j] === ")") {
        depth--;
        if (depth === 0) {
          found.push(cmd.slice(i + 2, j));
          i = j;
          break;
        }
      }
    }
  }
  return found;
}

/**
 * Scan a string for a character that is significant only outside quotes.
 * `pred` receives the character and its predecessor.
 */
function existsOutsideQuotes(
  input: string,
  pred: (ch: string, prev: string) => boolean,
): boolean {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const prev = i > 0 ? input[i - 1] : "";
    if (prev === "\\") continue;
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && pred(ch, prev)) return true;
  }
  return false;
}

/** Backtick command substitution (not a markdown code span inside a quoted arg). */
function hasUnquotedBacktick(cmd: string): boolean {
  return existsOutsideQuotes(cmd, (ch) => ch === "`");
}

/**
 * Real output redirect. Excludes `2>`/`1>` (stderr already stripped) and the
 * arrow/comparison digraphs `->`, `=>`, `!>`, `>>`-continuation that appear in
 * echo banners, curl `-w` formats, jq filters, and JS arrow functions.
 */
function hasUnquotedRedirect(cmd: string): boolean {
  return existsOutsideQuotes(
    cmd,
    (ch, prev) => ch === ">" && !"<>-=!123456789".includes(prev),
  );
}

/**
 * Quote-aware split of a pipe chain on spaced ` | `.
 * A naive split shatters `--jq '.[] | select(.x)'` and `awk '{a | b}'` into
 * fragments that can never match the whitelist.
 */
function splitPipeChain(segment: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let parenDepth = 0;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    const prev = i > 0 ? segment[i - 1] : "";
    if (prev === "\\") {
      current += ch;
      continue;
    }
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    if (!inSingle && !inDouble) {
      if (ch === "(") parenDepth++;
      else if (ch === ")" && parenDepth > 0) parenDepth--;
    }
    if (
      ch === "|" &&
      !inSingle &&
      !inDouble &&
      parenDepth === 0 &&
      prev === " " &&
      segment[i + 1] === " "
    ) {
      parts.push(current.slice(0, -1));
      current = "";
      i++;
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.filter((p) => p.trim());
}

/**
 * Substitute `VAR=value` assignments made earlier in the same command line.
 * Host allowlisting is useless against `B=http://localhost:7247/x; curl -X POST $B`
 * unless the variable is resolved first. Only literal assignments are followed.
 */
function resolveShellVars(cmd: string): string {
  const vars = new Map<string, string>();
  const assignment =
    /(?:^|[\s;&|(])([A-Za-z_]\w*)=("[^"]*"|'[^']*'|[^\s;&|)]+)/g;
  for (const m of currentCommandContext.matchAll(assignment)) {
    vars.set(m[1], m[2].replace(/^['"]|['"]$/g, ""));
  }
  if (vars.size === 0) return cmd;
  let out = cmd;
  for (let pass = 0; pass < 3; pass++) {
    const next = out.replace(
      /\$\{(\w+)\}|\$(\w+)/g,
      (whole, braced, bare) => vars.get(braced ?? bare) ?? whole,
    );
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * The full command currently under evaluation. `hasDangerousFlags` inspects one
 * atomic segment, but variable definitions live in sibling segments.
 */
let currentCommandContext = "";

/** Directory prefixes under which file removal is unconditionally safe. */
const SCRATCH_PREFIXES = [
  "/tmp/",
  "/private/tmp/",
  "/var/folders/",
  "~/.pi/tmp/",
  "$HOME/.pi/tmp/",
  "~/.herdr/worktrees/",
  "$HOME/.herdr/worktrees/",
];

/**
 * Repo-relative scratch dirs. `tmp/` is the conventional throwaway directory
 * inside a Mozart worktree (validation scripts, PR body drafts, probes), so
 * `rm -f tmp/probe.rb` is as disposable as `rm -f /tmp/probe.rb`. Relative
 * only — a leading `/` or `~` must go through SCRATCH_PREFIXES instead.
 */
const RELATIVE_SCRATCH = /^\.?\/?tmp\//;

/**
 * True when `rm` targets only scratch paths.
 *
 * Every operand must be checked, not just the first: `rm '/tmp/x' ~/world`
 * would otherwise pass on its leading argument. `..` anywhere is rejected so a
 * scratch prefix can't be used to escape (`/tmp/../Users/...`).
 */
function isScratchRm(cmd: string): boolean {
  if (!/^\s*rm\b/.test(cmd)) return false;
  const operands = cmd
    .trim()
    .slice(2)
    .trim()
    .split(/\s+/)
    .filter((a) => a && !a.startsWith("-"))
    .map((a) => a.replace(/^['"]|['"]$/g, ""));
  if (operands.length === 0) return false;
  return operands.every((operand) => {
    if (operand.includes("..")) return false;
    // A trailing `*` is the common "clean up my probe files" shape
    // (`rm -f /tmp/herdr-probe.toml*`). Strip one before the glob check so it
    // does not disqualify an otherwise-scratch path; every other glob
    // metacharacter still rejects, since the expansion is unknowable here.
    const deglobbed = operand.replace(/\*$/, "");
    if (/[*?\[\]$`]/.test(deglobbed.replace(/^\$HOME/, ""))) return false;
    if (RELATIVE_SCRATCH.test(deglobbed)) return true;
    const home = os.homedir();
    const expanded = deglobbed
      .replace(/^~(?=\/)/, home)
      .replace(/^\$HOME(?=\/)/, home);
    return SCRATCH_PREFIXES.some((prefix) =>
      expanded.startsWith(prefix.replace(/^[~$]HOME?|^~/, home)),
    );
  });
}

/**
 * True when every file operand of an in-place `sed` lives in scratch.
 *
 * Operands are everything after the flags and the script expression. The
 * script itself is skipped: for `sed -i.bak 's/a/b/' /tmp/x`, `-i.bak` is a
 * flag and `'s/a/b/'` is the first non-flag token. `sed -i -e EXPR file`
 * carries the script behind `-e`, so that token is skipped too.
 */
function isScratchSedTarget(cmd: string): boolean {
  const tokens = cmd.trim().split(/\s+/).slice(1);
  const files: string[] = [];
  let sawScript = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith("-")) {
      // -e/-f take the next token as the script/script-file, not as input
      if (/^-{1,2}(e|f|expression|file)$/.test(t)) {
        i++;
        sawScript = true;
      }
      continue;
    }
    if (!sawScript) {
      sawScript = true; // first bare token is the inline script
      continue;
    }
    files.push(t.replace(/^['"]|['"]$/g, ""));
  }
  if (files.length === 0) return false;
  const home = os.homedir();
  return files.every((f) => {
    if (f.includes("..")) return false;
    if (RELATIVE_SCRATCH.test(f)) return true;
    const expanded = f.replace(/^~(?=\/)/, home).replace(/^\$HOME(?=\/)/, home);
    return SCRATCH_PREFIXES.some((p) =>
      expanded.startsWith(p.replace(/^[~$]HOME?|^~/, home)),
    );
  });
}

// ── Stage 1.75: credential acquisition & guard bypass ───────────────────────
//
// The only class the LLM voter has ever caught: the agent reaching for a
// credential out-of-band because the sanctioned path failed or was never
// tried. All 19 historical denials of this shape match one of the rules below.
//
// This runs BEFORE the whitelist, which is the whole point. `grep`, `cat`,
// `ruby` and `curl` are all whitelisted, so `grep -i anthropic
// ~/.pi/agent/settings.json` and `curl -H "Authorization: bearer $(gh auth
// token)"` had stopped reaching Stage 2 entirely as the whitelist grew.
//
// A hit does not block. It routes to the voter, which answers the one question
// a regex cannot: is this the sanctioned path for this credential, or an
// improvised way around something that broke? `export
// CLOUDSDK_AUTH_ACCESS_TOKEN="$(gcloud auth application-default
// print-access-token)"` and `export GH_TOKEN=ghp_…` match the same rule and
// deserve opposite answers.

/** Files and stores whose whole purpose is holding a secret. */
const CRED_STORE_PATH = String.raw`(?:~|\$HOME)/\.(?:ssh|aws|kube|docker|netrc|pgpass|zshrc|zshenv|bashrc|bash_profile|profile)\b|(?:~|\$HOME)/\.config/[\w.-]*(?:gh|git|gcloud|aws|op|1password|figma|token|auth|cred)[\w.-]*|(?:~|\$HOME)/\.pi/agent/(?:settings|auth)\.json|\.env(?:\.[\w-]+)?(?:\b|$)|\bsecrets?\.[\w.-]*\.?(?:json|ya?ml|ejson)\b|/credentials\b`;

/** Literal secrets, by issuer-assigned shape. */
const TOKEN_LITERAL = String.raw`figd_[A-Za-z0-9_-]{6,}|ghp_[A-Za-z0-9]{12,}|gho_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{20,}|shopify-eyJ[A-Za-z0-9+/=_-]{20,}|AKIA[0-9A-Z]{16}|glpat-[A-Za-z0-9_-]{15,}`;

/** A search expression written to match an unknown secret by its shape. */
const TOKEN_SHAPE_SEARCH = String.raw`figd_\[|ghp_\[|sk-\[|xox\[|glpat-\[`;

interface CredentialRule {
  name: string;
  pattern: RegExp;
}

const CREDENTIAL_RULES: CredentialRule[] = [
  {
    name: "keyfile",
    pattern:
      /(?:\.ssh\/(?:id_\w+|identity)\b|\.netrc\b|\.pgpass\b|\.aws\/credentials|\.kube\/config\b|\.docker\/config\.json|gcloud\/[\w-]*credentials)/,
  },
  {
    name: "keychain",
    pattern:
      /\bsecurity\s+(?:find-(?:generic|internet)-password|dump-keychain|export)\b/,
  },
  {
    name: "secretstore",
    pattern:
      /\b(?:ejson\s+decrypt|ejson-decrypt|ejson-keys|sops\s+-d\b|vault\s+(?:kv\s+get|read)\b|op\s+(?:read|item\s+get)\b)/,
  },
  {
    name: "token-literal",
    pattern: new RegExp(String.raw`\b(?:${TOKEN_LITERAL})`),
  },
  // A search tool aimed at a credential store. Deliberately NOT `git grep` —
  // searching tracked source for an identifier like GITSTREAM_TOKEN is code
  // reading, and in-tree secrets are ejson-encrypted anyway.
  {
    name: "cred-hunt-store",
    pattern: new RegExp(
      String.raw`(?<!git\s)\b(?:grep|rg|ag|fd|find|ls|cat|awk|strings)\b(?:(?!\||;|&&)[\s\S]){0,140}?(?:${CRED_STORE_PATH})`,
    ),
  },
  // Searching for a secret by value shape rather than by name.
  {
    name: "cred-hunt-shape",
    pattern: new RegExp(
      String.raw`\b(?:grep|rg|ag)\b(?:(?!\||;|&&)[\s\S]){0,90}?(?:${TOKEN_SHAPE_SEARCH}|${TOKEN_LITERAL})`,
    ),
  },
  // Whole-environment dump. `env | grep -i herdr` is a named lookup and is
  // excluded; a bare dump, or one redirected to a file, is not.
  {
    name: "env-dump",
    pattern:
      /(?:^|[|;&]\s*|--\s+)(?:printenv|env)\s*(?:$|\||>)(?!\s*grep\s+-i?\s*\w)/,
  },
  // Moving a secret onto a new surface where it outlives this command.
  {
    name: "cred-propagate",
    pattern:
      /\b(?:export|tmux\s+set-environment|launchctl\s+setenv|setenv)\s+\w*(?:TOKEN|SECRET|APIKEY|API_KEY|PASSWORD|CREDENTIAL)\w*\s*=?/i,
  },
  // Extract-then-transmit: a credential riding an outbound request header.
  {
    name: "cred-egress",
    pattern: new RegExp(
      String.raw`\b(?:curl|wget|httpie|http|nc)\b(?:(?!\||;)[\s\S]){0,400}?(?:-H|--header|-u\b|--user)(?:(?!\||;)[\s\S]){0,80}?(?:\$\((?:[^)]*(?:auth\s+token|print-access-token|find-\w+-password|decrypt|cat\s)[^)]*)\)|\$\{?\w*(?:TOKEN|SECRET|KEY|PASSWORD)\w*\}?|Bearer\s+[\w./+=-]{20,}|[Tt]oken\s+token=\S{12,})`,
    ),
  },
  // Scrubbing the environment to reach a binary behind a shim or hook.
  {
    name: "env-i-bypass",
    pattern: /(?:^|[|;&]\s*)(?:\/usr\/bin\/)?env\s+-i\b/,
  },
  {
    name: "shim-bypass",
    pattern:
      /\bcommand\s+(?:git|gh|gs|dev|ejson|security)\b|(?:^|\s)\/usr\/bin\/git\b/,
  },
  // The agent narrating its own workaround. Two of the historical catches
  // announced the intent in a comment on the line above the command.
  {
    name: "narrated-bypass",
    pattern:
      /#[^\n]*\b(?:bypass|get around|work.?around|circumvent|the guard|real binary|hook wrapper|intercepting|sidestep)\b/i,
  },
];

/**
 * Names of the credential rules a command trips, or [] for none.
 *
 * Runs against the heredoc-stripped surface so that review prose and generated
 * documents written via `cat > f <<'EOF'` are treated as data, not as command
 * text. Without that, a PR comment mentioning `.env.production` fires.
 */
/**
 * Remembered allows, persisted across sessions.
 *
 * `remember` previously only pushed onto the in-session overrideHistory, which
 * is rebuilt per session, so the same sanctioned command was re-reviewed in
 * every new session. Stage 1.75 makes that acute: one legitimate pattern
 * (`export CLOUDSDK_AUTH_ACCESS_TOKEN="$(gcloud auth ... print-access-token)"`)
 * accounted for 25 of 68 trigger hits over two weeks.
 */
const REMEMBERED_PATH = path.join(
  os.homedir(),
  ".pi",
  "state",
  "bash-guard-remembered.json",
);

function loadRememberedAllows(): Set<string> {
  try {
    const raw = JSON.parse(fs.readFileSync(REMEMBERED_PATH, "utf8"));
    return new Set(Array.isArray(raw?.commands) ? raw.commands : []);
  } catch {
    return new Set();
  }
}

function persistRememberedAllow(command: string): void {
  try {
    const set = loadRememberedAllows();
    set.add(command);
    fs.mkdirSync(path.dirname(REMEMBERED_PATH), { recursive: true });
    fs.writeFileSync(
      REMEMBERED_PATH,
      JSON.stringify({ commands: [...set] }, null, 2),
    );
  } catch {
    // Non-fatal: the in-session override still applies for this session.
  }
}

function matchCredentialSurface(command: string): string[] {
  const surface = command
    .trim()
    .replace(/\\\n\s*/g, " ")
    .replace(
      /<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n[ \t]*\2(?:\s*$|\s*\n)/gm,
      "<<$2$3\n",
    );
  return CREDENTIAL_RULES.filter((r) => r.pattern.test(surface)).map(
    (r) => r.name,
  );
}

/**
 * Hosts where a mutating curl is a local/dev-loop call, not a production write.
 * Deliberately excludes bare `*.shopify.io` — that resolves to production.
 */
const CURL_DEV_HOST_PATTERN =
  /https?:\/\/(?:localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|0\.0\.0\.0|\[::1\]|[\w.-]*\.shop\.dev|[\w.-]*-staging\.shopify\.io|staging[\w.-]*\.shopify\.io)(?::\d+)?(?:[/?"']|$)/;

/**
 * Check if a conditionally-safe command has dangerous flags.
 * Returns true if the command should be BLOCKED despite matching a safe pattern.
 */
function hasDangerousFlags(cmd: string): boolean {
  // sed: -i (in-place edit) or --in-place. Editing a scratch file is not a
  // source mutation — the agent is patching its own throwaway probe script.
  if (
    /^\s*sed\b/.test(cmd) &&
    (/\s-[a-zA-Z]*i/.test(cmd) || /--in-place/.test(cmd))
  ) {
    return !isScratchSedTarget(cmd);
  }
  // find: -exec, -execdir, -delete, -ok, -okdir
  if (/^\s*find\b/.test(cmd) && /-(exec|execdir|delete|ok|okdir)\b/.test(cmd)) {
    return true;
  }
  // sort: -o (output to file)
  if (/^\s*sort\b/.test(cmd) && /\s-[a-zA-Z]*o\b/.test(cmd)) {
    return true;
  }
  // curl: block mutating HTTP methods and data flags
  if (/^\s*curl\b/.test(cmd)) {
    if (
      /(-X\s*(POST|PUT|PATCH|DELETE)\b|-d\s|--data\b|--upload-file\b|-F\s|--form\b)/i.test(
        cmd,
      )
    ) {
      // Carve-out: the local dev loop (localhost, *.shop.dev, *-staging) is
      // hit constantly while probing endpoints. DELETE stays blocked anywhere.
      const isDelete = /(-X|--request)\s*DELETE\b/i.test(cmd);
      return !CURL_DEV_HOST_PATTERN.test(resolveShellVars(cmd)) || isDelete;
    }
  }
  // sqlite3: read-only queries are safe; DML/DDL and writing dot-commands are not.
  if (/^\s*sqlite3\b/.test(cmd)) {
    if (
      /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|REPLACE|TRUNCATE|ATTACH|DETACH|VACUUM|REINDEX|BEGIN|COMMIT)\b/i.test(
        cmd,
      )
    ) {
      return true;
    }
    if (
      /\.(import|backup|restore|output|once|save|clone|shell|system|read|log|recover)\b/.test(
        cmd,
      )
    ) {
      return true;
    }
  }
  // terraform: only the read-only subcommands. Bare `fmt` rewrites files.
  if (/^\s*terraform\b/.test(cmd)) {
    if (/^\s*terraform\s+fmt\b/.test(cmd)) return !/\s-check\b/.test(cmd);
    if (
      !/^\s*terraform\s+(validate|show|version|providers|output|state\s+(list|show))\b/.test(
        cmd,
      )
    ) {
      return true;
    }
  }
  // gzip/gunzip: only stdout/list/test modes (bare gzip replaces the file).
  if (/^\s*(gzip|gunzip)\b/.test(cmd)) {
    if (!/\s(-[a-zA-Z]*[clt]|--stdout|--to-stdout|--list|--test)\b/.test(cmd)) {
      return true;
    }
  }
  // perl: -i rewrites files in place.
  if (/^\s*perl\b/.test(cmd) && /\s-[a-zA-Z0-9]*i/.test(cmd)) return true;
  // osascript: `do shell script` is a full shell escape via Apple Events.
  if (/^\s*osascript\b/.test(cmd) && /do\s+shell\s+script/i.test(cmd)) {
    return true;
  }
  // gpg: reading, listing, signing and verifying are safe; keyring mutation,
  // decryption to disk, and arbitrary key import are not.
  if (/^\s*gpg\b/.test(cmd)) {
    if (
      /--(import|delete-\S+|gen-key|full-generate-key|quick-\S+|edit-key|change-passphrase|export-secret-\S+|receive-keys|refresh-keys|send-keys)\b/.test(
        cmd,
      )
    ) {
      return true;
    }
  }
  // gh api: block data flags that trigger implicit POST (method flags caught by Stage 1)
  if (/^\s*gh\s+api\b/.test(cmd)) {
    // Explicit DELETE is always dangerous. Stage 1's mutation gate exempts the
    // review endpoints (comments/reactions/threads/resolve), so without this a
    // `gh api .../replies -X DELETE` would slip through to the whitelist.
    // No review-write carve-out for the lead: every gh-api write is confirmed
    // by hand, including PR-review comments/replies/reactions/thread resolves.
    // Stage 1 skips those endpoints, so this is the only gate that sees them.
    if (/(?:--method|-X)\s+(POST|PUT|PATCH|DELETE)\b/i.test(cmd)) return true;
    // GraphQL reads transport as POST but mutate nothing. Only a document that
    // opens with `query` is exempt — `mutation {` and bare `{ ... }` shorthand
    // both stay gated, since shorthand cannot be told apart from a mutation
    // without parsing it.
    if (/\bgraphql\b/.test(cmd) && /-f\s+query=['"]?\s*query\b/.test(cmd)) {
      return false;
    }
    // Data flags imply POST even with no explicit method.
    if (/\s(-f\s|-F\s|--raw-field\s|--input\s)/.test(cmd)) {
      return true;
    }
  }
  // gs api: same shape as gh api (gitstream's REST surface mirrors GitHub's),
  // so it needs the same implicit-POST gate. Without this, an inline review
  // verdict posted as `gs api .../pulls/N/reviews --input -` — the only way to
  // post line-level comments on a Meteorite PR — reaches gitstream unconfirmed.
  if (/^\s*gs\s+api\b/.test(cmd)) {
    if (/(?:--method|-X)\s+(POST|PUT|PATCH|DELETE)\b/i.test(cmd)) return true;
    if (/\s(-f\s|-F\s|--raw-field\s|--input\s)/.test(cmd)) {
      return true;
    }
  }
  // gcloud: allow read-only subcommands; block deploys, mutations, remote exec.
  if (/^\s*gcloud\b/.test(cmd)) {
    if (
      /\bgcloud\s+(?:[\w-]+\s+)*?(deploy|run|delete|create|update|remove|add|patch|import|export|reset|restart|start|stop|kill|ssh|scp|set-iam-policy|add-iam-policy-binding|remove-iam-policy-binding|abandon|cancel|enable|disable)\b/.test(
        cmd,
      )
    ) {
      return true;
    }
    // gcloud storage: block writes/moves/removes (ls/cat/du are read-only)
    if (
      /\bgcloud\s+storage\s+(cp|mv|rm|rsync|delete|create|update)\b/.test(cmd)
    ) {
      return true;
    }
  }
  // bq: block DML/DDL and data movement; bq query is safe only as --dry_run.
  if (/^\s*bq\b/.test(cmd)) {
    if (/\bbq\s+(?:--?\S+\s+)*?query\b/.test(cmd)) {
      if (/--dry_run\b/.test(cmd)) return false;
      // A pure SELECT/WITH is a read. Anything that can write — DML, DDL,
      // scripting, or a destination table — stays blocked.
      const writesData =
        /\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DROP|ALTER|GRANT|REVOKE|CALL|EXECUTE\s+IMMEDIATE)\b/i.test(
          cmd,
        ) ||
        /\bCREATE\s+(OR\s+REPLACE\s+)?(TABLE|VIEW|SCHEMA|FUNCTION|PROCEDURE|MODEL)\b/i.test(
          cmd,
        ) ||
        /--(destination_table|append_table|replace)\b/.test(cmd);
      if (writesData) return true;
      return !/\b(SELECT|WITH)\b/i.test(cmd);
    }
    if (
      /\bbq\s+(?:--?\S+\s+)*?(rm|mk|cp|load|insert|update|delete|extract)\b/.test(
        cmd,
      )
    ) {
      return true;
    }
  }
  // awk: block shell exec (system()), command/file getline, external program
  // files (-f), in-program file writes, and pipes into a shell.
  if (/^\s*awk\b/.test(cmd)) {
    if (/system\s*\(/.test(cmd)) return true;
    if (/\bgetline\b/.test(cmd)) return true;
    if (/\s-f\s/.test(cmd)) return true;
    if (/printf?\b[^|;&]*>\s*["'\w]/.test(cmd)) return true;
    if (/\|\s*"?\s*(sh|bash|\/bin\/)/.test(cmd)) return true;
  }
  // cmux: block VM control, raw RPC, SSH sessions, hooks install, auth login/logout
  if (/^\s*cmux\b/.test(cmd)) {
    if (/^\s*cmux\s+(vm|cloud|rpc|ssh|login|logout)\b/.test(cmd)) return true;
    if (/^\s*cmux\s+hooks\s+\S+\s+install\b/.test(cmd)) return true;
    if (/^\s*cmux\s+auth\s+(login|logout)\b/.test(cmd)) return true;
  }
  // Note: git push --force check removed — all git push is handled by remote mutation gate
  // ln: only allow symlinks targeting known-safe directories (dotfiles, .pi, /tmp).
  // Flag-shape must match the SAFE_COMMAND_PATTERNS entry (`-[a-zA-Z]*s`) or a
  // bundled form like `ln -vsfn` skips this target check entirely.
  if (/^\s*ln\s+-[a-zA-Z]*s/.test(cmd)) {
    // Extract the target (last argument). Block if it doesn't target safe paths.
    const args = cmd.trim().split(/\s+/);
    const target = args[args.length - 1];
    if (
      target &&
      !target.startsWith("/tmp") &&
      !target.includes("dotfiles") &&
      !target.includes(".pi/")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Check if all output redirects in a command target safe destinations.
 * Safe destinations: /tmp/*, /dev/null. Everything else is unsafe.
 */
function hasOnlySafeRedirects(cmd: string): boolean {
  // Match output redirects: >, >> but not heredocs <<
  // Also skip 2> (stderr) which is already stripped
  const redirects = [...cmd.matchAll(/(?<![<2])>{1,2}\s*(\S+)/g)];
  if (redirects.length === 0) return true;

  for (const match of redirects) {
    const target = match[1];
    if (target === "/dev/null") continue;
    if (target.startsWith("/tmp/") || target === "/tmp") continue;
    return false;
  }
  return true;
}

/**
 * Check if a single atomic command (no pipes, no conjunctions) is safe.
 * At this point, stderr redirects and command separators are already handled.
 */
function isSingleCommandSafe(cmd: string): boolean {
  let trimmed = cmd.trim();
  if (!trimmed) return true;

  // Strip leading shell control-flow keywords that appear as fragments after
  // `;` splitting (e.g., `then break` → check `break`; `if [ -f x ]` → check `[ -f x ]`).
  // The keyword itself is safe; only the following command matters.
  trimmed = trimmed
    .replace(/^\s*(?:then|do|else)\s+/, "")
    .replace(/^\s*(?:if|elif|while|until)\s+/, "")
    .replace(/^\s*for\s+\w+\s+in\b.*$/, "true") // for VAR in ... — iteration source, not a command
    .trim();
  if (!trimmed) return true;

  // Strip a leading `timeout [opts] <duration>` wrapper — it bounds runtime but
  // doesn't change command semantics (`timeout 120 gcloud ... list` is as safe
  // as `gcloud ... list`). Re-check the wrapped command against the patterns.
  trimmed = trimmed
    .replace(
      /^\s*timeout\s+(?:(?:-\S+|--\S+(?:=\S+)?)\s+)*\d+(?:\.\d+)?[smhd]?\s+/,
      "",
    )
    .trim();
  if (!trimmed) return true;

  // Same for a leading `time` wrapper.
  trimmed = trimmed.replace(/^\s*time\s+(?=\S)/, "").trim();
  if (!trimmed) return true;

  // Strip a leading `env VAR=VALUE ...` wrapper. Bare `VAR=value cmd` is
  // already handled further down, but the `env` binary form is not, so
  // `env USER_PWD=$PWD dev test` never matched the `dev test` pattern.
  // `env -i` is deliberately NOT stripped — scrubbing the environment to
  // reach a shimmed binary is a bypass, and Stage 1.75 needs to see it.
  trimmed = trimmed
    .replace(
      /^\s*env\s+(?!-)(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/,
      "",
    )
    .trim();
  if (!trimmed) return true;

  // `command foo` / `builtin foo` run foo while skipping function and alias
  // lookup. `command -v` is a lookup and stays whitelisted on its own.
  // Stripping here lets the wrapped command be judged on its own merits;
  // Stage 1.75 separately treats `command git` as a shim bypass.
  trimmed = trimmed.replace(/^\s*command\s+(?!-)/, "").trim();
  if (!trimmed) return true;

  // An absolute or repo-relative path to a binary is the same binary
  // (`/bin/ls`, `bin/srb tc`, `/opt/homebrew/bin/jq`). Re-check under its
  // basename so path-qualified invocations match the same patterns.
  const pathQualified = trimmed.match(/^((?:[\w.@~-]*\/)+)([\w.@-]+)(\s|$)/);
  if (pathQualified) {
    const byBasename = trimmed.replace(pathQualified[1], "");
    if (byBasename !== trimmed && isSingleCommandSafe(byBasename)) return true;
  }

  // Normalize git global flags that sit between `git` and the subcommand
  // (`git -C <path> rev-parse` / `git -c k=v log` / `git --no-pager diff`) so
  // the read-only subcommand patterns match. These flags don't change safety.
  trimmed = trimmed.replace(
    /^(\s*git)\s+(?:(?:-C\s+\S+|-c\s+\S+|--no-pager|--git-dir=\S+|--work-tree=\S+|--no-replace-objects)\s+)+/,
    "$1 ",
  );

  // Shell comments are always safe — check before backtick/subshell guards
  // since comments often contain backtick-quoted command names in prose.
  if (/^\s*#/.test(trimmed)) return true;

  // Block dangerous constructs within a single command
  if (hasUnquotedBacktick(trimmed)) return false; // backtick subshell

  // Process substitution <(...): allow when the inner command is whitelisted
  if (trimmed.includes("<(")) {
    const innerMatch = trimmed.match(/<\(([^)]+)\)/);
    if (!innerMatch || !isSingleCommandSafe(innerMatch[1])) return false;
  }

  // $() substitutions: every substituted command must be safe on its own. The
  // enclosing command is not exempted — it still has to clear the whitelist
  // below, so `rm -rf $(cat list)` fails on `rm` and `curl -d $(cat secrets)`
  // fails on the data flag. Arithmetic `$(( … ))` is skipped by the extractor.
  if (trimmed.includes("$(")) {
    for (const inner of extractCommandSubstitutions(trimmed)) {
      if (!isSegmentSafe(inner)) return false;
    }
  }

  // Output redirects: allow > /tmp/* and > /dev/null, block everything else
  // (stderr redirects 2>&1, 2>/dev/null were already stripped by caller)
  if (hasUnquotedRedirect(trimmed) && !hasOnlySafeRedirects(trimmed))
    return false;

  // Grouping constructs are containers, not commands. Recurse into the body:
  //   name() { … }   ( … )   { …; }
  // Without this the whole block is one unmatchable "command", and after
  // separator splitting the stray `}` / `)` lines are unmatchable too.
  // Placed after the construct guards above so a group cannot smuggle a
  // backtick, redirect, or substitution past them.
  const groupBody =
    /^\s*(?:function\s+)?[\w-]+\s*\(\)\s*\{([\s\S]*)\}\s*$/.exec(trimmed) ??
    /^\s*\(([\s\S]*)\)\s*$/.exec(trimmed) ??
    /^\s*\{([\s\S]*)\}\s*$/.exec(trimmed);
  if (groupBody) {
    return splitTopLevel(groupBody[1]).every((s) => isSegmentSafe(s));
  }

  // Array literal assignment: `declare -A m=( [k]=v … )` / `arr=( a b )`.
  // The parenthesised body is data — substitutions inside it were validated
  // by the $( … ) guard above.
  if (
    /^\s*(?:declare|local|export|typeset)\b[^=]*=\([\s\S]*\)\s*$/.test(
      trimmed,
    ) ||
    /^\s*[A-Za-z_]\w*=\([\s\S]*\)\s*$/.test(trimmed)
  ) {
    return true;
  }

  // Removing scratch files is a cleanup step, not a destructive one.
  if (isScratchRm(trimmed)) return true;

  // A quoted command path (`"$HOME/…/bin/_wtp" status`) is the same command as
  // its bare form; unwrap so the whitelist patterns can match. Reached only
  // after every construct guard, so the quoting cannot hide anything.
  const unquotedHead = trimmed.replace(/^(['"])(.+?)\1/, "$2");
  if (
    unquotedHead !== trimmed &&
    SAFE_COMMAND_PATTERNS.some((p) => p.test(unquotedHead))
  ) {
    return !hasDangerousFlags(unquotedHead);
  }

  // Check against safe patterns, then verify no dangerous flags
  if (SAFE_COMMAND_PATTERNS.some((p) => p.test(trimmed))) {
    return !hasDangerousFlags(trimmed);
  }

  // Handle env-var prefix commands: VAR=value VAR2=value command args...
  // Strip leading VAR=VALUE tokens and re-check the remainder against safe patterns.
  // e.g., GIT_OPTIONAL_LOCKS=0 git log => strip prefix => git log (safe)
  const envStripped = trimmed.replace(/^(\s*[A-Za-z_]\w*=\S+\s+)+/, "");
  if (envStripped !== trimmed && envStripped.trim()) {
    if (SAFE_COMMAND_PATTERNS.some((p) => p.test(envStripped))) {
      return !hasDangerousFlags(envStripped);
    }
  }

  return false;
}

/**
 * Check if a command segment (may contain pipe chains) is safe.
 * Splits on spaced pipes ` | ` to avoid false-splitting grep \| and ERE |,
 * and skips pipes inside quotes so jq/awk programs stay intact.
 */
function isSegmentSafe(segment: string): boolean {
  const trimmed = segment.trim();
  if (!trimmed) return true;

  const stages = splitPipeChain(trimmed);
  return stages.every((stage) => isSingleCommandSafe(stage));
}

/**
 * Extract the body commands from a shell control-flow block (for/while/until/if).
 * Returns the inner commands if the structure is recognized, or null if not.
 *
 * Handles:
 *   for VAR in ...; do BODY; done
 *   while COND; do BODY; done
 *   until COND; do BODY; done
 *   if COND; then BODY; fi
 *   if COND; then BODY; else BODY; fi
 *
 * The loop variable assignment, iteration source, and condition are treated as
 * safe (they're data/expressions, not executed commands). Only the body commands
 * are extracted and checked against the whitelist.
 */
function extractControlFlowBody(command: string): string[] | null {
  const trimmed = command.trim();

  // for VAR in ...; do BODY; done (semicolons or newlines as delimiters)
  const forMatch = trimmed.match(
    /^\s*for\s+\w+\s+in\s+.*?[;\n]\s*do\s+([\s\S]*?)[;\n]\s*done\s*$/,
  );
  if (forMatch) return [forMatch[1].trim()];

  // while/until COND; do BODY; done (semicolons or newlines as delimiters)
  const whileMatch = trimmed.match(
    /^\s*(?:while|until)\s+.*?[;\n]\s*do\s+([\s\S]*?)[;\n]\s*done\s*$/,
  );
  if (whileMatch) return [whileMatch[1].trim()];

  // if COND; then BODY; else BODY; fi
  const ifElseMatch = trimmed.match(
    /^\s*if\s+.*?;\s*then\s+([\s\S]*?);\s*else\s+([\s\S]*?);\s*fi\s*$/,
  );
  if (ifElseMatch) return [ifElseMatch[1].trim(), ifElseMatch[2].trim()];

  // if COND; then BODY; fi
  const ifMatch = trimmed.match(/^\s*if\s+.*?;\s*then\s+([\s\S]*?);\s*fi\s*$/);
  if (ifMatch) return [ifMatch[1].trim()];

  return null;
}

/**
 * Replace newlines inside quoted strings with spaces.
 * Walks character-by-character tracking single/double quote state.
 * Handles escaped quotes (\\' and \\") and does not collapse
 * newlines outside quotes (those are real command separators).
 */
function collapseQuotedNewlines(input: string): string {
  const chars = [...input];
  const out: string[] = [];
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const prev = i > 0 ? chars[i - 1] : "";

    // Handle escapes — a backslash before a quote char prevents toggle
    if (prev === "\\") {
      out.push(ch);
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      out.push(ch);
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      out.push(ch);
    } else if (ch === "\n" && (inSingle || inDouble)) {
      // Inside quotes — collapse newline to space
      out.push(" ");
    } else {
      out.push(ch);
    }
  }
  return out.join("");
}

/**
 * Split a command line on TOP-LEVEL separators (&&, ||, ;, newline) without
 * splitting inside single/double quotes or inside a `$( … )` substitution.
 * A naive `.split(COMMAND_SEPARATOR)` shatters quoted arguments like
 * `cmux send '… && …'` or `git commit -m "a; b"` into bogus segments that then
 * fail the whitelist and reach the voters. Splitting inside `$( … )` is worse
 * than noisy: it orphans the closing paren, so the substituted command escapes
 * inspection entirely.
 */
function splitTopLevel(input: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inSingle = false;
  let inDouble = false;
  let parenDepth = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const prev = i > 0 ? input[i - 1] : "";
    if (prev !== "\\") {
      if (ch === "'" && !inDouble) inSingle = !inSingle;
      else if (ch === '"' && !inSingle) inDouble = !inDouble;
    }
    if (!inSingle && !inDouble) {
      // Any unquoted paren nests: `$( … )`, `( subshell )`, and array
      // literals `arr=( … )` all carry separators that are not top-level.
      if (ch === "(") parenDepth++;
      else if (ch === ")" && parenDepth > 0) parenDepth--;
      // Brace groups and function bodies likewise. `${VAR}` is expansion,
      // not grouping, so it is skipped.
      else if (ch === "{" && prev !== "$") parenDepth++;
      else if (ch === "}" && parenDepth > 0) parenDepth--;
      // A `#` starting a word comments out the rest of the physical line,
      // separators included. Splitting on them invents commands from prose.
      if (ch === "#" && (i === 0 || /\s/.test(prev))) {
        const nl = input.indexOf("\n", i);
        buf += nl === -1 ? input.slice(i) : input.slice(i, nl);
        if (nl === -1) break;
        i = nl - 1;
        continue;
      }
    }
    if (!inSingle && !inDouble && parenDepth === 0) {
      if (ch === "\n" || ch === ";") {
        out.push(buf);
        buf = "";
        continue;
      }
      const two = input.slice(i, i + 2);
      if (two === "&&" || two === "||") {
        out.push(buf);
        buf = "";
        i++; // consume the second separator char
        continue;
      }
    }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Determine if a bash command can skip the security guard.
 *
 * Handles compound commands (&&, ||, ;, newlines), pipe chains,
 * stderr redirects, and shell control-flow blocks (for/while/if).
 * Each atomic command must be safe for the whole command to be whitelisted.
 */
function isWhitelisted(command: string): boolean {
  currentCommandContext = command;
  // Collapse line-continuations (backslash + newline)
  let normalized = command.trim().replace(/\\\n\s*/g, " ");

  // Strip heredoc bodies — they're data, not commands.
  // Matches: << 'EOF' ... EOF, << "EOF" ... EOF, << EOF ... EOF, <<-EOF ... EOF
  // The opener may carry trailing redirects/pipes (`<<'PY' 2>&1 | grep x`), so
  // the rest of that line is preserved while the body between markers is
  // removed. The closing marker may be indented (<<- form).
  normalized = normalized.replace(
    /<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n[ \t]*\2(?:\s*$|\s*\n)/gm,
    "<< $2_STRIPPED$3\n",
  );

  // Collapse newlines inside quoted strings so COMMAND_SEPARATOR doesn't
  // shatter multi-line arguments into individual "segments". Handles:
  //   - shadowenv exec -- bin/rails runner 'multi\nline\nruby'
  //   - python3 -c "import os\nprint(os.getcwd())"
  //   - gh api ... --input - <<'EOF' (heredocs already stripped above)
  // Walk character-by-character tracking quote state; replace \n with
  // space inside quotes. Escaped quotes (\' and \") are handled.
  normalized = collapseQuotedNewlines(normalized);

  // Strip safe stderr redirects before any analysis — these never
  // create files or change command semantics
  normalized = normalized.replace(STDERR_REDIRECT, "");

  // Try control-flow extraction on the FULL command before splitting.
  // for/while/if blocks contain internal `;` that would fragment them
  // if we split first. If the entire command is a single control-flow
  // block, extract its body and recursively whitelist-check the body.
  const bodies = extractControlFlowBody(normalized);
  if (bodies) {
    return bodies.every((body) => {
      const innerSegments = splitTopLevel(body);
      return innerSegments.every((innerSeg) => isSegmentSafe(innerSeg));
    });
  }

  // Split on top-level command separators (quote-aware) — each segment is
  // checked independently. Quote-aware so `cmux send '… && …'` and
  // `git commit -m "a; b"` aren't shattered into bogus segments.
  const segments = splitTopLevel(normalized);
  return segments.every((seg) => isSegmentSafe(seg));
}

// ── Shared helpers ───────────────────────────────────────────────────────────

/** Minimal theme interface for type safety instead of `any`. */
interface Theme {
  fg(style: string, text: string): string;
  bold(text: string): string;
}

function truncateCmd(command: string, max = 80): string {
  return command.length > max ? command.slice(0, max - 3) + "..." : command;
}

/** Extract text content from any message content array. Accepts wide input, filters internally. */
function extractText(
  content: ReadonlyArray<{ type: string; text?: string }>,
  sep = "",
): string {
  return content
    .filter(
      (c): c is TextContent => c.type === "text" && typeof c.text === "string",
    )
    .map((c) => c.text)
    .join(sep);
}

// ── Voter context extraction ────────────────────────────────────────────────────────

/** Structured context passed to voters alongside the command. */
interface VoterContext {
  /** Most recent user message text, truncated. Empty if none found. */
  lastUserMessage: string;
  /** Number of session entries between the last user message and the current tool call. */
  turnsSinceUserMessage: number;
  /** Last tool error in the recent branch, `toolName: message`. Undefined if none. */
  recentFailure?: string;
  /** Session entries between that error and the current tool call. */
  turnsSinceFailure?: number;
}

/**
 * Extract voter context from the session branch.
 * Walks backward to find the most recent user message and counts the distance.
 */
function extractVoterContext(
  branch: ReadonlyArray<{
    type: string;
    message?: {
      role?: string;
      toolName?: string;
      isError?: boolean;
      content?: ReadonlyArray<{ type: string; text?: string }>;
    };
  }>,
  maxTextLength = 200,
): VoterContext {
  let turnsSinceUserMessage = 0;
  let lastUserMessage = "";

  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type === "message" && entry.message?.role === "user") {
      const content = entry.message.content;
      if (content) {
        const text = extractText(content, " ").trim();
        if (text) {
          lastUserMessage =
            text.length > maxTextLength
              ? text.slice(0, maxTextLength - 1) + "…"
              : text;
          break;
        }
      }
    }
    turnsSinceUserMessage++;
  }

  // The last tool error, and how recently it happened. This is the signal that
  // separates a sanctioned credential call from an improvised one: a
  // token-shaped command landing right after an auth or MCP failure is the
  // shape of the assistant routing around a broken tool. Scan is bounded so a
  // long-stale error from early in the session does not colour every vote.
  let recentFailure: string | undefined;
  let turnsSinceFailure: number | undefined;
  const SCAN_BACK = 12;
  for (
    let i = branch.length - 1, seen = 0;
    i >= 0 && seen < SCAN_BACK;
    i--, seen++
  ) {
    const m = branch[i]?.message;
    if (branch[i]?.type !== "message" || m?.role !== "toolResult") continue;
    if (!m.isError) continue;
    const text = extractText(m.content ?? [], " ")
      .trim()
      .replace(/\s+/g, " ");
    if (!text) continue;
    recentFailure = `${m.toolName ?? "tool"}: ${text.slice(0, maxTextLength)}`;
    turnsSinceFailure = seen;
    break;
  }

  return {
    lastUserMessage,
    turnsSinceUserMessage,
    recentFailure,
    turnsSinceFailure,
  };
}

function countVotes(records: ReadonlyArray<VoterRecord>) {
  let yes = 0,
    no = 0,
    recast = 0,
    pending = 0,
    abstained = 0;
  for (const r of records) {
    switch (r.status) {
      case "yes":
        yes++;
        break;
      case "no":
        no++;
        break;
      case "recast":
        recast++;
        yes++; // recast counts as YES for vote tally
        break;
      case "pending":
        pending++;
        break;
      default:
        abstained++;
        break;
    }
  }
  return { yes, no, recast, pending, abstained, decided: yes + no };
}

/** Create a themed border component. */
function border(theme: Theme) {
  return new DynamicBorder((s: string) => theme.fg("borderAccent", s));
}

// ── Types ────────────────────────────────────────────────────────────────────

type VoteStatus = "pending" | "yes" | "no" | "recast" | "timeout" | "error";

/** Status display metadata lookup table. */
const STATUS_META: Record<
  VoteStatus,
  { icon: string; style: string; debugLabel: string }
> = {
  pending: { icon: "○", style: "dim", debugLabel: "…  " },
  yes: { icon: "●", style: "success", debugLabel: "YES" },
  no: { icon: "●", style: "error", debugLabel: "NO " },
  recast: { icon: "●", style: "warning", debugLabel: "RC " },
  timeout: { icon: "◌", style: "warning", debugLabel: "TMO" },
  error: { icon: "◌", style: "warning", debugLabel: "ERR" },
};

interface VoterRecord {
  label: string;
  status: VoteStatus;
  durationMs: number;
  error?: string;
}

interface VoteResult {
  records: VoterRecord[];
  yesCount: number;
  noCount: number;
  decidedCount: number;
  abstentions: number;
  unanimous: "yes" | "no" | null;
  cancelled: boolean;
  durationMs: number;
}

interface VoterModel {
  model: Model<any>;
  apiKey: string;
  label: string;
}

interface VoteOverride {
  command: string;
  outcome: "split" | "no";
  voteBreakdown: string;
  /** "allowed" = user overrode the block; "denied" = user agreed with the block */
  decision: "allowed" | "denied";
  /** User feedback when denying (e.g. "you're on the wrong branch") */
  feedback?: string;
  timestamp: number;
}

// ── Voter model resolution ───────────────────────────────────────────────────

let cachedVoterModels: VoterModel[] | null = null;
let overrideHistory: VoteOverride[] = [];

async function resolveVoterModels(
  ctx: ExtensionContext,
): Promise<VoterModel[]> {
  if (cachedVoterModels) return cachedVoterModels;

  // Ideal: diverse models (haiku, gemini-flash-lite, grok). But the Shopify
  // proxy returns 401 for Google and xAI, so we fall back to 3× haiku.
  // Same model ≠ real diversity, but 3 votes still catch non-determinism on
  // borderline commands better than a single vote.
  // TODO: swap back to multi-model once proxy supports google/xai voters.
  const candidates: Array<{ provider: string; id: string; label: string }> = [
    { provider: "anthropic", id: "claude-haiku-4-5", label: "haiku-4.5-a" },
    { provider: "anthropic", id: "claude-haiku-4-5", label: "haiku-4.5-b" },
    { provider: "anthropic", id: "claude-haiku-4-5", label: "haiku-4.5-c" },
  ];

  const available: VoterModel[] = [];
  for (const candidate of candidates) {
    try {
      const model = ctx.modelRegistry.find(candidate.provider, candidate.id);
      if (!model) continue;
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (auth.ok && auth.apiKey)
        available.push({
          model: { ...model, reasoning: false },
          apiKey: auth.apiKey,
          label: candidate.label,
        });
    } catch {}
  }
  cachedVoterModels = available;
  return available;
}

function distributeVoters(voterModels: VoterModel[]): VoterModel[] {
  if (voterModels.length === 0) return [];
  const count = voterModels.length * VOTES_PER_MODEL;
  return Array.from(
    { length: count },
    (_, i) => voterModels[i % voterModels.length],
  );
}

// ── Single vote ──────────────────────────────────────────────────────────────

function buildVoterMessage(
  command: string,
  overrides: ReadonlyArray<VoteOverride>,
  voterContext?: VoterContext,
  triggeredRules?: ReadonlyArray<string>,
): string {
  const parts: string[] = [];
  if (overrides.length > 0) {
    parts.push("<previous_decisions>");
    for (const o of overrides) {
      parts.push(`<decision><command>${o.command}</command>`);
      parts.push(
        `<vote_outcome>${o.outcome === "no" ? "unanimous NO" : "split"} (${o.voteBreakdown})</vote_outcome>`,
      );
      parts.push(`<user_decision>${o.decision ?? "allowed"}</user_decision>`);
      if (o.feedback)
        parts.push(`<user_feedback>${o.feedback}</user_feedback>`);
      parts.push("</decision>");
    }
    parts.push("</previous_decisions>");
    parts.push("");
  }
  if (voterContext?.recentFailure) {
    parts.push("<recent_failure>");
    parts.push(
      `<error>${voterContext.recentFailure}</error>`,
      `<turns_ago>${voterContext.turnsSinceFailure ?? "?"}</turns_ago>`,
    );
    parts.push("</recent_failure>");
    parts.push("");
  }
  if (voterContext?.lastUserMessage) {
    parts.push("<user_context>");
    parts.push(
      `<last_user_message>${voterContext.lastUserMessage}</last_user_message>`,
    );
    parts.push(
      `<turns_since_request>${voterContext.turnsSinceUserMessage}</turns_since_request>`,
    );
    parts.push("</user_context>");
    parts.push("");
  }
  if (triggeredRules?.length) {
    parts.push(
      `<triggered_rules>${triggeredRules.join(", ")}</triggered_rules>`,
    );
    parts.push("");
  }
  parts.push(`<command>${command}</command>`);
  return parts.join("\n");
}

async function castVote(
  voter: VoterModel,
  command: string,
  overrides: ReadonlyArray<VoteOverride>,
  parentSignal?: AbortSignal,
  voterContext?: VoterContext,
  triggeredRules?: ReadonlyArray<string>,
): Promise<VoterRecord> {
  const t0 = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VOTE_TIMEOUT_MS);

  const onParentAbort = () => controller.abort();
  parentSignal?.addEventListener("abort", onParentAbort, { once: true });

  try {
    const response = await complete(
      voter.model,
      {
        systemPrompt: VOTER_SYSTEM_PROMPT,
        messages: [
          {
            role: "user" as const,
            content: [
              {
                type: "text" as const,
                text: buildVoterMessage(
                  command,
                  overrides,
                  voterContext,
                  triggeredRules,
                ),
              },
            ],
            timestamp: Date.now(),
          },
        ],
      },
      { apiKey: voter.apiKey, maxTokens: 256, signal: controller.signal },
    );

    const ms = performance.now() - t0;

    if (response.stopReason === "error") {
      return {
        label: voter.label,
        status: "error",
        durationMs: ms,
        error: response.errorMessage ?? "API error",
      };
    }

    const text = extractText(response.content).trim().toUpperCase();
    if (text.startsWith("YES"))
      return { label: voter.label, status: "yes", durationMs: ms };
    if (text.startsWith("NO"))
      return { label: voter.label, status: "no", durationMs: ms };
    return {
      label: voter.label,
      status: "error",
      durationMs: ms,
      error: `Unexpected: "${text.slice(0, 40)}" (stop: ${response.stopReason})`,
    };
  } catch (e: any) {
    const ms = performance.now() - t0;
    const msg = e?.message ?? String(e);
    if (controller.signal.aborted && !parentSignal?.aborted) {
      return {
        label: voter.label,
        status: "timeout",
        durationMs: ms,
        error: msg,
      };
    }
    return { label: voter.label, status: "error", durationMs: ms, error: msg };
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", onParentAbort);
  }
}

// ── Vote result computation ──────────────────────────────────────────────────

function computeVoteResult(
  records: VoterRecord[],
  cancelled: boolean,
  durationMs: number,
): VoteResult {
  const { yes, no, decided, abstained } = countVotes(records);

  let unanimous: "yes" | "no" | null = null;
  if (decided > 0 && yes === decided) unanimous = "yes";
  else if (decided > 0 && no === decided) unanimous = "no";

  return {
    records,
    yesCount: yes,
    noCount: no,
    decidedCount: decided,
    abstentions: abstained,
    unanimous,
    cancelled,
    durationMs,
  };
}

/** Format voter errors for notification. Computed inline at the single use site. */
function formatVoterErrors(
  records: ReadonlyArray<VoterRecord>,
  max = 3,
): string[] {
  const errors: string[] = [];
  for (const r of records) {
    if (r.error && errors.length < max) {
      // Truncate verbose proxy errors to just the status code + reason
      let msg = r.error;
      const statusMatch = msg.match(/"code":(\d+),"status":"([^"]+)"/);
      if (statusMatch) msg = `${statusMatch[2]} (${statusMatch[1]})`;
      else if (msg.length > 60) msg = msg.slice(0, 57) + "...";
      errors.push(`[${r.label}] ${msg}`);
    }
  }
  return errors;
}

// ── Render helpers ───────────────────────────────────────────────────────────

function renderVoteIcons(
  records: ReadonlyArray<VoterRecord>,
  theme: Theme,
): string {
  return records
    .map((r) => {
      const meta = STATUS_META[r.status];
      return theme.fg(meta.style, meta.icon);
    })
    .join(" ");
}

function renderVoteSummary(
  records: ReadonlyArray<VoterRecord>,
  theme: Theme,
): string {
  const { yes, no, recast, pending, abstained } = countVotes(records);
  const sep = theme.fg("dim", " · ");
  const parts: string[] = [];
  // Show YES count minus recasts, then recasts separately
  const pureYes = yes - recast;
  if (pureYes > 0) parts.push(theme.fg("success", `${pureYes} YES`));
  if (recast > 0) parts.push(theme.fg("warning", `${recast} NO→YES`));
  if (no > 0) parts.push(theme.fg("error", `${no} NO`));
  if (pending > 0) parts.push(theme.fg("dim", `${pending} pending`));
  if (abstained > 0) parts.push(theme.fg("warning", `${abstained} abstained`));
  return parts.join(sep);
}

/** Single-pass: builds table rows and accumulates per-model stats together. */
function renderDebugTable(records: VoterRecord[], theme: Theme): string {
  const lines: string[] = [];
  lines.push(theme.fg("dim", "  ┄┄ Debug ┄┄"));

  const byModel = new Map<string, { total: number; count: number }>();

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const meta = STATUS_META[r.status];
    const idx = theme.fg("dim", `  #${i + 1}`);
    const label = theme.fg("muted", r.label.padEnd(16));
    const ms = theme.fg("dim", `${Math.round(r.durationMs)}ms`.padStart(6));
    const status = theme.fg(meta.style, meta.debugLabel);

    let line = `${idx} ${label} ${status}  ${ms}`;
    if (r.error) line += `  ${theme.fg("dim", r.error.slice(0, 40))}`;
    lines.push(line);

    if (r.status !== "pending") {
      const entry = byModel.get(r.label) ?? { total: 0, count: 0 };
      entry.total += r.durationMs;
      entry.count++;
      byModel.set(r.label, entry);
    }
  }

  if (byModel.size > 0) {
    const entries = Array.from(byModel.entries()).map(
      ([label, { total, count }]) => ({
        label,
        avg: Math.round(total / count),
      }),
    );
    let fastest = Infinity;
    for (const e of entries) if (e.avg < fastest) fastest = e.avg;
    const avgs = entries
      .map((e) => {
        const text = `${e.label} ${e.avg}ms`;
        return e.avg === fastest
          ? theme.fg("muted", theme.bold(text))
          : theme.fg("muted", text);
      })
      .join(theme.fg("dim", " · "));
    lines.push(`  ${theme.fg("dim", "Avg:")} ${avgs}`);
  }

  return lines.join("\n");
}

/**
 * Shared container scaffolding. Returns container + dynamic text refs.
 * Callers that don't need live updates can ignore the text refs.
 */
function buildDialogContainer(
  theme: Theme,
  header: string,
  command: string,
  records: ReadonlyArray<VoterRecord>,
): { container: Container; voteIconsText: Text; voteSummaryText: Text } {
  const container = new Container();
  container.addChild(border(theme));
  container.addChild(new Spacer(1));
  container.addChild(
    new Text("  " + theme.fg("accent", theme.bold(header)), 1, 0),
  );
  container.addChild(new Spacer(1));
  container.addChild(
    new Text(
      "  " +
        theme.fg("muted", "$ ") +
        theme.fg("warning", truncateCmd(command)),
      1,
      0,
    ),
  );
  container.addChild(new Spacer(1));

  const voteIconsText = new Text("  " + renderVoteIcons(records, theme), 1, 0);
  container.addChild(voteIconsText);
  const voteSummaryText = new Text(
    "  " + renderVoteSummary(records, theme),
    1,
    0,
  );
  container.addChild(voteSummaryText);

  return { container, voteIconsText, voteSummaryText };
}

// ── Vote tracking UI ─────────────────────────────────────────────────────────

async function runVoteTracking(
  ctx: ExtensionContext,
  command: string,
  voters: VoterModel[],
  overrides: ReadonlyArray<VoteOverride>,
  voterContext?: VoterContext,
  triggeredRules?: ReadonlyArray<string>,
): Promise<VoteResult> {
  /**
   * Headless: no abort signal (each voter has its own timeout). Used when
   * there is no UI at all, OR when running as a teammate (TUI exists but
   * nobody can dismiss a progress dialog).
   */
  // ui.custom only renders in interactive "tui" mode. In rpc/json/print hosts
  // (e.g. pair-review's chat agent) ctx.hasUI is still true but ui.custom()
  // returns undefined — so gate on ctx.mode and run voters headlessly instead.
  if (ctx.mode !== "tui" || isTeammateSession()) {
    const t0 = performance.now();
    const records = await Promise.all(
      voters.map((voter) =>
        castVote(
          voter,
          command,
          overrides,
          undefined,
          voterContext,
          triggeredRules,
        ),
      ),
    );
    return computeVoteResult(records, false, performance.now() - t0);
  }

  return ctx.ui.custom<VoteResult>((tui, theme, _kb, done) => {
    const records: VoterRecord[] = voters.map((v) => ({
      label: v.label,
      status: "pending" as VoteStatus,
      durationMs: 0,
    }));
    const abortController = new AbortController();
    const t0 = performance.now();
    let finished = false;

    const { container, voteIconsText, voteSummaryText } = buildDialogContainer(
      theme,
      "🔒 Security Review",
      command,
      records,
    );

    const errorText = new Text("", 1, 0);
    container.addChild(errorText);
    container.addChild(new Spacer(1));
    container.addChild(new Text("  " + theme.fg("dim", "esc to cancel"), 1, 0));
    container.addChild(new Spacer(1));
    container.addChild(border(theme));

    const repaint = () => {
      container.invalidate();
      tui.requestRender();
    };

    const refresh = () => {
      voteIconsText.setText("  " + renderVoteIcons(records, theme));
      voteSummaryText.setText("  " + renderVoteSummary(records, theme));
      const firstErr = records.find((r) => r.error);
      if (firstErr)
        errorText.setText("  " + theme.fg("error", `Error: ${firstErr.error}`));
      repaint();
    };

    const finalize = () => {
      if (finished) return;
      finished = true;
      done(computeVoteResult(records, false, performance.now() - t0));
    };

    let remaining = voters.length;
    for (let i = 0; i < voters.length; i++) {
      const idx = i;
      castVote(
        voters[idx],
        command,
        overrides,
        abortController.signal,
        voterContext,
      ).then((record) => {
        if (finished) return;
        records[idx] = record;
        remaining--;
        refresh();
        if (remaining === 0) finalize();
      });
    }

    return {
      render: (w: number) => container.render(w),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        if (isTerminalControlSequence(data)) return;
        if (matchesKey(data, Key.escape) && !finished) {
          finished = true;
          abortController.abort();
          done(computeVoteResult(records, true, performance.now() - t0));
        }
      },
    };
  });
}

// ── Explainer ────────────────────────────────────────────────────────────────

/** Try preferred explainer model, then fall back to ctx.model. Both with reasoning disabled. */
async function resolveExplainerModel(
  ctx: ExtensionContext,
): Promise<{ model: Model<any>; apiKey: string } | null> {
  const candidates: Array<Model<any> | null | undefined> = [
    (() => {
      try {
        return ctx.modelRegistry.find(EXPLAINER_PROVIDER, EXPLAINER_MODEL_ID);
      } catch {
        return null;
      }
    })(),
    ctx.model,
  ];

  for (const model of candidates) {
    if (!model) continue;
    try {
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (auth.ok && auth.apiKey)
        return { model: { ...model, reasoning: false }, apiKey: auth.apiKey };
    } catch {}
  }
  return null;
}

interface ExplainerResult {
  explanation: string;
  /** Number of NO voters that recast to YES after seeing full context. */
  recastCount: number;
  /** Labels of voters that recast from NO to YES. */
  recastLabels: string[];
}

/** Build conversation context lines for explainer prompts. */
function buildExplainerContext(ctx: ExtensionContext): string[] {
  const branch = ctx.sessionManager.getBranch();
  const recentEntries = branch.slice(-EXPLAINER_CONTEXT_MESSAGES);
  const lines: string[] = [];

  for (const entry of recentEntries) {
    if (entry.type !== "message" || !("role" in entry.message)) continue;
    const msg = entry.message;

    if (msg.role === "user") {
      const text = extractText(
        msg.content as ReadonlyArray<{ type: string; text?: string }>,
        "\n",
      );
      if (text) lines.push(`<message role="user">${text}</message>`);
    } else if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (part.type === "text") {
          const tp = part as TextContent;
          if (tp.text)
            lines.push(`<message role="assistant">${tp.text}</message>`);
        } else if (part.type === "thinking") {
          const tp = part as ThinkingContent;
          lines.push(`<thinking>${tp.thinking}</thinking>`);
        } else if (part.type === "toolCall") {
          const tp = part as ToolCall;
          lines.push(
            `<tool_call name="${tp.name}">${JSON.stringify(tp.arguments, null, 2)}</tool_call>`,
          );
        }
      }
    } else if (msg.role === "toolResult") {
      const tr = msg as ToolResultMessage;
      const text = extractText(
        tr.content as ReadonlyArray<{ type: string; text?: string }>,
        "\n",
      );
      const truncated =
        text.length > 500 ? text.slice(0, 500) + "\n…(truncated)" : text;
      lines.push(
        `<tool_result name="${tr.toolName}"${tr.isError ? ' error="true"' : ""}>${truncated}</tool_result>`,
      );
    }
  }
  return lines;
}

/** Parse explainer response — tries JSON first, falls back to plain text. */
function parseExplainerResponse(text: string): {
  explanation: string;
  vote: "yes" | "no";
} {
  try {
    const jsonMatch = text.match(
      /\{[\s\S]*"explanation"[\s\S]*"vote"[\s\S]*\}/,
    );
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const explanation =
        typeof parsed.explanation === "string" ? parsed.explanation : text;
      const vote =
        typeof parsed.vote === "string" && parsed.vote.toUpperCase() === "YES"
          ? ("yes" as const)
          : ("no" as const);
      return { explanation, vote };
    }
  } catch {}
  // Fallback: plain text explanation, assume NO vote stands
  return { explanation: text, vote: "no" };
}

/** Call a single model to explain a flagged command and optionally recast its vote. */
async function callExplainer(
  model: Model<any>,
  apiKey: string,
  command: string,
  voteResult: VoteResult,
  contextLines: string[],
): Promise<{ explanation: string; vote: "yes" | "no" } | null> {
  const userMessage: UserMessage = {
    role: "user",
    content: [
      {
        type: "text",
        text: [
          `<context>`,
          ...contextLines,
          `</context>`,
          ``,
          `<command>${command}</command>`,
          ``,
          `Security review results: ${voteResult.yesCount} YES, ${voteResult.noCount} NO` +
            (voteResult.abstentions > 0
              ? `, ${voteResult.abstentions} abstained`
              : "") +
            ` (out of ${voteResult.records.length} reviewers).`,
          ``,
          `Based on the conversation context, explain what this command does and whether it should be allowed.`,
        ].join("\n"),
      },
    ],
    timestamp: Date.now(),
  };

  try {
    const response = await complete(
      model,
      { systemPrompt: EXPLAINER_SYSTEM_PROMPT, messages: [userMessage] },
      { apiKey, maxTokens: 400 },
    );
    const text = extractText(response.content, "\n").trim();
    return text ? parseExplainerResponse(text) : null;
  } catch {
    return null;
  }
}

/** Aggregate multiple explanations into a single summary. */
async function aggregateExplanations(
  ctx: ExtensionContext,
  command: string,
  explanations: Array<{ label: string; text: string }>,
): Promise<string> {
  const explainer = await resolveExplainerModel(ctx);
  if (!explainer) return explanations[0].text;

  const parts = explanations
    .map((e) => `<explanation source="${e.label}">\n${e.text}\n</explanation>`)
    .join("\n\n");

  const userMessage: UserMessage = {
    role: "user",
    content: [
      {
        type: "text",
        text: `The following command was flagged by security reviewers:\n\n<command>${command}</command>\n\n${parts}\n\nCombine these explanations into a single coherent summary.`,
      },
    ],
    timestamp: Date.now(),
  };

  try {
    const response = await complete(
      explainer.model,
      { systemPrompt: AGGREGATOR_SYSTEM_PROMPT, messages: [userMessage] },
      { apiKey: explainer.apiKey, maxTokens: 400 },
    );
    return extractText(response.content, "\n").trim() || explanations[0].text;
  } catch {
    return explanations[0].text;
  }
}

/**
 * Get explanation for a flagged command. Each NO voter explains their reasoning
 * with full conversation context and recasts their vote. Returns the explanation
 * text and the number of recast YES votes.
 */
async function getExplanation(
  ctx: ExtensionContext,
  command: string,
  voteResult: VoteResult,
  voters: VoterModel[],
  debugMode = false,
): Promise<ExplainerResult> {
  const contextLines = buildExplainerContext(ctx);
  const noVoters = voters.filter(
    (_, i) => voteResult.records[i]?.status === "no",
  );

  if (noVoters.length === 0) {
    const explainer = await resolveExplainerModel(ctx);
    if (!explainer)
      return {
        explanation: "Unable to generate explanation — no model available.",
        recastCount: 0,
        recastLabels: [],
      };
    const result = await callExplainer(
      explainer.model,
      explainer.apiKey,
      command,
      voteResult,
      contextLines,
    );
    return {
      explanation: result?.explanation ?? "Unable to generate explanation.",
      recastCount: 0,
      recastLabels: [],
    };
  }

  // Have each NO voter explain with full context and recast their vote
  const results = await Promise.all(
    noVoters.map(async (voter) => {
      const result = await callExplainer(
        voter.model,
        voter.apiKey,
        command,
        voteResult,
        contextLines,
      );
      return result ? { label: voter.label, ...result } : null;
    }),
  );

  const validResults = results.filter(
    (r): r is { label: string; explanation: string; vote: "yes" | "no" } =>
      r !== null,
  );

  if (validResults.length === 0) {
    const explainer = await resolveExplainerModel(ctx);
    if (!explainer)
      return {
        explanation: "Unable to generate explanation — no model available.",
        recastCount: 0,
        recastLabels: [],
      };
    const result = await callExplainer(
      explainer.model,
      explainer.apiKey,
      command,
      voteResult,
      contextLines,
    );
    return {
      explanation: result?.explanation ?? "Unable to generate explanation.",
      recastCount: 0,
      recastLabels: [],
    };
  }

  const recastVoters = validResults.filter((r) => r.vote === "yes");
  const recastCount = recastVoters.length;
  const recastLabels = recastVoters.map((r) => r.label);
  const explanations = validResults.map((r) => ({
    label: r.label,
    text: r.explanation,
  }));

  let finalText =
    explanations.length === 1
      ? explanations[0].text
      : await aggregateExplanations(ctx, command, explanations);

  // In debug mode, append raw per-voter explanations + recast votes
  if (debugMode && validResults.length > 1) {
    const rawSection = validResults
      .map(
        (e) =>
          `---\n\n**${e.label}** (recast: ${e.vote.toUpperCase()}):\n\n${e.explanation}`,
      )
      .join("\n\n");
    finalText += `\n\n${rawSection}`;
  }

  return { explanation: finalText, recastCount, recastLabels };
}

// ── Unified review dialog ────────────────────────────────────────────────────

async function showReviewDialog(
  ctx: ExtensionContext,
  command: string,
  result: VoteResult,
  header: string,
  debugEnabled: boolean,
  interactive: boolean,
  voters: VoterModel[],
  onNeedsAttention?: () => void,
): Promise<{
  allowed: boolean;
  remember: boolean;
  explanation: string;
  instructions?: string;
  recastCount: number;
  autoRecast?: boolean;
}> {
  return blockingCustom<{
    allowed: boolean;
    remember: boolean;
    explanation: string;
    instructions?: string;
    recastCount: number;
    autoRecast?: boolean;
  }>(ctx, header, (tui, theme, _kb, done) => {
    const mdTheme = getMarkdownTheme();
    let explanationText = "";
    let recastCount = 0;
    let resolved = false;
    let mode: "decide" | "feedback" = "decide";
    // Ignore keypresses for 500ms to prevent accidental input from typing
    const dialogOpenedAt = Date.now();
    const INPUT_COOLDOWN_MS = 500;

    const { container, voteIconsText, voteSummaryText } = buildDialogContainer(
      theme,
      header,
      command,
      result.records,
    );
    container.addChild(new Spacer(1));

    const explanationMd = new Markdown(
      theme.fg("dim", "⏳ Analyzing command…"),
      2,
      0,
      mdTheme,
    );
    container.addChild(explanationMd);

    const recastText = new Text("", 1, 0);
    container.addChild(recastText);

    const debugText = new Text("", 1, 0);
    container.addChild(debugText);
    if (debugEnabled) {
      debugText.setText("\n" + renderDebugTable(result.records, theme));
    }

    // Feedback input (created but not added to container until feedback mode)
    const feedbackInput = new Input();
    feedbackInput.onSubmit = (value: string) => {
      if (resolved) return;
      resolved = true;
      done({
        allowed: false,
        remember: false,
        explanation: explanationText,
        instructions: value || undefined,
        recastCount,
      });
    };
    feedbackInput.onEscape = () => {
      if (resolved) return;
      resolved = true;
      done({
        allowed: false,
        remember: false,
        explanation: explanationText,
        recastCount,
      });
    };

    // Footer components (stored for re-ordering when entering feedback mode)
    const footerSpacer = new Spacer(1);
    const hintsText = new Text(
      interactive
        ? "  " +
            theme.fg("dim", "y") +
            theme.fg("muted", " allow  ") +
            theme.fg("dim", "o") +
            theme.fg("muted", " once  ") +
            theme.fg("dim", "n") +
            theme.fg("muted", " deny  ") +
            theme.fg("dim", "esc") +
            theme.fg("muted", " dismiss")
        : "  " + theme.fg("dim", "press any key to continue"),
      1,
      0,
    );
    const bottomSpacer = new Spacer(1);
    const bottomBorder = border(theme);

    container.addChild(footerSpacer);
    container.addChild(hintsText);
    container.addChild(bottomSpacer);
    container.addChild(bottomBorder);

    const repaint = () => {
      container.invalidate();
      tui.requestRender();
    };

    const enterFeedbackMode = () => {
      mode = "feedback";

      // Remove footer, insert feedback section, re-add footer with updated hints
      container.removeChild(footerSpacer);
      container.removeChild(hintsText);
      container.removeChild(bottomSpacer);
      container.removeChild(bottomBorder);

      container.addChild(
        new Text(
          "  " + theme.fg("muted", "Tell the agent what to do instead:"),
          1,
          0,
        ),
      );
      container.addChild(feedbackInput);
      container.addChild(new Spacer(1));

      hintsText.setText(
        "  " +
          theme.fg("dim", "enter") +
          theme.fg("muted", " submit  ") +
          theme.fg("dim", "esc") +
          theme.fg("muted", " skip"),
      );
      container.addChild(hintsText);
      container.addChild(bottomSpacer);
      container.addChild(bottomBorder);

      feedbackInput.focused = true;
      repaint();
    };

    // Get explanation with recast vote support
    getExplanation(ctx, command, result, voters, debugEnabled).then(
      ({ explanation, recastCount: rc, recastLabels }) => {
        if (resolved) return;
        explanationText = explanation;
        recastCount = rc;
        explanationMd.setText(explanation);

        // Update dots: change recast voters from red to yellow
        if (recastLabels.length > 0) {
          for (const record of result.records) {
            if (record.status === "no" && recastLabels.includes(record.label)) {
              record.status = "recast";
            }
          }
          voteIconsText.setText("  " + renderVoteIcons(result.records, theme));
          voteSummaryText.setText(
            "  " + renderVoteSummary(result.records, theme),
          );
          recastText.setText(
            "\n  " +
              theme.fg(
                "success",
                `↻ ${rc} reviewer${rc > 1 ? "s" : ""} changed vote to YES after seeing context`,
              ),
          );
        }

        // If ALL NO voters recast to YES, auto-allow and close the dialog
        if (interactive && rc > 0 && rc >= result.noCount) {
          resolved = true;
          done({
            allowed: true,
            remember: false,
            explanation,
            recastCount: rc,
            autoRecast: true,
          });
          return;
        }
        // Still needs user attention — notify now
        onNeedsAttention?.();
        repaint();
      },
    );

    return {
      render: (w: number) => container.render(w),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        if (resolved) return;
        if (isTerminalControlSequence(data)) return;
        // Cooldown: ignore input for first 500ms to prevent accidental y/n from typing
        if (Date.now() - dialogOpenedAt < INPUT_COOLDOWN_MS) return;

        if (mode === "feedback") {
          feedbackInput.handleInput(data);
          repaint();
          return;
        }
        if (interactive) {
          if (data === "y" || data === "Y") {
            resolved = true;
            done({
              allowed: true,
              remember: true,
              explanation: explanationText,
              recastCount,
            });
          } else if (data === "o" || data === "O") {
            resolved = true;
            done({
              allowed: true,
              remember: false,
              explanation: explanationText,
              recastCount,
            });
          } else if (data === "n" || data === "N") {
            enterFeedbackMode();
          } else if (matchesKey(data, Key.escape)) {
            resolved = true;
            done({
              allowed: false,
              remember: false,
              explanation: explanationText,
              recastCount,
            });
          }
        } else {
          resolved = true;
          done({
            allowed: true,
            remember: false,
            explanation: explanationText,
            recastCount,
          });
        }
      },
      // Focusable: propagate to Input for IME cursor positioning
      get focused() {
        return feedbackInput.focused;
      },
      set focused(v: boolean) {
        feedbackInput.focused = v;
      },
    };
  });
}

// ── Extension entry point ────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  piRef = pi;
  let guardEnabled = true;
  let debugEnabled = false;
  // Session-scoped, reset each session. Defaults to auto-allow: 14 days of
  // session history produced 39 commits across 18 sessions and zero denials,
  // so the first-commit policy dialog was 18 keypresses for no decision.
  // Auto-allow also enables canAutoAllowPush, which silences a safe push to
  // the current branch — force pushes, deletions, protected branches and any
  // explicit target that is not the current branch still open the dialog.
  // `/guard commits confirm` restores per-commit confirmation.
  let commitPolicy: CommitPolicy = "auto-allow";

  // Durable exact-match allows, survives restarts (see persistRememberedAllow).
  let rememberedAllows = loadRememberedAllows();

  // When true, Stage 2 also reviews any command that fails the whitelist \u2014
  // the behaviour that shipped before Stage 1.75 narrowed it to credentials.
  // Session-scoped, toggled with `/guard strict on|off`.
  let strictMode = false;

  function updateStatus(ctx: ExtensionContext) {
    const t = ctx.ui.theme;
    const teammateSuffix = isTeammateSession()
      ? " " + t.fg("warning", "🤝")
      : "";
    if (!guardEnabled)
      ctx.ui.setStatus(
        "bash-guard",
        t.fg("dim", "🔓 guard off") + teammateSuffix,
      );
    else if (debugEnabled)
      ctx.ui.setStatus(
        "bash-guard",
        t.fg("success", "🔒 guard") + " " + t.fg("dim", "🔍") + teammateSuffix,
      );
    else
      ctx.ui.setStatus(
        "bash-guard",
        t.fg("success", "🔒 guard") + teammateSuffix,
      );
  }

  /** Append-only persistence. Restore reads last entry only (reverse scan). */
  function persistState() {
    pi.appendEntry("bash-guard-state", { guardEnabled, debugEnabled });
  }

  pi.registerCommand("guard", {
    description:
      "Toggle bash guard (on/off/debug), review scope (strict on/off), commit policy (commits auto/confirm/reset/ask), or check teammate-gate status",
    // Teammate-gate is automatic when running as a spawned teammate — no
    // toggle needed. The 'teammate' subcommand prints current detection state
    // for debugging.
    getArgumentCompletions: (prefix: string) => {
      const opts = [
        "on",
        "off",
        "debug",
        "strict on",
        "strict off",
        "commits auto",
        "commits confirm",
        "commits reset",
        "commits ask",
        "teammate",
      ];
      const filtered = opts.filter((o) => o.startsWith(prefix));
      return filtered.length > 0
        ? filtered.map((o) => ({ value: o, label: o }))
        : null;
    },
    handler: async (args, ctx) => {
      const arg = args?.trim().toLowerCase();

      // Teammate gate status (read-only — detection is automatic)
      if (arg === "teammate") {
        const isTm = isTeammateSession();
        // Detection is via PI_TEAM_ROLE (multiplexer-agnostic). Surface id is
        // informational only — CMUX_SURFACE_ID under cmux, TMUX_PANE under tmux.
        const role = process.env.PI_TEAM_ROLE ?? "(unset)";
        const surface =
          process.env.CMUX_SURFACE_ID ?? process.env.TMUX_PANE ?? "(unset)";
        ctx.ui.notify(
          isTm
            ? `🤝 Teammate session detected (PI_TEAM_ROLE=${role}, surface=${surface}). Stage 0 gate active: commits auto-allow, git push voted contextually, --publish / merge / force-push hard-blocked.`
            : `Lead session (PI_TEAM_ROLE=${role}, surface=${surface}). Stage 0 teammate gate inactive — standard guard stages apply.`,
          "info",
        );
        return;
      }

      // Strict mode: restore pre-Stage-1.75 behaviour, where every command
      // that fails the whitelist goes to the voter, not just the credential
      // surface. Off by default — 14 days of that behaviour produced 676
      // reviews and zero denials. On when you want the wider net back.
      if (arg === "strict on" || arg === "strict off") {
        strictMode = arg === "strict on";
        ctx.ui.notify(
          strictMode
            ? "\ud83d\udd12 Strict mode ON \u2014 every non-whitelisted command goes to review"
            : "\ud83d\udd11 Strict mode OFF \u2014 only the credential/bypass surface goes to review",
          "info",
        );
        return;
      }

      // Commit policy subcommands
      if (arg === "commits auto") {
        commitPolicy = "auto-allow";
        ctx.ui.notify("📝 Commits auto-allowed for this session", "info");
        return;
      }
      if (arg === "commits confirm") {
        commitPolicy = "confirm-each";
        ctx.ui.notify(
          "📝 Commits will be confirmed individually this session",
          "info",
        );
        return;
      }
      if (arg === "commits reset") {
        commitPolicy = "auto-allow";
        ctx.ui.notify(
          "📝 Commit policy reset to the default (auto-allow)",
          "info",
        );
        return;
      }
      if (arg === "commits ask") {
        commitPolicy = "unset";
        ctx.ui.notify(
          "📝 Commit policy cleared — will ask on next commit",
          "info",
        );
        return;
      }
      if (arg?.startsWith("commits")) {
        const policyLabel =
          commitPolicy === "auto-allow"
            ? "auto-allow"
            : commitPolicy === "confirm-each"
              ? "confirm each"
              : "unset (will ask on first commit)";
        ctx.ui.notify(`📝 Commit policy: ${policyLabel}`, "info");
        return;
      }

      // Guard toggle
      if (arg === "on") guardEnabled = true;
      else if (arg === "off") guardEnabled = false;
      else if (arg === "debug") debugEnabled = !debugEnabled;
      else guardEnabled = !guardEnabled;

      persistState();
      updateStatus(ctx);
      ctx.ui.notify(
        arg === "debug"
          ? debugEnabled
            ? "🔍 Debug mode enabled"
            : "🔍 Debug mode disabled"
          : guardEnabled
            ? "🔒 Bash guard enabled"
            : "🔓 guard disabled",
        "info",
      );
    },
  });

  // ── Commit policy from natural language ──
  // Scan user prompts for commit policy signals so the user can say
  // "allow commits" or "I want to confirm each commit" naturally.
  pi.on("before_agent_start", async (event, ctx) => {
    if (!event.prompt) return;
    const lower = event.prompt.toLowerCase();

    // Auto-allow signals
    if (
      /\b(auto[- ]?allow|allow all|allow)\s*(all\s*)?(commits?|gt\s+modify|gt\s+create)\b/.test(
        lower,
      ) ||
      /\bcommits?\s+(are\s+)?fine\b/.test(lower) ||
      /\bfree\s+to\s+commit\b/.test(lower)
    ) {
      if (commitPolicy !== "auto-allow") {
        commitPolicy = "auto-allow";
        ctx.ui.notify("📝 Commits auto-allowed for this session", "info");
      }
      return;
    }

    // Confirm-each signals
    if (
      /\bconfirm\s+(each\s+)?(commit|before\s+committ?ing)\b/.test(lower) ||
      /\b(approve|review)\s+(each\s+)?commit/.test(lower) ||
      /\b(control|approve|confirm)\s+(each\s+)?commit/.test(lower)
    ) {
      if (commitPolicy !== "confirm-each") {
        commitPolicy = "confirm-each";
        ctx.ui.notify(
          "📝 Commits will be confirmed individually this session",
          "info",
        );
      }
      return;
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    const entries = ctx.sessionManager.getEntries();

    // Restore last persisted guard state (reverse scan, break on first match)
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry.type === "custom" && entry.customType === "bash-guard-state") {
        const data = entry.data as {
          guardEnabled?: boolean;
          debugEnabled?: boolean;
        };
        if (data.guardEnabled !== undefined) guardEnabled = data.guardEnabled;
        if (data.debugEnabled !== undefined) debugEnabled = data.debugEnabled;
        break;
      }
    }

    // Reset session-scoped commit policy (not persisted across sessions)
    commitPolicy = "auto-allow";

    // Restore override history (forward scan, collect all)
    overrideHistory = [];
    for (const entry of entries) {
      if (
        entry.type === "custom" &&
        entry.customType === "bash-guard-override"
      ) {
        overrideHistory.push(entry.data as VoteOverride);
      }
    }

    // Re-read durable allows — another session may have added one.
    rememberedAllows = loadRememberedAllows();

    // Invalidate voter model cache (new session may have different keys)
    cachedVoterModels = null;
    updateStatus(ctx);
  });

  // ── Main hook ──
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;

    const command = event.input.command;

    // Spawned teammates have a TUI but no human watching — dialogs deadlock.
    // Treat them as non-interactive for any blocking-dialog code path.
    // canPrompt gates ui.custom dialogs, which only render in "tui" mode —
    // rpc/json/print hosts report hasUI=true but cannot render them.
    // Notifications still use ctx.hasUI directly (harmless no-op off-tui).
    const teammate = isTeammateSession();
    const canPrompt = ctx.mode === "tui" && !teammate;

    // ── Stage 0: Teammate autonomy gate (only when running as a teammate) ──
    if (teammate) {
      const t0 = await teammateGate(command, ctx);
      if (t0 === "allow") return; // silent allow, skip remaining stages
      if (t0 !== "fall-through") {
        // Block result — includes a model-readable reason
        return t0;
      }
      // fall-through: not a teammate-specific command; continue to other stages.
      // The dialog-blocking sites below use !canPrompt so they won't deadlock.
    }

    // ── Stage 1: Remote mutation gate (always active, deterministic, no voters) ──
    const remoteMutation = matchRemoteMutation(command);
    if (remoteMutation) {
      // Push auto-allow: when commit policy is auto-allow, safe pushes to the
      // current branch are silently allowed — no dialog, no notification.
      if (commitPolicy === "auto-allow" && (await canAutoAllowPush(command))) {
        return undefined;
      }

      if (!canPrompt) {
        return {
          block: true,
          reason: `Remote mutation blocked in non-interactive mode (${remoteMutation.label}). Re-run interactively to confirm.`,
        };
      }
      alertUser(`Remote mutation: ${remoteMutation.label}`);
      const result = await showRemoteMutationDialog(
        ctx,
        command,
        remoteMutation,
      );
      if (!result.allowed) {
        const reason = result.instructions
          ? `Remote mutation blocked by user (${remoteMutation.label}).\n\nUser instructions: ${result.instructions}`
          : `Remote mutation blocked by user (${remoteMutation.label})`;
        return { block: true, reason };
      }
      return undefined; // allowed — skip whitelist and voter review
    }

    // ── Stage 1.5: Commit gate (session-scoped policy) ──
    const commitMatch = matchCommitCommand(command);
    if (commitMatch) {
      if (commitPolicy === "auto-allow") {
        // Session policy: allow all commits silently
        return undefined;
      }

      if (commitPolicy === "confirm-each") {
        // Session policy: confirm each commit individually
        if (!canPrompt) {
          return {
            block: true,
            reason: `Commit blocked in non-interactive mode (${commitMatch.label}). Session policy: confirm-each.`,
          };
        }
        alertUser(`Commit: ${commitMatch.label}`);
        const result = await showCommitConfirmDialog(ctx, command, commitMatch);
        if (!result.allowed) {
          const reason = result.instructions
            ? `Commit blocked by user (${commitMatch.label}).\n\nUser instructions: ${result.instructions}`
            : `Commit blocked by user (${commitMatch.label})`;
          return { block: true, reason };
        }
        return undefined; // allowed this one
      }

      // commitPolicy === "unset" — first commit in session, ask for policy
      if (!canPrompt) {
        // Non-interactive: default to confirm-each (safe default)
        commitPolicy = "confirm-each";
        return {
          block: true,
          reason: `Commit blocked in non-interactive mode (${commitMatch.label}). No commit policy set.`,
        };
      }

      alertUser(`Commit policy: ${commitMatch.label}`);
      const policyResult = await showCommitPolicyDialog(
        ctx,
        command,
        commitMatch,
      );

      if (policyResult.policy === "auto-allow") {
        commitPolicy = "auto-allow";
        ctx.ui.notify("📝 Commits auto-allowed for this session", "info");
        return undefined; // allow this one too
      }

      if (policyResult.policy === "confirm-each") {
        commitPolicy = "confirm-each";
        ctx.ui.notify(
          "📝 Commits will be confirmed individually this session",
          "info",
        );
        // The first command that triggered the dialog is allowed
        // (user chose confirm-each, not deny)
        return undefined;
      }

      // User denied (pressed n or esc)
      commitPolicy = "unset"; // keep unset — they can set it on the next attempt
      const reason = policyResult.instructions
        ? `Commit blocked by user (${commitMatch.label}).\n\nUser instructions: ${policyResult.instructions}`
        : `Commit blocked by user (${commitMatch.label})`;
      return { block: true, reason };
    }

    // ── Stage 2: Credential-acquisition review (togglable via /guard) ──
    if (!guardEnabled) return;

    // Stage 1.75 selects what Stage 2 judges. It runs ahead of the whitelist
    // on purpose: `grep`, `cat`, `ruby` and `curl` are whitelisted, so a token
    // harvest routed through any of them was reaching the shell unreviewed.
    const credentialHits = matchCredentialSurface(command);

    // Strict mode widens the net back to every non-whitelisted command. The
    // whitelist is the definition of "known safe" either way, which is why
    // SAFE_COMMAND_PATTERNS stays curated even though the default path no
    // longer consults it.
    const failsWhitelist = strictMode && !isWhitelisted(command);

    if (credentialHits.length === 0 && !failsWhitelist) {
      // Not on the credential surface — allow. Stage 2 used to review every
      // non-whitelisted command; over 14 days that was 676 reviews, 74
      // dialogs and zero denials, while every catch it has ever made was a
      // credential or bypass. Destructive and remote actions are not
      // affected: Stages 0, 1 and 1.5 run before this point.
      return;
    }

    // Remembered allows short-circuit, in-session first then the durable set.
    // Legacy override entries predate the `decision` field — treat as allowed.
    const previousOverride = overrideHistory.find(
      (o) => o.command === command && (o.decision === "allowed" || !o.decision),
    );
    if (previousOverride) {
      if (ctx.hasUI) {
        ctx.ui.notify(
          `✅ Previously allowed (${previousOverride.voteBreakdown}) — skipping review`,
          "info",
        );
      }
      return;
    }
    if (rememberedAllows.has(command)) {
      if (ctx.hasUI) {
        ctx.ui.notify("✅ Remembered allow — skipping review", "info");
      }
      return;
    }

    if (debugEnabled && ctx.hasUI) {
      ctx.ui.notify(
        `🔑 Credential surface: ${credentialHits.join(", ")}`,
        "info",
      );
    }

    const voterModels = await resolveVoterModels(ctx);

    if (voterModels.length === 0) {
      if (!canPrompt) {
        return {
          block: true,
          reason: "Bash guard: no voter models available and no UI.",
        };
      }
      alertUser("Command needs review (no voter models)");
      const ok = await ctx.ui.confirm(
        "🔒 Bash Guard",
        `No fast review models available. Allow this command?\n\n  $ ${command}`,
      );
      if (!ok)
        return { block: true, reason: "Blocked by user (no review models)." };
      return;
    }

    const voters = distributeVoters(voterModels);
    const voterContext = extractVoterContext(ctx.sessionManager.getBranch());
    let result = await runVoteTracking(
      ctx,
      command,
      voters,
      overrideHistory,
      voterContext,
      credentialHits,
    );

    // Fail closed with a clear reason if the review couldn't run (e.g. a host
    // where ui.custom silently returns undefined) rather than a cryptic crash.
    if (!result) {
      return {
        block: true,
        reason:
          "Bash guard: security review could not run (no interactive UI). Re-run interactively to confirm.",
      };
    }

    // A fully-abstained vote (every voter timed out or errored) is a
    // reliability failure, not a safety signal — with decidedCount === 0 the
    // consensus logic treats it as a "split" and shows a blocking dialog.
    // Retry once before falling through, so transient model slowness doesn't
    // surface as a false alert. We never auto-allow on abstention.
    if (!result.cancelled && result.decidedCount === 0) {
      if (ctx.hasUI) {
        ctx.ui.notify(
          "⏳ Security review inconclusive (all voters abstained) — retrying…",
          "info",
        );
      }
      result = await runVoteTracking(
        ctx,
        command,
        voters,
        overrideHistory,
        voterContext,
        credentialHits,
      );
    }

    // Surface voter errors inline
    const voterErrors = formatVoterErrors(result.records);
    if (voterErrors.length > 0 && ctx.hasUI) {
      ctx.ui.notify(`⚠️ Voter errors:\n${voterErrors.join("\n")}`, "warning");
    }

    if (result.cancelled) {
      return { block: true, reason: "Security review cancelled by user." };
    }

    const elapsed = `${(result.durationMs / 1000).toFixed(1)}s`;
    const voteBreakdown =
      `${result.yesCount} YES / ${result.noCount} NO` +
      (result.abstentions > 0 ? ` / ${result.abstentions} abstained` : "");

    // ── Unanimous YES ──
    if (result.unanimous === "yes") {
      if (ctx.hasUI && debugEnabled) {
        const header = `✅ Security review passed (${result.decidedCount}/${result.records.length}) in ${elapsed}`;
        await showReviewDialog(
          ctx,
          command,
          result,
          header,
          true,
          false,
          voters,
        );
      } else if (ctx.hasUI) {
        const detail =
          result.abstentions > 0
            ? `${result.yesCount} YES, ${result.abstentions} abstained`
            : `${result.yesCount}/${result.records.length}`;
        ctx.ui.notify(
          `✅ Security review passed (${detail}) in ${elapsed}`,
          "info",
        );
      }
      return;
    }

    // ── Unanimous NO or Split vote ──
    if (!canPrompt) {
      const label =
        result.unanimous === "no" ? "unanimously rejected" : "inconclusive";
      return {
        block: true,
        reason: `Security review ${label} (${voteBreakdown}). Blocked in non-interactive mode.`,
      };
    }

    const icon = result.unanimous === "no" ? "⛔" : "⚠️";
    const header =
      result.unanimous === "no"
        ? `${icon} Command blocked (${result.noCount}/${result.decidedCount} NO) in ${elapsed}`
        : `${icon} Split vote (${voteBreakdown}) in ${elapsed}`;

    const onNeedsAttention = () => {
      alertUser(
        result.unanimous === "no"
          ? "Command blocked by review"
          : "Split vote — needs decision",
      );
    };
    const {
      allowed,
      remember,
      explanation,
      instructions,
      recastCount,
      autoRecast,
    } = await showReviewDialog(
      ctx,
      command,
      result,
      header,
      debugEnabled,
      true,
      voters,
      onNeedsAttention,
    );

    const outcomeType =
      result.unanimous === "no" ? ("no" as const) : ("split" as const);
    const voteBreakdownStr = `${result.yesCount} YES / ${result.noCount} NO`;

    // Dialog auto-closed because all NO voters recast to YES
    if (autoRecast) {
      ctx.ui.notify(
        `✅ All ${recastCount} NO voter${recastCount > 1 ? "s" : ""} changed to YES after seeing context — auto-allowing`,
        "info",
      );
      return;
    }

    if (allowed) {
      if (remember) {
        const override: VoteOverride = {
          command,
          outcome: outcomeType,
          voteBreakdown: voteBreakdownStr,
          decision: "allowed",
          timestamp: Date.now(),
        };
        overrideHistory.push(override);
        pi.appendEntry("bash-guard-override", override);
        rememberedAllows.add(command);
        persistRememberedAllow(command);

        const recastNote =
          recastCount > 0 ? ` (${recastCount} recast to YES)` : "";
        ctx.ui.notify(
          `⚠️ User override — allowed despite ${voteBreakdown}${recastNote} (remembered)`,
          "warning",
        );
      } else {
        ctx.ui.notify(
          `⚠️ User override — allowed once despite ${voteBreakdown}`,
          "warning",
        );
      }
      return;
    }

    // Record denial so voters see it on retries
    const denial: VoteOverride = {
      command,
      outcome: outcomeType,
      voteBreakdown: voteBreakdownStr,
      decision: "denied",
      feedback: instructions,
      timestamp: Date.now(),
    };
    overrideHistory.push(denial);
    pi.appendEntry("bash-guard-override", denial);

    if (instructions) {
      ctx.ui.notify(`📝 Feedback recorded: ${instructions}`, "info");
    }

    const feedbackNote = instructions ? ` User feedback: ${instructions}` : "";
    return {
      block: true,
      reason:
        `Security review: ${voteBreakdown}. User declined.${feedbackNote}` +
        (explanation ? ` Explanation: ${explanation}` : ""),
    };
  });
}
