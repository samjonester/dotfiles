/**
 * Retitle — automatically names sessions using a fast LLM.
 *
 * On the first 3 prompts, sends conversation context to Claude Haiku and sets
 * the session name. Two passes per prompt: one at submit time, so a title
 * appears within ~1s instead of after the agent has worked through the whole
 * turn, and one when the turn ends, with the assistant's output in context.
 * Respects manual renames — if the user /name's the session, auto-naming stops.
 *
 * Commands:
 *   /retitle      — re-generate the session name from conversation context
 *   /retitle-all  — backfill names for all unnamed sessions
 *
 * Configuration (env vars):
 *   PI_RETITLE_PROVIDER  — model provider (default: "anthropic")
 *   PI_RETITLE_MODEL     — model ID (default: "claude-haiku-4-5")
 *
 * Based on pascal-de-ladurantaye/pi-agent session-namer, extended with:
 *   - Manual rename detection (won't clobber user-set names)
 *   - /retitle for long conversations with compressed context
 *   - /retitle-all for backfilling existing unnamed sessions
 *   - Proper reset on /new, /resume, /fork
 *   - Configurable model via env vars
 *   - Repo-qualified identifiers (world#2031382, not #2031382)
 */

import { complete } from "@mariozechner/pi-ai";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function sessionTitle(name?: string | null): string {
  const cwd = path.basename(process.cwd());
  return name ? `π - ${name} - ${cwd}` : `π - ${cwd}`;
}

// ── Herdr sidebar title ─────────────────────────────────────────────────────
//
// Herdr renders each sidebar row on one line and truncates the overflow, so
// the built-in terminal_title token shows `π - <first few words>…` and two
// sessions in the same repo look identical. Custom pane tokens are the only
// multi-line escape hatch: report the name pre-wrapped as $task1..$taskN and
// give each token its own row (see personal/herdr/config.toml). The `π - `
// prefix and ` - <cwd>` suffix are dropped — herdr already shows the agent
// and workspace in the same entry.
const HERDR_SOURCE = "pi-retitle";
const HERDR_TITLE_ROWS = 3;
let herdrSeq = Date.now();

/** Usable text width of a sidebar row: configured columns less indent and gutter. */
function herdrRowCols(): number {
  let width = 32;
  try {
    const configPath =
      process.env.HERDR_CONFIG_PATH ||
      path.join(os.homedir(), ".config", "herdr", "config.toml");
    const match = fs
      .readFileSync(configPath, "utf8")
      .match(/^\s*sidebar_width\s*=\s*(\d+)/m);
    if (match) width = Number(match[1]);
  } catch {
    // No config, unreadable, or no explicit width — the default is 26 columns.
  }
  return Math.max(16, Math.min(48, width - 4));
}

function wrapTitle(name: string, cols: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of name.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    // Overflow the last allowed line rather than dropping words; herdr
    // truncates it with an ellipsis.
    if (!line || candidate.length <= cols || lines.length === maxLines - 1) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  return lines;
}

function reportHerdrTitle(name?: string | null): void {
  const paneId = process.env.HERDR_PANE_ID;
  if (process.env.HERDR_ENV !== "1" || !paneId) return;

  const lines = name ? wrapTitle(name, herdrRowCols(), HERDR_TITLE_ROWS) : [];
  const args = [
    "pane",
    "report-metadata",
    paneId,
    "--source",
    HERDR_SOURCE,
    "--seq",
    String(++herdrSeq),
  ];
  for (let i = 0; i < HERDR_TITLE_ROWS; i++) {
    // An empty value clears the token, which collapses its row.
    args.push("--token", `task${i + 1}=${lines[i] ?? ""}`);
  }
  execFile("herdr", args, () => {});
}

// Subagents (`pi --mode json -p`) and RPC teammates are child processes that
// inherit HERDR_PANE_ID from the pane that spawned them, so a title they report
// lands on that pane's sidebar row. They also have no terminal to title.
function ownsTerminal(ctx: ExtensionContext): boolean {
  return ctx.mode === "tui";
}

