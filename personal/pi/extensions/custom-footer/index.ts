/**
 * Custom Footer — status bar with session title, CWD, stats, and extension statuses.
 *
 * Line 0: Session ID (muted) + session title (accent) — always shows ID, title appended when set
 * Line 1: CWD (dim)   branch (muted)   pr-status (from pr-status extension)
 * Line 2: tokens  context  model  thinking — left-aligned, dim
 *         Context color: green <50%, yellow 50-75%, red >75%
 * Line 3: Extension statuses + preset at end
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";

function sanitizeStatusText(text: string): string {
  return text
    .replace(/[\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

export default function (pi: ExtensionAPI) {
  function installFooter(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;

    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsub = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsub,
        invalidate() {},
        render(width: number): string[] {
          const lines: string[] = [];

          // ── Line 0: Session ID + session title ─────────────
          {
            const sessionId = ctx.sessionManager.getSessionId();
            const shortId = sessionId.split("-").pop() || sessionId;
            const sessionName = ctx.sessionManager.getSessionName();
            const parts: string[] = [theme.fg("muted", shortId)];
            if (sessionName) {
              parts.push(theme.fg("accent", sessionName));
            }
            lines.push(
              truncateToWidth(
                parts.join("  "),
                width,
                theme.fg("dim", "..."),
              ),
            );
          }

          // ── Line 1: CWD  branch ────────────────────────────
          let pwd = ctx.sessionManager.getCwd();
          const home = process.env.HOME || process.env.USERPROFILE;
          if (home && pwd.startsWith(home)) {
            pwd = `~${pwd.slice(home.length)}`;
          }

          const pwdParts: string[] = [theme.fg("dim", pwd)];

          const branch = footerData.getGitBranch();
          if (branch) {
            pwdParts.push(theme.fg("muted", "\ue0a0 " + branch));
          }

          // Inline pr-status from the pr-status extension (hide from Line 3)
          const extensionStatuses = footerData.getExtensionStatuses();
          const prStatus = extensionStatuses.get("pr-status");
          if (prStatus) {
            pwdParts.push(sanitizeStatusText(prStatus));
          }

          lines.push(
            truncateToWidth(
              pwdParts.join("  "),
              width,
              theme.fg("dim", "..."),
            ),
          );

          // ── Line 2: stats  context  model  thinking ────────
          let totalInput = 0;
          let totalOutput = 0;
          let totalCost = 0;

          for (const e of ctx.sessionManager.getBranch()) {
            if (e.type === "message" && e.message.role === "assistant") {
              const m = e.message as AssistantMessage;
              totalInput += m.usage.input;
              totalOutput += m.usage.output;
              totalCost += m.usage.cost.total;
            }
          }

          const contextUsage = ctx.getContextUsage();
          const contextWindow =
            contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
          const contextPercentValue = contextUsage?.percent ?? 0;
          const contextPercent =
            contextUsage?.percent != null
              ? contextPercentValue.toFixed(1)
              : "?";

          const segments: string[] = [];

          // Token stats (input, output, cost)
          const tokenParts: string[] = [];
          if (totalInput) tokenParts.push("\u2191" + formatTokens(totalInput));
          if (totalOutput)
            tokenParts.push("\u2193" + formatTokens(totalOutput));

          const usingSubscription = ctx.model
            ? ctx.modelRegistry.isUsingOAuth(ctx.model)
            : false;
          if (totalCost || usingSubscription) {
            const costStr =
              "$" +
              totalCost.toFixed(3) +
              (usingSubscription ? " (sub)" : "");
            tokenParts.push(costStr);
          }

          if (tokenParts.length > 0) {
            segments.push(tokenParts.join(" "));
          }

          // Cache TTL (from claude-cache-ttl extension)
          const cacheTtlStatus = extensionStatuses.get("claude-cache-ttl");
          if (cacheTtlStatus) {
            segments.push(sanitizeStatusText(cacheTtlStatus));
          }

          // Context usage — green <50%, yellow 50-75%, red >75%
          const contextDisplay =
            contextPercent === "?"
              ? "?/" + formatTokens(contextWindow)
              : contextPercent + "%/" + formatTokens(contextWindow);
          segments.push(contextDisplay);

          // Model
          const modelName = ctx.model?.id || "no-model";
          segments.push("\uD83E\uDD16 " + modelName);

          // Thinking level
          if (ctx.model?.reasoning) {
            const thinkingLevel = pi.getThinkingLevel() || "off";
            segments.push("\uD83E\uDDE0 " + thinkingLevel);
          }

          // Color each segment
          const coloredSegments: string[] = [];
          for (const seg of segments) {
            if (seg === contextDisplay) {
              if (contextPercent === "?") {
                coloredSegments.push(theme.fg("dim", seg));
              } else if (contextPercentValue > 75) {
                coloredSegments.push(theme.fg("error", seg));
              } else if (contextPercentValue >= 50) {
                coloredSegments.push(theme.fg("warning", seg));
              } else {
                coloredSegments.push(theme.fg("success", seg));
              }
            } else {
              coloredSegments.push(theme.fg("dim", seg));
            }
          }

          const statsLine = coloredSegments.join(theme.fg("dim", "  "));
          lines.push(
            truncateToWidth(statsLine, width, theme.fg("dim", "...")),
          );

          // ── Line 3: Extension statuses + preset at end ─────
          {
            const hiddenKeys = new Set(["preset", "pr-status", "claude-cache-ttl"]);
            const keyOrder = ["bg-jobs", "bash-guard"];
            const sortedStatuses = Array.from(extensionStatuses.entries())
              .filter(([key]) => !hiddenKeys.has(key))
              .sort(([a], [b]) => {
                const ai = keyOrder.indexOf(a);
                const bi = keyOrder.indexOf(b);
                if (ai !== -1 && bi !== -1) return ai - bi;
                if (ai !== -1) return -1;
                if (bi !== -1) return 1;
                return a.localeCompare(b);
              })
              .map(([, text]) => sanitizeStatusText(text));

            const presetStatus = extensionStatuses.get("preset");
            if (presetStatus) {
              const presetText = stripAnsi(sanitizeStatusText(presetStatus));
              const presetName = presetText.replace(/^preset:/, "");
              sortedStatuses.push("\uD83E\uDDE9 " + (presetName || "code"));
            } else {
              sortedStatuses.push("\uD83E\uDDE9 code");
            }

            const statusLine = sortedStatuses.join(" ");
            lines.push(
              truncateToWidth(statusLine, width, theme.fg("dim", "...")),
            );
          }

          return lines;
        },
      };
    });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    installFooter(ctx);
  });

  pi.on("session_switch", async (_event, ctx) => {
    installFooter(ctx);
  });

  // Re-install footer after each turn so the session title updates
  // as soon as retitle sets the name (retitle fires in agent_end).
  pi.on("agent_end", async (_event, ctx) => {
    installFooter(ctx);
  });
}
