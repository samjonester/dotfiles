/**
 * Desktop Notification Extension
 *
 * Sends a native desktop notification when the agent finishes.
 *
 * Strategy (in order):
 *   1. OSC escape sequences via /dev/tty (iTerm2, Ghostty, WezTerm)
 *   2. terminal-notifier with tab activation (clicks open the right tab)
 *   3. osascript fallback (requires Script Editor notification permission)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";

const OSC_TERMINALS = new Set(["iTerm.app", "iTerm2", "ghostty", "Ghostty", "WezTerm", "kitty"]);

const escapeOsascript = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** Detect outer terminal — inside tmux, TERM_PROGRAM is "tmux" (or empty
 *  if the host terminal never set it in the parent env). Falls back to
 *  terminal-specific env vars when TERM_PROGRAM is missing or uninformative. */
let outerTermCache: string | undefined;
const getOuterTerminal = (): string => {
	if (outerTermCache !== undefined) return outerTermCache;
	let term = process.env.TERM_PROGRAM ?? "";
	if ((term === "tmux" || term === "") && process.env.TMUX) {
		try {
			const out = execFileSync("tmux", ["show-environment", "-g", "TERM_PROGRAM"], {
				timeout: 1000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
			}).trim();
			if (out.includes("=")) term = out.split("=")[1];
		} catch {}
		// Fallback: infer from terminal-specific env vars when TERM_PROGRAM is
		// missing or still "tmux" (e.g. the parent terminal never set
		// TERM_PROGRAM, or tmux's global env was never populated).
		if (!term || term === "tmux") {
			if (process.env.KITTY_WINDOW_ID) term = "kitty";
			else if (process.env.GHOSTTY_RESOURCES_DIR) term = "Ghostty";
			else if (process.env.WEZTERM_PANE) term = "WezTerm";
			else if (process.env.ITERM_SESSION_ID) term = "iTerm.app";
		}
	}
	// Kitty doesn't set TERM_PROGRAM outside tmux either; detect via its own
	// env vars or TERM.
	if (!term && (process.env.KITTY_PID || process.env.TERM === "xterm-kitty")) {
		term = "kitty";
	}
	outerTermCache = term;
	return term;
};

/** Get the Terminal.app tab tty (via tmux client tty if in tmux). */
const getClientTTY = (): string | null => {
	try {
		if (process.env.TMUX) {
			return execFileSync("tmux", ["display-message", "-p", "#{client_tty}"], {
				timeout: 1000, encoding: "utf-8",
			}).trim() || null;
		}
		return execFileSync("tty", { timeout: 1000, encoding: "utf-8" }).trim() || null;
	} catch {
		return null;
	}
};

/** Get tmux socket path and current pane ID for click-to-activate.
 *  Prefers TMUX_PANE (set per-process at shell creation, stable across pane
 *  switches) over display-message which reports the *active* pane and can
 *  drift if the user navigates away before the debounced notification fires. */
const getTmuxTarget = (): { socket: string; paneId: string } | null => {
	if (!process.env.TMUX) return null;
	try {
		// TMUX env is "socket_path,pid,session_id" — extract socket path
		const socket = process.env.TMUX.split(",")[0];
		if (!socket) return null;
		// TMUX_PANE is stable — set once when tmux spawns the shell
		let paneId = process.env.TMUX_PANE ?? "";
		if (!paneId) {
			paneId = execFileSync("tmux", ["display-message", "-p", "#{pane_id}"], {
				timeout: 1000, encoding: "utf-8",
			}).trim();
		}
		if (!paneId) return null;
		return { socket, paneId };
	} catch {
		return null;
	}
};

/** Resolve full path to tmux binary (needed in detached -execute context). */
const findTmuxBin = (): string => {
	try {
		return execFileSync("which", ["tmux"], {
			timeout: 1000, encoding: "utf-8",
		}).trim() || "tmux";
	} catch {
		return "tmux";
	}
};

/** Shell-escape a string for safe interpolation into a shell command. */
const shellEscape = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;

const notifyOSC = (title: string, body: string, term: string): boolean => {
	let payload: string;
	if (term.startsWith("iTerm")) {
		// OSC 9 — iTerm2
		payload = `\x1b]9;${title}: ${body}\x07`;
	} else if (term === "kitty") {
		// OSC 99 — Kitty: key=value pairs, semicolon-separated metadata, colon-separated body
		// Encode body as base64 to handle special characters
		const encoded = Buffer.from(`${title}: ${body}`).toString("base64");
		payload = `\x1b]99;i=1:d=0:p=body;${encoded}\x1b\\`;
	} else {
		// OSC 777 — Ghostty, WezTerm, and others
		payload = `\x1b]777;notify;${title};${body}\x07`;
	}
	try {
		const fd = fs.openSync("/dev/tty", "w");
		fs.writeSync(fd, payload);
		fs.closeSync(fd);
		return true;
	} catch {
		return false;
	}
};