function setSessionTitle(ctx: ExtensionContext, name?: string | null): void {
  if (!ownsTerminal(ctx)) return;
  ctx.ui.setTitle(sessionTitle(name));
  reportHerdrTitle(name);
}

const PROVIDER = process.env.PI_RETITLE_PROVIDER || "anthropic";
const MODEL_ID = process.env.PI_RETITLE_MODEL || "claude-haiku-4-5";
const MAX_AUTO_PROMPTS = 3;

/** Cap on assistant text fed to the refinement pass — a turn can be enormous. */
const REFINE_ASSISTANT_CHARS = 800;

const SYSTEM_PROMPT = `You are a title generator. You read a conversation between a user and a coding assistant and output a short title.

Rules:
- Output ONLY the title, nothing else
- Start with a single emoji that represents the topic
- 5-10 words maximum (not counting the emoji)
- No quotes, no punctuation at the end
- No markdown, no explanation, no preamble
- Do not respond to or continue the conversation
- Do not answer questions from the conversation
- Your ENTIRE response must be the title and nothing else

Identifier rules (CRITICAL):
- When the conversation references a PR, issue, or branch by number, you MUST include it in the title
- Format every PR/issue number as repo#N — the repository name, then #, then the number (e.g. world#2031382, shop-pi-fy#878, issues-marketing-efficiency#1764)
- The <extracted_identifiers> block gives you each identifier already in repo#N form. Copy it verbatim. Never strip the repo prefix, never invent one that is not listed
- If multiple PRs from the same repo are mentioned, write the repo once and share it (e.g. "world#2032868 #2032869") or say "PRs" if the session is about reviewing a batch
- The identifier is more important than generic descriptions — "Review world#2031382" beats "Review PR with feedback"
- Include 2-3 words identifying the PR's topic alongside the identifier when the conversation provides enough context

Emoji guidelines:
- Pick ONE emoji that captures the primary activity or domain
- Prefer specific over generic (🔐 over ⚙️ for auth work)
- Common mappings: 🐛 bugs/debugging, 🏗️ architecture/refactoring, 🚀 deploy/CI/release, 🎨 UI/styling/design, 📦 packaging/dependencies, 🔐 auth/security, 🧪 testing, 📊 data/analytics, 🧹 cleanup/maintenance, 💬 Slack/comms, 📝 docs/writing, 🔍 investigation/triage, 🛠️ tooling/config, 🌊 workflow/planning

Examples of valid outputs:
🔐 Refactor auth module to use JWT
🐛 Debug webhook timeout in staging
🛠️ Build session memory pi extension
🚀 Set up CI pipeline for monorepo
🎨 Fix button hover states in checkout
📊 Query ad spend metrics from BigQuery
🔍 Review world#681449 throttle tightening
🛠️ Address binks on shop-pi-fy#878 altscreen #869
💬 Batch review world PRs #668312 #44522 #668492
🚀 Check world#2031382 CI after ad-set filter rebase`;

