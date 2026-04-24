/**
 * PTY-based command execution using macOS/Linux `script` wrapper.
 *
 * Runs a command in a pseudo-terminal so it sees a real TTY (isatty=true,
 * colors work, interactive prompts work). Output goes live to the terminal
 * AND is captured to a temp file for the LLM.
 *
 * Uses `script -q <tmpfile> <shell> -c <command>` — no native dependencies.
 */

import { spawnSync } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Max output size returned to the LLM to protect context window. */
export const MAX_OUTPUT_BYTES = 10_000;

export interface PtyResult {
	exitCode: number | null;
	/** Raw captured output (may contain ANSI escapes and control chars). */
	rawOutput: string;
	/** Cleaned output suitable for the LLM (ANSI stripped, control chars removed). */
	cleanOutput: string;
	/** True if the command used alternate screen buffer (fullscreen TUI). */
	usedAltScreen: boolean;
	/** True if cleanOutput was truncated to MAX_OUTPUT_BYTES. */
	truncated: boolean;
}

/**
 * Clean raw PTY/script output into LLM-friendly text.
 * Exported separately for testability.
 */
/** Sequences not covered by stripVTControlCharacters: OSC, DCS, APC. */
const EXTRA_ESCAPE_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[P_][^\x1b]*\x1b\\/g;

export function cleanRawOutput(raw: string): string {
	return stripVTControlCharacters(raw.replace(EXTRA_ESCAPE_RE, ""))
		.replace(/^\^D/, "")                            // macOS script ^D prefix
		.replace(/\x04/g, "")                           // raw EOT bytes
		.replace(/^Script started on [^\n]*\n?/, "")    // Linux script header
		.replace(/\nScript done on [^\n]*\n?$/, "")     // Linux script footer
		.replace(/\r\n/g, "\n")                         // normalize line endings
		.replace(/\r/g, "\n")
		.trim();
}

/**
 * Truncate output to MAX_OUTPUT_BYTES. Returns { text, truncated }.
 */
export function truncateOutput(text: string): { text: string; truncated: boolean } {
	if (text.length <= MAX_OUTPUT_BYTES) return { text, truncated: false };
	return { text: text.slice(0, MAX_OUTPUT_BYTES) + "\n…(truncated)", truncated: true };
}

/**
 * Run a command in a PTY via the `script` wrapper.
 * Output is displayed live to the terminal AND captured.
 * Falls back to regular spawnSync if `script` is unavailable or fails (e.g. no TTY in CI).
 */
export function runInPty(command: string): PtyResult {
	const shell = process.env.SHELL || "/bin/sh";

	// Try PTY via `script` wrapper
	const ptyResult = tryScriptWrapper(command, shell);
	if (ptyResult) return ptyResult;

	// Fallback: regular spawnSync with inherited stdio (no capture)
	const result = spawnSync(shell, ["-c", command], {
		stdio: "inherit",
		env: process.env,
	});

	return {
		exitCode: result.status,
		rawOutput: "",
		cleanOutput: "",
		usedAltScreen: false,
		truncated: false,
	};
}

function tryScriptWrapper(command: string, shell: string): PtyResult | null {
	const tmpFile = path.join(os.tmpdir(), `pi-pty-${Date.now()}-${Math.random().toString(36).slice(2)}`);

	try {
		const isMac = process.platform === "darwin";
		// macOS: script -q <file> <shell> -c <command> (command is a separate arg, no shell expansion)
		// Linux: script -q -c '<shell> -c '\''<command>'\''' <file> (single-quote to prevent expansion)
		const args = isMac
			? ["-q", tmpFile, shell, "-c", command]
			: ["-q", "-c", `${shell} -c '${command.replace(/'/g, "'\\''")}'`, tmpFile];

		const result = spawnSync("script", args, {
			stdio: "inherit",
			env: process.env,
		});

		// If script itself failed (not the command), fall back
		if (result.error) return null;

		let rawOutput = "";
		try {
			if (!fs.existsSync(tmpFile)) return null;
			rawOutput = fs.readFileSync(tmpFile, "utf-8");
		} catch {
			return null;
		}

		// If script failed (no TTY) it may create an empty file or return non-zero
		// while the actual command didn't run. Check if we got any output.
		if (result.status !== 0 && rawOutput.trim() === "") return null;

		const usedAltScreen = rawOutput.includes("\x1b[?1049h") || rawOutput.includes("\x1b[?47h");
		const cleaned = cleanRawOutput(rawOutput);
		const { text: cleanOutput, truncated } = truncateOutput(cleaned);

		return {
			exitCode: result.status,
			rawOutput,
			cleanOutput,
			usedAltScreen,
			truncated,
		};
	} catch {
		return null;
	} finally {
		try { fs.unlinkSync(tmpFile); } catch {}
	}
}
