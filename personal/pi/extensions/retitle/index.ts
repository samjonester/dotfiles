/**
 * Retitle — automatically names sessions using a fast LLM.
 *
 * On the first 3 agent turns, sends conversation context to Claude Haiku
 * and sets the session name. The name refines as more context arrives.
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
 */

import { complete } from "@mariozechner/pi-ai";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import path from "node:path";

function sessionTitle(name?: string | null): string {
  const cwd = path.basename(process.cwd());
  return name ? `π - ${name} - ${cwd}` : `π - ${cwd}`;
}

const PROVIDER = process.env.PI_RETITLE_PROVIDER || "anthropic";
const MODEL_ID = process.env.PI_RETITLE_MODEL || "claude-haiku-4-5";
const MAX_AUTO_TURNS = 3;

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
📊 Query ad spend metrics from BigQuery`;

export default function (pi: ExtensionAPI) {
  let turnCount = 0;
  let weSetTheName = false;
  let autoNamingActive = true;

  function resetState(hasExistingName: boolean) {
    turnCount = 0;
    weSetTheName = false;
    autoNamingActive = !hasExistingName;
  }

  // --- Lifecycle events: reset state on session transitions ---

  pi.on("session_start", async (_event, ctx) => {
    const existingName = pi.getSessionName();
    resetState(!!existingName);
    // Sync terminal title on startup (pi only calls updateTerminalTitle at
    // startup before extensions load, so we may need to re-set it here).
    if (existingName) {
      ctx.ui.setTitle(sessionTitle(existingName));
    }
  });

  pi.on("session_switch", async (_event, ctx) => {
    // Fires on /new (no name) and /resume (may have name)
    // Use a small delay to let the session load before checking the name
    setTimeout(() => {
      const existingName = pi.getSessionName();
      resetState(!!existingName);
      // Update tab title to reflect the newly loaded session
      ctx.ui.setTitle(sessionTitle(existingName));
    }, 50);
  });

  pi.on("session_fork", async (_event, ctx) => {
    // Forks start unnamed — auto-name the new branch
    resetState(false);
    ctx.ui.setTitle(sessionTitle());
  });

  // --- Auto-naming on agent turns ---

  pi.on("agent_end", async (_event, ctx) => {
    turnCount++;
    if (!autoNamingActive || turnCount > MAX_AUTO_TURNS) return;

    // Check if user manually named since our last rename
    if (!weSetTheName && pi.getSessionName()) {
      // Name exists but we didn't set it — user named it, back off
      autoNamingActive = false;
      return;
    }

    const context = buildAutoContext(ctx);
    if (!context.trim()) return;

    // Fire and forget — don't block the agent loop
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
        ctx.ui.setTitle(sessionTitle(name));
        ctx.ui.notify(`Session named: ${name}`, "success");
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
        ctx.ui.notify("All sessions already have names!", "success");
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
        named > 0 ? "success" : "warning",
      );
    },
  });

  // --- Core naming logic ---

  async function generateAndSetName(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    context: string,
  ): Promise<void> {
    const name = await generateName(ctx, context);
    if (name) {
      // Final guard: check one more time that user hasn't manually named
      const currentName = pi.getSessionName();
      if (currentName && !weSetTheName) {
        autoNamingActive = false;
        return;
      }
      pi.setSessionName(name);
      weSetTheName = true;
      // Also update the terminal tab title immediately — pi only calls
      // updateTerminalTitle() on startup and manual /name, not after
      // extension-driven setSessionName calls.
      ctx.ui.setTitle(sessionTitle(name));
    }
  }

  async function generateName(
    ctx: ExtensionContext,
    context: string,
  ): Promise<string | null> {
    const model = ctx.modelRegistry.find(PROVIDER, MODEL_ID);
    if (!model) return null;

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) return null;

    try {
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
                  text: `<conversation>\n${context}\n</conversation>\n\nGenerate a short title for this conversation.`,
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

/** For auto-naming (turns 1-3): only user messages, kept lean. */
function buildAutoContext(ctx: ExtensionContext): string {
  const branch = ctx.sessionManager.getBranch();
  return buildContextFromBranch(branch, true);
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