export default function (pi: ExtensionAPI) {
  let promptCount = 0;
  let refinedForPrompt = -1;
  let weSetTheName = false;
  let autoNamingActive = true;

  // Both passes are fire-and-forget, so a slow one can resolve after a later
  // one already set a better name. Tickets keep the newest result on top.
  let nameSeq = 0;
  let appliedSeq = 0;

  function resetState(hasExistingName: boolean) {
    promptCount = 0;
    refinedForPrompt = -1;
    nameSeq = 0;
    appliedSeq = 0;
    weSetTheName = false;
    autoNamingActive = !hasExistingName;
  }

  // --- Lifecycle events: reset state on session transitions ---

  pi.on("session_start", async (_event, ctx) => {
    if (!ownsTerminal(ctx)) return;
    const existingName = pi.getSessionName();
    resetState(!!existingName);
    // Sync terminal title on startup (pi only calls updateTerminalTitle at
    // startup before extensions load, so we may need to re-set it here).
    if (existingName) {
      setSessionTitle(ctx, existingName);
    }
  });

  pi.on("session_switch", async (_event, ctx) => {
    if (!ownsTerminal(ctx)) return;
    // Fires on /new (no name) and /resume (may have name)
    // Use a small delay to let the session load before checking the name
    setTimeout(() => {
      const existingName = pi.getSessionName();
      resetState(!!existingName);
      // Update tab title to reflect the newly loaded session
      setSessionTitle(ctx, existingName);
    }, 50);
  });

  pi.on("session_fork", async (_event, ctx) => {
    if (!ownsTerminal(ctx)) return;
    // Forks start unnamed — auto-name the new branch
    resetState(false);
    setSessionTitle(ctx);
  });

  // --- Auto-naming on prompt submission ---

  // Fires after the user submits, before the agent loop runs. The new prompt is
  // not in the session branch yet, so it is passed in explicitly. Naming here
  // rather than on agent_end means the title lands within ~1s of submitting
  // instead of after the turn's tool calls finish.
  pi.on("before_agent_start", async (event, ctx) => {
    if (!ownsTerminal(ctx)) return;
    if (!autoNamingActive || promptCount >= MAX_AUTO_PROMPTS) return;

    // Check if user manually named since our last rename
    if (!weSetTheName && pi.getSessionName()) {
      // Name exists but we didn't set it — user named it, back off
      autoNamingActive = false;
      return;
    }

    promptCount++;

    const context = buildAutoContext(ctx, event.prompt);
    if (!context.trim()) return;

    // Fire and forget — don't block the agent loop
    generateAndSetName(pi, ctx, context).catch(() => {});
  });

  // Second pass once the turn's work is visible. The submit-time pass only has
  // the prompt, and a vague one ("yes", "continue", "fix it") names nothing —
  // the turn that followed usually names the PR, file, or failure.
  pi.on("agent_end", async (_event, ctx) => {
    if (!ownsTerminal(ctx)) return;
    if (!autoNamingActive || promptCount > MAX_AUTO_PROMPTS) return;

    // pi can run the agent more than once per prompt (auto-retry, compact and
    // retry, queued follow-ups). Refine once per prompt, not once per run.
    if (refinedForPrompt === promptCount) return;

    // Check if user manually named since our last rename
    if (!weSetTheName && pi.getSessionName()) {
      autoNamingActive = false;
      return;
    }

    refinedForPrompt = promptCount;

    const context = buildRefineContext(ctx);
    if (!context.trim()) return;

    generateAndSetName(pi, ctx, context).catch(() => {});
  });

  // --- Commands ---

  pi.registerCommand("retitle", {
    description: "Re-generate session name from conversation context",
    handler: async (_args, ctx) => {
      const context = buildRetitleContext(ctx);
      if (!context.trim()) {
        ctx.ui.notify("No conversation to summarize", "warning");
        return;
      }

      const name = await generateName(ctx, context);
      if (name) {
        pi.setSessionName(name);
        weSetTheName = true;
        setSessionTitle(ctx, name);
        ctx.ui.notify(`Session named: ${name}`, "info");
      } else {
        ctx.ui.notify("Failed to generate name", "warning");
      }
    },
  });

  pi.registerCommand("retitle-all", {
    description: "Backfill names for all unnamed sessions",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Scanning sessions...", "info");

      let sessions;
      try {
        sessions = await SessionManager.listAll();
      } catch (err) {
        ctx.ui.notify(`Failed to list sessions: ${err}`, "error");
        return;
      }

      const unnamed = sessions.filter((s) => !s.name);
      if (unnamed.length === 0) {
        ctx.ui.notify("All sessions already have names!", "info");
        return;
      }

      const proceed = await ctx.ui.confirm(
        `Backfill ${unnamed.length} unnamed sessions?`,
        `Found ${sessions.length} total sessions, ${unnamed.length} without names. This will use ~${unnamed.length} LLM calls (${PROVIDER}/${MODEL_ID}).`,
      );
      if (!proceed) return;

      let named = 0;
      let failed = 0;

      for (const session of unnamed) {
        try {
          const sm = SessionManager.open(session.path);
          const branch = sm.getBranch();
          const context = buildContextFromBranch(branch, false);
          if (!context.trim()) {
            failed++;
            continue;
          }

          const name = await generateName(ctx, context);
          if (name) {
            sm.appendSessionInfo(name);
            named++;
          } else {
            failed++;
          }

          // Rate limit: small delay between calls
          await new Promise((r) => setTimeout(r, 200));
        } catch {
          failed++;
        }
      }

      ctx.ui.notify(
        `Done! Named ${named} sessions${failed > 0 ? `, ${failed} failed/skipped` : ""}`,
        named > 0 ? "info" : "warning",
      );
    },
  });

  // --- Core naming logic ---

  async function generateAndSetName(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    context: string,
  ): Promise<void> {
    const seq = ++nameSeq;
    const name = await generateName(ctx, context);
    if (name) {
      // A later pass with richer context already landed — don't walk it back
      if (seq < appliedSeq) return;
      // Final guard: check one more time that user hasn't manually named
      const currentName = pi.getSessionName();
      if (currentName && !weSetTheName) {
        autoNamingActive = false;
        return;
      }
      pi.setSessionName(name);
      appliedSeq = seq;
      weSetTheName = true;
      // Also update the terminal tab title immediately — pi only calls
      // updateTerminalTitle() on startup and manual /name, not after
      // extension-driven setSessionName calls.
      setSessionTitle(ctx, name);
    }
  }

  async function generateName(
    ctx: ExtensionContext,
    context: string,
  ): Promise<string | null> {
    const model = ctx.modelRegistry.find(PROVIDER, MODEL_ID);
    if (!model) return null;

    // Defensive cast: the exact shape of getApiKeyAndHeaders has changed a few
    // times in pi-mono (0.63+). Casting through `unknown` lets retitle keep
    // working across minor pi releases even if the signature drifts, as long
    // as the runtime result shape remains `{ ok, apiKey?, headers? }`.
    const registry = ctx.modelRegistry as unknown as {
      getApiKeyAndHeaders(
        m: typeof model,
      ): Promise<
        | { ok: true; apiKey?: string; headers?: Record<string, string> }
        | { ok: false; error: string }
      >;
    };
    const auth = await registry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) return null;

    try {
      const ids = extractIdentifiers(context);
      let userPrompt = `<conversation>\n${context}\n</conversation>\n\n`;
      if (ids.length > 0) {
        userPrompt += `<extracted_identifiers>\n${ids.join("\n")}\n</extracted_identifiers>\n\nThe identifiers above were extracted from the conversation and are already repo-qualified. You MUST include the most relevant one(s) in the title, copied verbatim — keep the repo prefix, do not shorten to a bare #N.\n\n`;
      }
      userPrompt += `Generate a short title for this conversation.`;

      const response = await complete(
        model,
        {
          systemPrompt: SYSTEM_PROMPT,
          messages: [
            {
              role: "user" as const,
              content: [
                {
                  type: "text" as const,
                  text: userPrompt,
                },
              ],
              timestamp: Date.now(),
            },
          ],
        },
        { apiKey: auth.apiKey, headers: auth.headers },
      );

      const name = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("")
        .trim()
        .split("\n")[0]
        .trim()
        .replace(/^#+\s*/, "");

      if (name && name.length > 0 && name.length < 100) {
        return name;
      }
    } catch {
      // Silent failure — no name is fine
    }

    return null;
  }
}

