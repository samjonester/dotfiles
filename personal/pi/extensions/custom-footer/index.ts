/**
 * Custom Footer — customizes the status bar layout.
 *
 * Line 0 (conditional): Session name (muted) — only if set
 * Line 1: CWD (dim)   branch (muted)
 * Line 2: tokens  context  model  brain thinking — all left-aligned, dim
 * Line 3: Extension statuses + preset at end
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

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
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsub = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsub,
        invalidate() {},
        render(width: number): string[] {
          const lines: string[] = [];

          // ── Line 0 (conditional): Session name ─────────────
          const sessionName = ctx.sessionManager.getSessionName();
          if (sessionName) {
            lines.push(
              truncateToWidth(
                theme.fg("muted", sessionName),
                width,
                theme.fg("dim", "..."),
              ),
            );
          }

          // ── Line 1: CWD  branch ────────────────────────
          let pwd = process.cwd();
          const home = process.env.HOME || process.env.USERPROFILE;
          if (home && pwd.startsWith(home)) {
            pwd = `~${pwd.slice(home.length)}`;
          }

          const pwdParts: string[] = [theme.fg("dim", pwd)];

          const branch = footerData.getGitBranch();
          if (branch) {
            pwdParts.push(theme.fg("muted", "\ue0a0 " + branch));
          }

          const sessionId = ctx.sessionManager.getSessionId();
          if (sessionId) {
            const shortId = sessionId.slice(0, 8);
            pwdParts.push(theme.fg("dim", "\u27D0 " + shortId));
          }

          lines.push(
            truncateToWidth(pwdParts.join("  "), width, theme.fg("dim", "...")),
          );

          // ── Line 2: stats  context  model  thinking ────
          let totalInput = 0;
          let totalOutput = 0;
          let totalCacheRead = 0;
          let totalCacheWrite = 0;
          let totalCost = 0;

          for (const e of ctx.sessionManager.getBranch()) {
            if (e.type === "message" && e.message.role === "assistant") {
              const m = e.message as AssistantMessage;
              totalInput += m.usage.input;
              totalOutput += m.usage.output;
              totalCacheRead += m.usage.cacheRead;
              totalCacheWrite += m.usage.cacheWrite;
              totalCost += m.usage.cost.total;
            }
          }

          const contextUsage = ctx.getContextUsage();
          const contextWindow =
            contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
          const contextPercentValue = contextUsage?.percent ?? 0;
          const contextPercent =
            contextUsage?.percent !== null
              ? contextPercentValue.toFixed(1)
              : "?";

          const segments: string[] = [];

          // Token stats
          const tokenParts: string[] = [];
          if (totalInput) tokenParts.push("\u2191" + formatTokens(totalInput));
          if (totalOutput)
            tokenParts.push("\u2193" + formatTokens(totalOutput));
          if (totalCacheRead)
            tokenParts.push("R" + formatTokens(totalCacheRead));
          if (totalCacheWrite)
            tokenParts.push("W" + formatTokens(totalCacheWrite));

          const usingSubscription = ctx.model
            ? ctx.modelRegistry.isUsingOAuth(ctx.model)
            : false;
          if (totalCost || usingSubscription) {
            const costStr =
              "$" + totalCost.toFixed(3) + (usingSubscription ? " (sub)" : "");
            tokenParts.push(costStr);
          }

          if (tokenParts.length > 0) {
            segments.push(tokenParts.join(" "));
          }

          // Context usage
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

          // Build colored line
          const extensionStatuses = footerData.getExtensionStatuses();

          const coloredSegments: string[] = [];
          for (const seg of segments) {
            if (seg === contextDisplay && contextPercentValue > 90) {
              coloredSegments.push(theme.fg("error", seg));
            } else if (seg === contextDisplay && contextPercentValue > 70) {
              coloredSegments.push(theme.fg("warning", seg));
            } else {
              coloredSegments.push(theme.fg("dim", seg));
            }
          }

          const statsLine = coloredSegments.join(theme.fg("dim", "  "));
          lines.push(truncateToWidth(statsLine, width, theme.fg("dim", "...")));

          // ── Line 3: Extension statuses + preset at end ─────
          if (extensionStatuses.size > 0) {
            const hiddenKeys = new Set(["preset", "voice", "worktree"]);
            // Explicit ordering: listed keys appear first in this order,
            // unlisted keys follow alphabetically after.
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

            // Append preset at the end — only when a preset is actually active.
            // Leads using tool-search don't auto-apply a preset, so no chip is shown.
            const presetStatus = extensionStatuses.get("preset");
            if (presetStatus) {
              const presetText = stripAnsi(sanitizeStatusText(presetStatus));
              const presetName = presetText.replace(/^preset:/, "");
              if (presetName) {
                sortedStatuses.push("\uD83E\uDDE9 " + presetName);
              }
            }

            if (sortedStatuses.length > 0) {
              const statusLine = sortedStatuses.join(" ");
              lines.push(
                truncateToWidth(statusLine, width, theme.fg("dim", "...")),
              );
            }
          }

          return lines;
        },
      };
    });
  });
}
