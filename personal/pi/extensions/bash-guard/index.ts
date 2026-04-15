/**
 * Bash Guard — Adversarial Security Review Extension
 *
 * Three-stage interception for bash tool calls:
 *
 * Stage 1 — Remote mutation gate (deterministic, instant):
 *   Pattern-matches commands that modify remote state (git push, gh pr create,
 *   gt submit, etc.). Always prompts with a lightweight y/n dialog — no LLM
 *   voters, no override memory. Deny shows a text input for redirect instructions.
 *   Runs even when the guard is toggled off (instant, zero cost).
 *
 * Stage 1.5 — Commit gate (session-scoped policy):
 *   Pattern-matches commit-like commands (gt create, gt modify, gt absorb,
 *   git commit). On first encounter in a session, shows a policy dialog:
 *     a = auto-allow all commits this session
 *     c = confirm each commit individually (y/n per command)
 *     n = deny (with optional redirect instructions)
 *   Policy persists for the session; resets on new session. Change mid-session
 *   with `/guard commits auto|confirm|reset`.
 *
 * Stage 2 — Adversarial security review (LLM voters):
 *   Runs 3 parallel security reviews using fast models. Based on vote consensus:
 *     Unanimous YES  → auto-allow (notification, or debug dialog)
 *     Unanimous NO   → markdown dialog with explanation + override
 *     Split / mixed  → markdown dialog with explanation + override
 *   Timeouts and errors count as abstentions (ignored in vote tally).
 *   Toggle with `/guard on|off|debug`. Not exposed as a tool — LLM cannot disable it.
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
} from "@mariozechner/pi-tui";
import { execFile } from "child_process";

// ── User alert (macOS notification only) ──────────────────────────────────────

/**
 * Alert the user that bash-guard needs their attention.
 * Uses macOS system notification (visible even when terminal isn't focused).
 *
 * NOTE: We intentionally do NOT write BEL (\x07) to the terminal. BEL causes
 * kitty to activate the window (window_alert_on_bell), which triggers tmux
 * focus events (\x1b[I). Under PTY read splitting, the focus event can arrive
 * as bare \x1b (after the stdin buffer's 10ms timeout), which matchesKey()
 * interprets as ESC — auto-dismissing the guard dialog. The agent then retries
 * the command, firing another alert, creating an infinite bell→focus→ESC→retry
 * loop that manifests as the scrollback "circling" without showing the prompt.
 */
