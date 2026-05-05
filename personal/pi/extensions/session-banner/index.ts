/**
 * Session Banner — display-only fork of shop-pi-fy session-banner.
 *
 * This is a personal fork that delegates session naming to retitle (which uses
 * a separate Haiku call instead of an in-band tool the main agent must call).
 *
 * Differences from upstream shop-pi-fy session-banner:
 *   - Removed `set_session_label` tool registration (retitle does the naming)
 *   - Removed `/title` command (retitle has `/retitle` and `/retitle-all`)
 *   - Added `before_agent_start` re-render hook so the banner refreshes when
 *     retitle updates the name across the first few turns
 *   - Installs a custom footer via `pi.setFooter()` that mirrors pi-core's
 *     interactive footer but skips the `• sessionName` suffix on the pwd line
 *     (the banner widget above already shows the name — no point showing twice)
 *
 * The banner widget reads the session name via parseSessionName(pi.getSessionName()),
 * which already understands retitle's `🐛 label` format.
 *
 * Commands removed (retitle handles these):
 *   /retitle      — re-generate session name from conversation
 *   /retitle-all  — backfill names for all unnamed sessions
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";

import {
	buildTerminalTitle,
	detectWorldContext,
	fgHex,
	parseSessionName,
} from "./helpers.js";
import { buildFooterFactory } from "./footer.js";

export default function (pi: ExtensionAPI) {
	let label = "";
	let emoji = "";
	let titleColor = "";
	let currentCtx: ExtensionContext | null = null;

	// ─── Banner rendering ─────────────────────────────────────────────

	function renderBanner(ctx: ExtensionContext) {
		if (!ctx.hasUI) return;

		const { treeName, zone } = detectWorldContext(ctx.cwd);

		// Terminal / tab title (always set, even without label)
		ctx.ui.setTitle(buildTerminalTitle(treeName, zone, emoji, label));

		// Widget hidden until labeled
		if (!label) {
			ctx.ui.setWidget("session-banner", undefined);
			return;
		}

		ctx.ui.setWidget("session-banner", (_tui, theme) => {
			return {
				render: (width: number) => {
					const content = `  ${emoji}  ${theme.fg("dim", "│")}  ${theme.bold(fgHex(titleColor, label))}`;
					const bar = theme.fg("dim", "─".repeat(width));
					return [bar, truncateToWidth(content, width), bar];
				},
				invalidate: () => {},
			};
		});
	}

	// ─── State restore ────────────────────────────────────────────────

	function restoreState() {
		const parsed = parseSessionName(pi.getSessionName() || "");
		emoji = parsed.emoji;
		label = parsed.label;
		titleColor = parsed.titleColor;
	}

	// ─── Lifecycle ────────────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		currentCtx = ctx;
		restoreState();
		renderBanner(ctx);
		// Install custom footer that omits the `• sessionName` suffix.
		// Skip in print/RPC modes — setFooter is a UI-only API.
		if (ctx.hasUI) {
			ctx.ui.setFooter(buildFooterFactory(() => currentCtx));
		}
	});

	pi.on("session_switch", async (_event, ctx) => {
		currentCtx = ctx;
		restoreState();
		renderBanner(ctx);
	});

	// retitle sets the name in `agent_end` (turn N), so refresh the banner at
	// the start of turn N+1 to pick up the latest emoji+label. before_agent_start
	// fires before each agent turn, which is enough — no separate agent_start
	// handler needed (would just duplicate ctx tracking).
	pi.on("before_agent_start", async (_event, ctx) => {
		currentCtx = ctx;
		restoreState();
		renderBanner(ctx);
	});
}
