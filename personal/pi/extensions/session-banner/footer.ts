/**
 * Custom footer for session-banner — mirrors pi-core's interactive footer
 * (modes/interactive/components/footer.js) but skips the `• sessionName`
 * suffix on the pwd line. The session name is rendered in the banner widget
 * above the editor instead, so showing it twice would be redundant.
 *
 * This needs to track pi-core's footer.js if it changes (new stat fields,
 * new context indicators). Keep this file in sync on pi upgrades.
 */

import type { ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component, type TUI } from "@mariozechner/pi-tui";

/**
 * Structural view of pi-core's ReadonlyFooterDataProvider — declared inline
 * to avoid a deep-path import (`pi-coding-agent/dist/core/...`) that would
 * break if pi-core reorganizes its build output. We only rely on the three
 * methods we actually call.
 */
interface FooterDataView {
	getGitBranch(): string | null;
	getExtensionStatuses(): ReadonlyMap<string, string>;
	getAvailableProviderCount(): number;
}

/** Sanitize text for display in a single-line status. */
function sanitizeStatusText(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

/** Format token counts (matches pi-core formatting). */
function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

/**
 * Build a custom footer component. Pass a getter so the factory always reads
 * the *current* extension context (ctx changes on session switch). The
 * pi.setFooter() factory only receives (tui, theme, footerData), so we rely
 * on closure to bring in session/model state.
 */
export function buildFooterFactory(
	getCtx: () => ExtensionContext | null,
): (tui: TUI, theme: Theme, footerData: FooterDataView) => Component & { dispose?(): void } {
	return (_tui, theme, footerData) => ({
		dispose() {},
		render(width: number): string[] {
			const ctx = getCtx();
			if (!ctx) return [""];

			const session = ctx.sessionManager;
			const model = ctx.model;

			// Cumulative usage and current thinkingLevel from all session entries
			// (handles compaction correctly). Scan in entry order so the last
			// thinking_level_change wins.
			let totalInput = 0;
			let totalOutput = 0;
			let totalCacheRead = 0;
			let totalCacheWrite = 0;
			let totalCost = 0;
			let thinkingLevel = "off";
			for (const entry of session.getEntries()) {
				if (entry.type === "message" && entry.message?.role === "assistant") {
					const usage = entry.message.usage;
					if (usage) {
						totalInput += usage.input ?? 0;
						totalOutput += usage.output ?? 0;
						totalCacheRead += usage.cacheRead ?? 0;
						totalCacheWrite += usage.cacheWrite ?? 0;
						totalCost += usage.cost?.total ?? 0;
					}
				} else if (entry.type === "thinking_level_change") {
					thinkingLevel = entry.thinkingLevel;
				}
			}

			// Context usage (handles compaction)
			const contextUsage = ctx.getContextUsage();
			const contextWindow = contextUsage?.contextWindow ?? model?.contextWindow ?? 0;
			const contextPercentValue = contextUsage?.percent ?? 0;
			const contextPercent = contextUsage && contextUsage.percent !== null && contextUsage.percent !== undefined
				? contextPercentValue.toFixed(1)
				: "?";

			// Pwd with home replaced by ~
			let pwd = session.getCwd();
			const home = process.env.HOME || process.env.USERPROFILE;
			if (home && pwd.startsWith(home)) {
				pwd = `~${pwd.slice(home.length)}`;
			}

			// Git branch
			const branch = footerData.getGitBranch();
			if (branch) {
				pwd = `${pwd} (${branch})`;
			}

			// NOTE: pi-core appends ` • ${sessionName}` here. We deliberately skip it —
			// the session-banner widget above the editor already shows the name.

			// Stats line (left side)
			const statsParts: string[] = [];
			if (totalInput) statsParts.push(`↑${formatTokens(totalInput)}`);
			if (totalOutput) statsParts.push(`↓${formatTokens(totalOutput)}`);
			if (totalCacheRead) statsParts.push(`R${formatTokens(totalCacheRead)}`);
			if (totalCacheWrite) statsParts.push(`W${formatTokens(totalCacheWrite)}`);

			const usingSubscription = model ? ctx.modelRegistry.isUsingOAuth(model) : false;
			if (totalCost || usingSubscription) {
				statsParts.push(`$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
			}

			// Context %.
			// Auto-compact toggle state is doubly-inaccessible to extension custom
			// footers:
			//   1. `AgentSession.autoCompactionEnabled` is public (agent-session.d.ts:462)
			//      but NOT exposed via ExtensionContext or ExtensionCommandContext, and
			//      no entry type records toggles in the session log.
			//   2. pi-core's `setAutoCompactEnabled` push (interactive-mode.js:249/1211/3100)
			//      targets `this.footer` (built-in), not `this.customFooter` from
			//      `pi.setFooter()`. So even if we held a reference to a FooterComponent,
			//      we wouldn't get notified when the user toggled auto-compact.
			// We default to `true` (matching pi-core's default) and accept that users
			// who turn auto-compact off won't see the indicator change without a
			// session restart. Upstream fixes: (a) expose getAutoCompactionEnabled on
			// ExtensionContextActions; (b) push setAutoCompactEnabled to customFooter
			// too in interactive-mode.js.
			const autoCompactEnabled = true;
			const autoIndicator = autoCompactEnabled ? " (auto)" : "";
			const contextPercentDisplay = contextPercent === "?"
				? `?/${formatTokens(contextWindow)}${autoIndicator}`
				: `${contextPercent}%/${formatTokens(contextWindow)}${autoIndicator}`;
			let contextPercentStr = contextPercentDisplay;
			if (contextPercentValue > 90) contextPercentStr = theme.fg("error", contextPercentDisplay);
			else if (contextPercentValue > 70) contextPercentStr = theme.fg("warning", contextPercentDisplay);
			statsParts.push(contextPercentStr);

			let statsLeft = statsParts.join(" ");

			// Right side: model + thinking level + provider.
			// thinkingLevel was tracked via the ThinkingLevelChangeEntry scan above.
			const modelName = model?.id || "no-model";
			let rightSideWithoutProvider = modelName;
			if (model?.reasoning) {
				rightSideWithoutProvider = thinkingLevel === "off"
					? `${modelName} • thinking off`
					: `${modelName} • ${thinkingLevel}`;
			}

			let rightSide = rightSideWithoutProvider;
			const providerCount = footerData.getAvailableProviderCount();
			if (providerCount > 1 && model) {
				const withProvider = `(${model.provider}) ${rightSideWithoutProvider}`;
				const minPad = 2;
				if (visibleWidth(statsLeft) + minPad + visibleWidth(withProvider) <= width) {
					rightSide = withProvider;
				}
			}

			// Layout: left padded right
			let statsLeftWidth = visibleWidth(statsLeft);
			if (statsLeftWidth > width) {
				statsLeft = truncateToWidth(statsLeft, width, "...");
				statsLeftWidth = visibleWidth(statsLeft);
			}
			const minPadding = 2;
			const rightSideWidth = visibleWidth(rightSide);
			const totalNeeded = statsLeftWidth + minPadding + rightSideWidth;

			let statsLine: string;
			if (totalNeeded <= width) {
				const padding = " ".repeat(width - statsLeftWidth - rightSideWidth);
				statsLine = statsLeft + padding + rightSide;
			} else {
				const availableForRight = width - statsLeftWidth - minPadding;
				if (availableForRight > 0) {
					const truncatedRight = truncateToWidth(rightSide, availableForRight, "");
					const truncatedRightWidth = visibleWidth(truncatedRight);
					const padding = " ".repeat(Math.max(0, width - statsLeftWidth - truncatedRightWidth));
					statsLine = statsLeft + padding + truncatedRight;
				} else {
					statsLine = statsLeft;
				}
			}

			// Apply dim styling
			const dimStatsLeft = theme.fg("dim", statsLeft);
			const remainder = statsLine.slice(statsLeft.length);
			const dimRemainder = theme.fg("dim", remainder);
			const pwdLine = truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "..."));

			const lines = [pwdLine, dimStatsLeft + dimRemainder];

			// Extension statuses
			const extensionStatuses = footerData.getExtensionStatuses();
			if (extensionStatuses.size > 0) {
				const sortedStatuses = Array.from(extensionStatuses.entries())
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([, text]) => sanitizeStatusText(text));
				const statusLine = sortedStatuses.join(" ");
				lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
			}

			return lines;
		},
	});
}