// --- Context building ---

/**
 * For auto-naming (prompts 1-3): only user messages, kept lean.
 *
 * `pendingPrompt` is the just-submitted prompt, which before_agent_start fires
 * ahead of — it is not in the branch yet.
 */
function buildAutoContext(
  ctx: ExtensionContext,
  pendingPrompt?: string,
): string {
  const branch = ctx.sessionManager.getBranch();
  const prior = buildContextFromBranch(branch, true);
  const pending = pendingPrompt?.trim();
  if (!pending) return prior;
  return prior ? `${prior}\n\nUser: ${pending}` : `User: ${pending}`;
}

/**
 * For the post-turn refinement pass: the same user-only context plus a bounded
 * head of the latest assistant message, so the pass sees something the
 * submit-time pass could not. Head rather than tail — the answer leads.
 */
function buildRefineContext(ctx: ExtensionContext): string {
  const branch = ctx.sessionManager.getBranch();
  const prior = buildContextFromBranch(branch, true);

  let latest = "";
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i] as any;
    if (entry.type !== "message" || entry.message?.role !== "assistant")
      continue;
    latest = extractText(entry.message.content);
    if (latest) break;
  }
  if (!latest) return prior;

  const head =
    latest.length > REFINE_ASSISTANT_CHARS
      ? `${latest.slice(0, REFINE_ASSISTANT_CHARS)}…`
      : latest;
  return prior ? `${prior}\n\nAssistant: ${head}` : `Assistant: ${head}`;
}

