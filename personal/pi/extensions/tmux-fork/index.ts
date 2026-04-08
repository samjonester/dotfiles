/**
 * tmux-fork — Fork the current Pi session into a new tmux window.
 *
 * Usage:
 *   /tmux-fork [name]         Fork current session into a new tmux window
 *   /tmux-fork-pane [name]    Fork current session into a new tmux pane (vertical split)
 *
 * The new window/pane runs `pi --fork <current-session>` with an optional
 * initial prompt. The original session continues undisturbed.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execSync } from "node:child_process";

function isInTmux(): boolean {
	return !!process.env.TMUX;
}

function shellEscape(s: string): string {
	return `'${s.replace(/'/g, "'\\''")}'`;
}

function buildPiCommand(sessionFile: string, prompt?: string): string {
	const parts = ["devx", "pi", "--fork", shellEscape(sessionFile)];
	if (prompt) {
		parts.push(shellEscape(prompt));
	}
	return parts.join(" ");
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("tmux-fork", {
		description: "Fork current Pi session into a new tmux window",
		handler: async (args, ctx) => {
			if (!isInTmux()) {
				ctx.ui.notify("Not inside tmux — cannot create a new window.", "error");
				return;
			}

			const sessionFile = ctx.sessionManager.getSessionFile();
			if (!sessionFile) {
				ctx.ui.notify("No active session to fork.", "error");
				return;
			}

			const name = args?.trim() || undefined;
			const cmd = buildPiCommand(sessionFile, undefined);

			try {
				// Create new tmux window in current session, running the forked pi
				const tmuxArgs = name
					? `tmux new-window -n ${shellEscape(name)} -c ${shellEscape(ctx.cwd)} ${shellEscape(cmd)}`
					: `tmux new-window -c ${shellEscape(ctx.cwd)} ${shellEscape(cmd)}`;

				execSync(tmuxArgs, { encoding: "utf-8" });
				ctx.ui.notify(`Forked into new tmux window${name ? ` "${name}"` : ""}.`, "info");
			} catch (e: any) {
				ctx.ui.notify(`Failed to create tmux window: ${e.message}`, "error");
			}
		},
	});

	pi.registerCommand("tmux-fork-pane", {
		description: "Fork current Pi session into a new tmux pane (vertical split)",
		handler: async (args, ctx) => {
			if (!isInTmux()) {
				ctx.ui.notify("Not inside tmux — cannot create a new pane.", "error");
				return;
			}

			const sessionFile = ctx.sessionManager.getSessionFile();
			if (!sessionFile) {
				ctx.ui.notify("No active session to fork.", "error");
				return;
			}

			const cmd = buildPiCommand(sessionFile, undefined);

			try {
				// Split horizontally (side-by-side), giving the new pane ~50% width
				const paneId = execSync(
					`tmux split-window -h -c ${shellEscape(ctx.cwd)} -P -F '#{pane_id}' ${shellEscape(cmd)}`,
					{ encoding: "utf-8" },
				).trim();

				const name = args?.trim();
				if (name) {
					try {
						execSync(`tmux select-pane -t ${paneId} -T ${shellEscape(name)}`);
					} catch {
						/* non-fatal */
					}
				}

				ctx.ui.notify(`Forked into new tmux pane${name ? ` "${name}"` : ""}.`, "info");
			} catch (e: any) {
				ctx.ui.notify(`Failed to create tmux pane: ${e.message}`, "error");
			}
		},
	});
}