function alertUser(label: string) {
  execFile(
    "osascript",
    ["-e", `display notification "${label}" with title "🔒 Bash Guard"`],
    () => {},
  );
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

// ── Remote mutation patterns (Stage 1 — checked before whitelist/voters) ─────

interface RemoteMutationPattern {
  pattern: RegExp;
  label: string;
}

const REMOTE_MUTATION_PATTERNS: RemoteMutationPattern[] = [
  // git
  { pattern: /\bgit\s+push\b/, label: "git push" },

  // gh pr
  {
    pattern:
      /\bgh\s+pr\s+(edit|comment|create|merge|close|reopen|review|ready|convert-to-draft)\b/,
    label: "gh pr (mutating)",
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

  // gh api (mutating methods only — GET calls pass through)
  {
    pattern: /\bgh\s+api\b.*(--method|-X)\s+(POST|PATCH|PUT|DELETE)\b/i,
    label: "gh api (mutating)",
  },

  // Graphite
  { pattern: /\bgt\s+submit\b/, label: "gt submit" },
  { pattern: /\bgt\s+stack\s+submit\b/, label: "gt stack submit" },

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
  { pattern: /\bgt\s+create\b/, label: "gt create" },
  { pattern: /\bgt\s+modify\b/, label: "gt modify" },
  { pattern: /\bgt\s+absorb\b/, label: "gt absorb" },
  { pattern: /\bgit\s+commit\b/, label: "git commit" },
];

type CommitPolicy = "unset" | "auto-allow" | "confirm-each";

function matchCommitCommand(command: string): CommitPattern | undefined {
  return COMMIT_PATTERNS.find(({ pattern }) => pattern.test(command));
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
  return ctx.ui.custom<{ allowed: boolean; instructions?: string }>(
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
  return ctx.ui.custom<{ policy: CommitPolicy; instructions?: string }>(
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
const VOTE_TIMEOUT_MS = 5000;

const EXPLAINER_PROVIDER = "anthropic";
const EXPLAINER_MODEL_ID = "claude-haiku-4-5";
const EXPLAINER_CONTEXT_MESSAGES = 20;

const VOTER_SYSTEM_PROMPT = `You are a security reviewer for a coding assistant running on a developer's local machine. Your only job is to decide if a bash command is safe.

Context: This is a professional software developer's workstation. The assistant routinely reads project files, session logs, and config files to do its job. Local network requests to dev servers are normal. Python/Node scripts that parse data are normal workflow.

You will receive a bash command inside <command> tags. The message may also include:

- <previous_decisions> showing commands the user previously reviewed. Each decision shows whether the user allowed or denied the command, and may include user feedback explaining their reasoning.
- <user_context> showing what the user recently asked for. This includes the user's last message and how many turns ago it was.

Previous decisions:
- If the user ALLOWED a similar command before, vote YES (unless the new command is substantially more dangerous).
- If the user DENIED a similar or identical command before, vote NO. Pay close attention to any <user_feedback> — it explains WHY the user blocked it. If the current command has the same problem the user flagged, vote NO.
- Only vote NO if the command is substantially more dangerous than what the user has already approved — for example, targeting a different sensitive path, adding network exfiltration, or escalating scope far beyond prior approvals.

User context:
- If <turns_since_request> is low (0–3) and the command clearly fulfills the user's request, weight that heavily toward YES.
- If <turns_since_request> is high (>5), the command may be incidental to the user's request — evaluate on its own merits.
- User context is a SIGNAL, not a veto. A command that is genuinely dangerous (credential exfiltration, destructive operations on system files, privilege escalation) should still be voted NO even if the user asked for it.

Review the command in <command> tags and respond with a single word: YES or NO. Do not explain. Do not add any other text.

YES means: the command is safe to run on a developer's machine.
NO means: the command poses a real security risk (data exfiltration, destructive ops, credential exposure to the network).

For multi-line or compound scripts: evaluate EACH command in the script individually. A script is safe if and only if every command in it is safe. Do not reject a script just because it is long or complex — read it carefully. But if even ONE command in the script is dangerous, vote NO for the whole script.

Vote YES for:
- Reading any local files (project files, session logs, config, dotfiles) for analysis → YES
- Python/Node/shell scripts that read, parse, transform, or print local data → YES
- Multi-line scripts combining grep, find, python3 -c, jq, etc. to process local files (session logs, jsonl, config) — assess each command, but these are normal data-processing workflows → YES
- Reading from /nix/store/ (read-only Nix store), ~/.pi/ (pi config), or session log directories → YES
- Local CLI tools: slack-mcp, pi, bk (Buildkite), gh, gt (Graphite) with read-only subcommands → YES
- Network requests to localhost, 127.0.0.1, or *.shop.dev (local dev servers) → YES
- Shell loops (for/while) composed of safe commands (grep, curl to localhost, gh api reads, git reads) → YES
- Git operations (add, checkout, status, log, diff, branch, stash, rebase, reset) → YES
- Running tests, linters, type checkers, build tools → YES
- Writing to /tmp/ or project tmp/ directories → YES
- Installing declared project dependencies (npm install, bundle install in a project context) → YES
- Copying or moving files within the project or between local project directories → YES

Vote NO for:
- Sending local data to external endpoints (curl/wget POST to non-localhost URLs with file content) → NO
- Deleting files outside the project tree or /tmp/ → NO
- Credential extraction and piping to network commands (cat ~/.ssh/id_rsa | curl ...) → NO
- Privilege escalation (sudo, chmod 777, chown root) → NO
- Installing software from untrusted sources outside a project manifest → NO
- Modifying system services or OS-level configuration → NO
- Irreversible destructive operations (rm -rf /, dd, mkfs) → NO
- A multi-line script where ANY individual command is dangerous (even if the rest are safe) → NO`;

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
//      (spaced split avoids false-splitting grep's \| alternation and ERE |)
//   4. Validate each atomic command against safe patterns + dangerous-flag checks
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
  /^\s*git\s+worktree\s+list\b/,
  /^\s*git\s+stash\s+(list|show)\b/,
  /^\s*git\s+config\s+(--get|--list|-l)\b/,

  // ── GitHub CLI read operations ──
  /^\s*gh\s+pr\s+(view|list|diff|checks|status)\b/,
  /^\s*gh\s+issue\s+(view|list|status)\b/,
  /^\s*gh\s+label\s+list\b/,
  /^\s*gh\s+repo\s+(view|list)\b/,
  /^\s*gh\s+project\s+(view|list|field-list)\b/,
  /^\s*gh\s+auth\s+(status|token|refresh|login|setup-git)\b/,

  // ── Graphite read operations ──
  /^\s*gt\s+(ls|log|status|diff|branch\s+list)\b/,

  // ── Graphite write operations (dev workflow, not destructive) ──
  // Note: gt submit is handled by the remote mutation gate (Stage 1)
  // Note: gt create/modify/absorb are handled by the commit gate (Stage 1.5)
  /^\s*gt\s+(continue|add|restack|checkout|track|sync)\b/,
  /^\s*gt\s+branch\s+(delete|rename)\b/,

  // ── GitHub CLI API (read-only: GET is default, --jq means querying) ──
  /^\s*gh\s+api\b.*--jq\b/,

  // ── Shopify dev tooling ──
  /^\s*(\/opt\/dev\/bin\/dev|dev)\s+(up|server|backend|cd|test|typecheck|style|console|migrate|stop|ps|lint|github|tree)\b/,
  /^\s*shadowenv\s+exec\b/,
  /^\s*quick\s+auth\b/,
  /^\s*_?wtp\b/,
  /^\s*\$\{?WTP_BIN\}?\b/, // variable-expanded WTP invocations
  /^\s*\$\{?HOME\}?\/src\/.*\/wtp\/bin\/_wtp\b/, // full-path WTP invocations
  /^\s*devx\s+(ci|pi|skill|config)\b/,

  // ── File system operations (non-destructive) ──
  /^\s*mkdir\s+-p\b/,
  /^\s*ln\s+-s[f]?\b/,
  /^\s*cp\b/, // conditionally safe: blocked if targeting outside working tree (TODO)
  /^\s*mv\b/, // conditionally safe: blocked if targeting outside working tree (TODO)
  /^\s*chmod\s+\+[rwx]+\b/, // only additive permissions (no 777, no recursive)
  /^\s*rm\s+-f\s+\S*\.lock\b/, // removing stale lock files only

  // ── HTTP read operations ──
  /^\s*curl\b/, // conditionally safe: blocked if -X POST/PUT/DELETE or -d (see hasDangerousFlags)

  // ── Process inspection ──
  /^\s*pgrep\b/,
  /^\s*lsof\b/,

  // ── Node/npm/Python operations ──
  /^\s*npm\s+(info|view|ls|list|outdated|pack\s+--dry-run)\b/,
  /^\s*npx\b/,
  /^\s*pnpm\b/,
  /^\s*node\b/,
  /^\s*python3?\b/,

  // ── MCP tool read operations ──
  /^\s*slack-mcp\s+(get-messages|get-thread|get-unreads|get-channel-sections|get-channel-info|get-status|get-user-profile|get-reactions|get-saved-items|get-file|search|list|test|mcp|auth)\b/,

  // ── Pi and CI tooling ──
  /^\s*pi\s+(tool|session|model|config|extension)\b/,
  /^\s*bk\b/,

  // ── Terminal multiplexer (window management, not arbitrary execution) ──
  /^\s*tmux\s+(new-window|split-window|select-window|list-windows|list-sessions|send-keys|select-pane|resize-pane|kill-pane|kill-window|display-message|set-option)\b/,

  // ── Ruby/Gem read operations ──
  /^\s*gem\s+(contents|list|search|info|spec|which|environment)\b/,

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

/** Splits a full command line into independent segments on &&, ||, ;, or \n. */
const COMMAND_SEPARATOR = /\s*(?:&&|\|\||;|\n)\s*/;

/**
 * Check if a conditionally-safe command has dangerous flags.
 * Returns true if the command should be BLOCKED despite matching a safe pattern.
 */
function hasDangerousFlags(cmd: string): boolean {
  // sed: -i (in-place edit) or --in-place
  if (
    /^\s*sed\b/.test(cmd) &&
    (/\s-[a-zA-Z]*i/.test(cmd) || /--in-place/.test(cmd))
  ) {
    return true;
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
      return true;
    }
  }
  // Note: git push --force check removed — all git push is handled by remote mutation gate
  // ln: only allow symlinks targeting known-safe directories (dotfiles, .pi, /tmp)
  if (/^\s*ln\s+-s/.test(cmd)) {
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

  // Shell comments are always safe — check before backtick/subshell guards
  // since comments often contain backtick-quoted command names in prose.
  if (/^\s*#/.test(trimmed)) return true;

  // Block dangerous constructs within a single command
  if (trimmed.includes("`")) return false; // backtick subshell

  // Process substitution <(...): allow when the inner command is whitelisted
  if (trimmed.includes("<(")) {
    const innerMatch = trimmed.match(/<\(([^)]+)\)/);
    if (!innerMatch || !isSingleCommandSafe(innerMatch[1])) return false;
  }

  // $() subshells: allow in variable assignments, echo/printf args, and
  // commands whose outer verb is a read-only tool (grep, cat, head, etc.).
  if (trimmed.includes("$(")) {
    const isAssignment = /^\s*(?:export\s+)?[A-Za-z_]\w*=/.test(trimmed);
    const isEchoLike = /^\s*(?:echo|printf)\b/.test(trimmed);
    const isSafeOuter =
      /^\s*(?:grep|rg|cat|head|tail|wc|ls|file|stat|diff|basename|dirname)\b/.test(
        trimmed,
      );
    if (!isAssignment && !isEchoLike && !isSafeOuter) return false;
  }

  // Output redirects: allow > /tmp/* and > /dev/null, block everything else
  // (stderr redirects 2>&1, 2>/dev/null were already stripped by caller)
  if (trimmed.includes(">") && !hasOnlySafeRedirects(trimmed)) return false;

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
 * Splits on spaced pipes ` | ` to avoid false-splitting grep \| and ERE |.
 */
function isSegmentSafe(segment: string): boolean {
  const trimmed = segment.trim();
  if (!trimmed) return true;

  // Split pipe chains on spaced pipes only — grep 'foo\|bar' and grep -E 'foo|bar'
  // won't be split because the | inside patterns lacks surrounding spaces
  const stages = trimmed.split(/\s\|\s/);
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
 * Determine if a bash command can skip the security guard.
 *
 * Handles compound commands (&&, ||, ;, newlines), pipe chains,
 * stderr redirects, and shell control-flow blocks (for/while/if).
 * Each atomic command must be safe for the whole command to be whitelisted.
 */
function isWhitelisted(command: string): boolean {
  // Collapse line-continuations (backslash + newline)
  let normalized = command.trim().replace(/\\\n\s*/g, " ");

  // Strip heredoc bodies — they're data, not commands.
  // Matches: << 'EOF' ... EOF, << "EOF" ... EOF, << EOF ... EOF
  // The heredoc marker line stays (it's part of the command), but the body
  // between the markers is removed so it doesn't trigger false positives.
  normalized = normalized.replace(
    /<<\s*['"]?(\w+)['"]?\s*\n[\s\S]*?\n\1(?:\s*$|\s*\n)/gm,
    "<< $1_STRIPPED",
  );

  // Collapse multiline python3/node -c "..." and -c '...' arguments.
  // The \n-based COMMAND_SEPARATOR would otherwise shatter these into
  // fragments that individually fail whitelist matching.
  normalized = normalized.replace(
    /\b(python3?|node)\s+-c\s+(["'])((?:(?!\2)[\s\S])*?)\2/g,
    (_, interpreter, quote) => `${interpreter} -c ${quote}COLLAPSED${quote}`,
  );

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
      const innerSegments = body.split(COMMAND_SEPARATOR);
      return innerSegments.every((innerSeg) => isSegmentSafe(innerSeg));
    });
  }

  // Split on command separators — each segment is checked independently
  const segments = normalized.split(COMMAND_SEPARATOR);
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

  return { lastUserMessage, turnsSinceUserMessage };
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
  parts.push(`<command>${command}</command>`);
  return parts.join("\n");
}

async function castVote(
  voter: VoterModel,
  command: string,
  overrides: ReadonlyArray<VoteOverride>,
  parentSignal?: AbortSignal,
  voterContext?: VoterContext,
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
                text: buildVoterMessage(command, overrides, voterContext),
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
): Promise<VoteResult> {
  /** Headless: no abort signal (each voter has its own timeout). */
  if (!ctx.hasUI) {
    const t0 = performance.now();
    const records = await Promise.all(
      voters.map((voter) =>
        castVote(voter, command, overrides, undefined, voterContext),
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
  return ctx.ui.custom<{
    allowed: boolean;
    remember: boolean;
    explanation: string;
    instructions?: string;
    recastCount: number;
    autoRecast?: boolean;
  }>((tui, theme, _kb, done) => {
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
  let guardEnabled = true;
  let debugEnabled = false;
  let commitPolicy: CommitPolicy = "unset"; // session-scoped, reset each session

  function updateStatus(ctx: ExtensionContext) {
    const t = ctx.ui.theme;
    if (!guardEnabled)
      ctx.ui.setStatus("bash-guard", t.fg("dim", "🔓 guard off"));
    else if (debugEnabled)
      ctx.ui.setStatus(
        "bash-guard",
        t.fg("success", "🔒 guard") + " " + t.fg("dim", "🔍"),
      );
    else ctx.ui.setStatus("bash-guard", t.fg("success", "🔒 guard"));
  }

  /** Append-only persistence. Restore reads last entry only (reverse scan). */
  function persistState() {
    pi.appendEntry("bash-guard-state", { guardEnabled, debugEnabled });
  }

  pi.registerCommand("guard", {
    description:
      "Toggle bash guard (on/off/debug) or commit policy (commits auto/commits confirm/commits reset)",
    getArgumentCompletions: (prefix: string) => {
      const opts = [
        "on",
        "off",
        "debug",
        "commits auto",
        "commits confirm",
        "commits reset",
      ];
      const filtered = opts.filter((o) => o.startsWith(prefix));
      return filtered.length > 0
        ? filtered.map((o) => ({ value: o, label: o }))
        : null;
    },
    handler: async (args, ctx) => {
      const arg = args?.trim().toLowerCase();

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
        commitPolicy = "unset";
        ctx.ui.notify(
          "📝 Commit policy reset — will ask on next commit",
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
    commitPolicy = "unset";

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

    // Invalidate voter model cache (new session may have different keys)
    cachedVoterModels = null;
    updateStatus(ctx);
  });

  // ── Main hook ──
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;

    const command = event.input.command;

    // ── Stage 1: Remote mutation gate (always active, deterministic, no voters) ──
    const remoteMutation = matchRemoteMutation(command);
    if (remoteMutation) {
      if (!ctx.hasUI) {
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
        if (!ctx.hasUI) {
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
      if (!ctx.hasUI) {
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

    // ── Stage 2: Security review (togglable via /guard) ──
    if (!guardEnabled) return;

    if (isWhitelisted(command)) return;

    // Check for previously allowed commands (decision field may be absent on legacy overrides — treat those as allowed)
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

    const voterModels = await resolveVoterModels(ctx);

    if (voterModels.length === 0) {
      if (!ctx.hasUI) {
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
    const result = await runVoteTracking(
      ctx,
      command,
      voters,
      overrideHistory,
      voterContext,
    );

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
    if (!ctx.hasUI) {
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