/**
 * For /retitle: compressed context from long conversations.
 * Takes first 2 + last 3 user messages, plus any compaction summary.
 */
function buildRetitleContext(ctx: ExtensionContext): string {
  const branch = ctx.sessionManager.getBranch();
  const entries = branch.filter(
    (e: any) => e.type === "message" && e.message?.role === "user",
  );

  const userTexts: string[] = [];
  for (const entry of entries) {
    const text = extractText((entry as any).message?.content);
    if (text) userTexts.push(text);
  }

  // Find compaction summaries for middle context
  const compactions = branch.filter((e: any) => e.type === "compaction");
  const compactionSummary =
    compactions.length > 0
      ? (compactions[compactions.length - 1] as any).summary
      : null;

  const parts: string[] = [];

  if (userTexts.length <= 5) {
    // Short conversation — use everything
    for (const text of userTexts) {
      parts.push(`User: ${text}`);
    }
  } else {
    // Long conversation — first 2 + compaction + last 3
    parts.push(`User: ${userTexts[0]}`);
    parts.push(`User: ${userTexts[1]}`);

    if (compactionSummary) {
      parts.push(`[Earlier context summary: ${compactionSummary}]`);
    } else {
      parts.push(`[... ${userTexts.length - 5} more exchanges ...]`);
    }

    parts.push(`User: ${userTexts[userTexts.length - 3]}`);
    parts.push(`User: ${userTexts[userTexts.length - 2]}`);
    parts.push(`User: ${userTexts[userTexts.length - 1]}`);
  }

  return parts.join("\n\n");
}

/** Build context from a branch. If userOnly, skip assistant messages. */
function buildContextFromBranch(branch: any[], userOnly: boolean): string {
  const parts: string[] = [];

  for (const entry of branch) {
    if (entry.type !== "message" || !entry.message) continue;
    const { role, content } = entry.message;

    if (role === "user") {
      const text = extractText(content);
      if (text) parts.push(`User: ${text}`);
    } else if (!userOnly && role === "assistant") {
      const text = extractText(content);
      if (text) parts.push(`Assistant: ${text}`);
    }
  }

  return parts.join("\n\n");
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((c: any) => c.type === "text" && c.text)
    .map((c: any) => c.text)
    .join("\n")
    .trim();
}

/** Repo name of the checkout pi is running in, e.g. "world" or "dotfiles". */
let cachedCwdRepo: string | null | undefined;

function cwdRepo(): string | null {
  if (cachedCwdRepo !== undefined) return cachedCwdRepo;
  cachedCwdRepo = null;
  try {
    // Remote, not `--show-toplevel`: every shop/world worktree bottoms out at
    // `.../trees/pool-N/src`, whose basename is "src" for all of them.
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim();
    const m = url.match(/[/:]([\w.-]+?)(?:\.git)?\/?$/);
    if (m) cachedCwdRepo = m[1];
  } catch {
    // Not a git checkout, or git is unavailable — no fallback repo.
  }
  return cachedCwdRepo;
}

const REPO = String.raw`[\w.-]+`;