const notifyTerminalNotifier = (title: string, body: string): boolean => {
	try {
		const outer = getOuterTerminal();
		const tty = getClientTTY();
		const tmux = getTmuxTarget();

		// Build -execute script that activates the correct terminal tab on click
		let executeScript = "";
		if (outer === "Apple_Terminal" && tty) {
			executeScript = [
				'tell application "Terminal" to activate',
				`tell application "Terminal"`,
				`  set targetTTY to "${tty}"`,
				`  repeat with w in windows`,
				`    repeat with t in tabs of w`,
				`      if tty of t is targetTTY then`,
				`        set selected tab of w to t`,
				`        set index of w to 1`,
				`        return`,
				`      end if`,
				`    end repeat`,
				`  end repeat`,
				`end tell`,
			].join("\n");
		}

		const args = ["-title", title, "-message", body, "-sound", "default"];
		if (executeScript) {
			let executeCmd = `osascript -e '${executeScript.replace(/'/g, "'\\''")}'`;
			// Chain tmux window/pane selection after tab activation
			if (tmux) {
				const bin = shellEscape(findTmuxBin());
				const sock = shellEscape(tmux.socket);
				const pane = shellEscape(tmux.paneId);
				executeCmd += ` && ${bin} -S ${sock} select-window -t ${pane} && ${bin} -S ${sock} select-pane -t ${pane}`;
			}
			args.push("-execute", executeCmd);
		} else {
			// Fallback: just activate the app
			const bundleId = outer === "Apple_Terminal" ? "com.apple.Terminal"
				: outer.startsWith("iTerm") ? "com.googlecode.iterm2" : "";
			if (bundleId) args.push("-activate", bundleId);
		}

		execFileSync("terminal-notifier", args, { timeout: 3000, stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
};

const notifyOsascript = (title: string, body: string): boolean => {
	try {
		const t = escapeOsascript(title);
		const b = escapeOsascript(body);
		execFileSync("osascript", ["-e", `display notification "${b}" with title "${t}"`], {
			timeout: 3000, stdio: "ignore",
		});
		return true;
	} catch {
		return false;
	}
};

/**
 * When running in RPC mode (pi-desktop, pide, etc.), emit the notification as a JSON
 * line so the host process can show it natively (e.g. Electron Notification).
 * Any pi GUI that reads stdout can intercept { type: "desktop_notification" } events.
 *
 * Gated on PI_MODE=rpc rather than !process.stdout.isTTY to avoid injecting JSON
 * into piped shells, CI runners, --mode json, and other non-TTY consumers.
 * pi-desktop must set PI_MODE=rpc in the environment before spawning pi.
 */
const notifyRpcHost = (title: string, body: string): boolean => {
	if (process.env.PI_MODE !== "rpc") return false;
	try {
		process.stdout.write(JSON.stringify({ type: "desktop_notification", title, body }) + "\n");
		return true;
	} catch {
		return false;
	}
};

const notify = (title: string, body: string): void => {
	if (notifyRpcHost(title, body)) return;
	const term = getOuterTerminal();
	if (OSC_TERMINALS.has(term) && notifyOSC(title, body, term)) return;
	if (notifyTerminalNotifier(title, body)) return;
	notifyOsascript(title, body);
};

const isTextPart = (p: unknown): p is { type: "text"; text: string } =>
	Boolean(p && typeof p === "object" && "type" in p && (p as any).type === "text" && "text" in p);

const extractLastText = (msgs: Array<{ role?: string; content?: unknown }>): string | null => {
	for (let i = msgs.length - 1; i >= 0; i--) {
		const m = msgs[i];
		if (m?.role !== "assistant") continue;
		if (typeof m.content === "string") return m.content.trim() || null;
		if (Array.isArray(m.content)) {
			return m.content.filter(isTextPart).map((p) => p.text).join("\n").trim() || null;
		}
		return null;
	}
	return null;
};

const summarize = (text: string | null): string => {
	if (!text) return "Ready for input";
	const plain = text.replace(/[#*_`~\[\]()>|-]/g, "").replace(/\s+/g, " ").trim();
	return plain.length > 200 ? `${plain.slice(0, 199)}…` : plain;
};

export default function (pi: ExtensionAPI) {
	// Other extensions can emit "notify:disable" to suppress notifications
	// for this session (e.g. agent-teams disables them for teammates).
	let enabled = true;
	pi.events.on("notify:disable", () => { enabled = false; });

	pi.events.on("notify:send", (payload: unknown) => {
		const p = payload as { title: string; body: string };
		if (enabled && p && p.title && p.body) {
			notify(p.title, p.body);
		}
	});

	const getTitle = (): string => {
		const name = pi.getSessionName();
		return name ? `π: ${name}` : "π";
	};

	// Debounce: only notify when the agent has truly settled (no new
	// agent_start within DEBOUNCE_MS).  Suppresses rapid-fire notifications
	// from team_message processing / multi-step tool chains.
	const DEBOUNCE_MS = 5_000;
	let pendingTimer: ReturnType<typeof setTimeout> | null = null;

	pi.on("agent_start", () => {
		if (pendingTimer) {
			clearTimeout(pendingTimer);
			pendingTimer = null;
		}
	});

	pi.on("agent_end", async (event) => {
		if (pendingTimer) clearTimeout(pendingTimer);
		const title = getTitle();
		const body = summarize(extractLastText(event.messages ?? []));
		pendingTimer = setTimeout(() => {
			pendingTimer = null;
			if (enabled) notify(title, body);
		}, DEBOUNCE_MS);
	});

	pi.registerCommand("notify", {
		description: "Send a test desktop notification",
		handler: async (_args, ctx) => {
			const term = getOuterTerminal();
			ctx.ui.notify(`Testing via ${term} (tty: ${getClientTTY()})`, "info");
			notify("π test", "Click me — should activate this tab!");
		},
	});
}
