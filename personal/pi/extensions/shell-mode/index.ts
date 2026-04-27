/**
 * Shell Mode Extension
 *
 * Adds modes to user `!` commands for interactive, fullscreen, and background execution.
 *
 * Modes:
 *   !<cmd>          Normal pi bash (default)
 *   !i <cmd>        Interactive — runs with stdio inherited (inline in TUI)
 *   !f <cmd>        Fullscreen — suspends TUI, clears screen, restores after
 *   !if/!fi <cmd>   Same as !f
 *   !& <cmd>        Background — starts via background-jobs extension (if available)
 *   !bg <cmd>       Same as !&
 *
 * Auto-detection: known interactive commands (git commit, ssh, psql, pi config, etc.)
 * and fullscreen commands (vim, htop, less, lazygit, etc.) are detected automatically.
 * Use the prefix flags to override.
 *
 * Configuration via environment variables:
 *   INTERACTIVE_COMMANDS  - Additional interactive commands (comma-separated)
 *   INTERACTIVE_EXCLUDE   - Commands to exclude from interactive (comma-separated)
 *   FULLSCREEN_COMMANDS   - Additional fullscreen commands (comma-separated)
 *   FULLSCREEN_EXCLUDE    - Commands to exclude from fullscreen (comma-separated)
 *
 * Note: This only intercepts user `!` commands, not agent bash tool calls.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { type Mode, parsePrefix, classifyCommand } from "./helpers.js";
import { runInPty, truncateOutput } from "./pty.js";

// ── Background jobs hook ─────────────────────────────────────────────────────
// The background-jobs extension exposes a hook on globalThis for other extensions
// to start background jobs. If it's not installed, !& and !bg are unavailable.

export interface BgRunResult {
	jobId: number;
	pid: number | null;
	stdoutPath: string;
	stderrPath: string;
	error?: string;
}

export type BgRunHook = (command: string, cwd: string, options?: { skipReview?: boolean }) => Promise<BgRunResult>;

declare global {
	var __piBgRunHook: BgRunHook | undefined;
}

export default function (pi: ExtensionAPI) {
	pi.on("user_bash", async (event, ctx) => {
		const { mode: forcedMode, command } = parsePrefix(event.command);

		// Determine final mode
		const mode: Mode = forcedMode ?? classifyCommand(command);

		if (mode === "normal") {
			return; // Let normal pi bash handling proceed
		}

		// ── Background mode ──────────────────────────────────────────────
		if (mode === "background") {
			const bgRun = globalThis.__piBgRunHook;
			if (!bgRun) {
				return {
					result: {
						output: "Background mode (!& / !bg) requires the background-jobs extension. Enable it in `pi config` or symlink it.",
						exitCode: 1,
						cancelled: false,
						truncated: false,
					},
				};
			}

			const cwd = process.cwd();
			// User-initiated !& commands skip guard review (user explicitly requested it)
			const result = await bgRun(command, cwd, { skipReview: true });

			if (result.error) {
				return {
					result: {
						output: `Background job #${result.jobId} failed: ${result.error}`,
						exitCode: 1,
						cancelled: false,
						truncated: false,
					},
				};
			}

			const output = `Started background job #${result.jobId} (pid ${result.pid ?? "?"})\nstdout: ${result.stdoutPath}\nstderr: ${result.stderrPath}`;
			return {
				result: {
					output,
					exitCode: 0,
					cancelled: false,
					truncated: false,
				},
			};
		}

		// ── Interactive / Fullscreen modes ────────────────────────────────
		if (!ctx.hasUI) {
			return {
				result: {
					output: "(interactive commands require TUI)",
					exitCode: 1,
					cancelled: false,
					truncated: false,
				},
			};
		}

		if (mode === "fullscreen") {
			// Fullscreen: suspend TUI, clear screen, give full terminal control
			const ptyResult = await ctx.ui.custom<ReturnType<typeof runInPty>>((tui, _theme, _kb, done) => {
				tui.stop();
				process.stdout.write("\x1b[2J\x1b[H");

				done(runInPty(command));

				tui.start();
				tui.requestRender(true);
				return { render: () => [], invalidate: () => {} };
			});

			return buildResult(ptyResult);
		}

		// Interactive inline: run in PTY to capture output while preserving TTY
		return buildResult(runInPty(command));
	});
}

function buildResult(ptyResult: ReturnType<typeof runInPty> | undefined) {
	if (!ptyResult) {
		return { result: { output: "(command failed — no result)", exitCode: 1, cancelled: false, truncated: false } };
	}

	const exitCode = ptyResult.exitCode;

	// Alt-screen TUIs (nvim, lazygit, htop, etc.) emit cursor-positioning escapes
	// that don't survive stripping cleanly — the result is sparse fragments + huge
	// runs of whitespace. Don't render that to scrollback; just return a status line.
	if (ptyResult.usedAltScreen) {
		const output = exitCode === 0
			? "(fullscreen command exited cleanly)"
			: `(fullscreen command exited with code ${exitCode})`;
		return {
			result: { output, exitCode: exitCode ?? 1, cancelled: false, truncated: false },
		};
	}

	if (ptyResult.cleanOutput) {
		const { text, truncated } = truncateOutput(ptyResult.cleanOutput);
		return {
			result: { output: text, exitCode: exitCode ?? 1, cancelled: false, truncated: truncated || ptyResult.truncated },
		};
	}

	const output = exitCode === 0
		? "(command completed successfully — no output)"
		: `(command exited with code ${exitCode} — no output)`;

	return {
		result: { output, exitCode: exitCode ?? 1, cancelled: false, truncated: false },
	};
}