/**
 * Extract PR and issue numbers from conversation text, each qualified with the
 * repo it belongs to (`world#2031382`), since a bare number is ambiguous across
 * shop/world, shop-pi-fy, and the issues repos.
 *
 * Number-carrying sources (github.com URLs, meteorite URLs, org/repo#N) bind a
 * repo directly. Repo-only mentions (`--repo org/repo`, CI control-center URLs)
 * vote for the repo that bare `#N` references are attributed to. The repo of
 * pi's own checkout is the last resort, so a stray number in a dotfiles session
 * does not get mislabeled once the text names a repo.
 */
function extractIdentifiers(text: string): string[] {
  const ids = new Map<string, string>(); // number -> "repo#N"
  const votes = new Map<string, number>(); // repo -> mentions

  const vote = (repo: string) => votes.set(repo, (votes.get(repo) ?? 0) + 1);
  const bind = (num: string, repo: string) => {
    vote(repo);
    if (!ids.has(num)) ids.set(num, `${repo}#${num}`);
  };

  // --- Sources that carry both a repo and a number ---

  // github.com/org/repo/pull/N and .../issues/N
  for (const m of text.matchAll(
    new RegExp(
      String.raw`github\.com/${REPO}/(${REPO})/(?:pull|issues)/(\d+)`,
      "g",
    ),
  )) {
    bind(m[2], m[1]);
  }

  // meteorite.shopify.io/repos/org/repo/pulls/N
  for (const m of text.matchAll(
    new RegExp(
      String.raw`meteorite\.shopify\.io/repos/${REPO}/(${REPO})/pulls/(\d+)`,
      "g",
    ),
  )) {
    bind(m[2], m[1]);
  }

  // org/repo#N shorthand (2+ digits — the repo prefix rules out false positives)
  for (const m of text.matchAll(
    new RegExp(String.raw`\b${REPO}/(${REPO})#(\d{2,})\b`, "g"),
  )) {
    bind(m[2], m[1]);
  }

  // repo#N shorthand — the form this extension puts in titles, so it comes back
  // in follow-up prompts that quote one
  for (const m of text.matchAll(/\b([a-z][\w.-]*[a-z\d])#(\d{2,})\b/gi)) {
    bind(m[2], m[1]);
  }

  // --- Repo-only signals: vote, but bind no number ---

  // gh --repo org/repo
  for (const m of text.matchAll(
    new RegExp(String.raw`--repo[= ]${REPO}/(${REPO})\b`, "g"),
  )) {
    vote(m[1]);
  }

  // cicd-control-center.shopifysvc.com/ci/org/repo/...
  for (const m of text.matchAll(
    new RegExp(
      String.raw`cicd-control-center\.shopifysvc\.com/ci/${REPO}/(${REPO})\b`,
      "g",
    ),
  )) {
    vote(m[1]);
  }

  // Any other github.com/org/repo mention
  for (const m of text.matchAll(
    new RegExp(String.raw`github\.com/${REPO}/(${REPO})\b`, "g"),
  )) {
    vote(m[1]);
  }

  // --- Bare numbers, attributed to the most-mentioned repo ---

  let dominant: string | null = null;
  let best = 0;
  for (const [repo, count] of votes) {
    if (count > best) {
      best = count;
      dominant = repo;
    }
  }
  const fallback = dominant ?? cwdRepo();
  const qualify = (num: string) =>
    fallback ? `${fallback}#${num}` : `#${num}`;

  // PR #NUMBER / PR NUMBER / PRs #NUMBER (3+ digits to avoid false positives)
  for (const m of text.matchAll(/\bPRs?\s*#?(\d{3,})\b/gi)) {
    if (!ids.has(m[1])) ids.set(m[1], qualify(m[1]));
  }

  // CLI invocations: `gs pr checks 2031382`, `gh pr view 611529`
  for (const m of text.matchAll(/\bpr\s+[a-z-]+\s+#?(\d{3,})\b/gi)) {
    if (!ids.has(m[1])) ids.set(m[1], qualify(m[1]));
  }

  // #NUMBER (3+ digits, not preceded by a word char to avoid hex colors etc)
  for (const m of text.matchAll(/(?<!\w)#(\d{3,})\b/g)) {
    if (!ids.has(m[1])) ids.set(m[1], qualify(m[1]));
  }

  return [...ids.values()];
}
