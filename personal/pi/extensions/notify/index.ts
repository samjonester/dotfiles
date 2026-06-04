/**
 * Desktop Notification Extension
 *
 * Sends a native desktop notification when the agent finishes.
 *
 * Strategy (in order):
 *   1. RPC host passthrough (pi-desktop / pide) via PI_MODE=rpc
 *   2. `cmux notify` when running inside cmux — fires a macOS system
 *      notification AND adds a row to cmux's notification panel; clicking it
 *      (or Cmd+Shift+U) focuses this workspace/surface (click-to-activate)
 *   3. osascript fallback (plain macOS notification, no click-to-activate)
 *
 * cmux-only: the previous tmux + terminal-notifier + OSC click-to-activate
 * machinery was removed. cmux is Ghostty-based and owns notification routing
 * + focus, so `cmux notify` supersedes per-terminal OSC sequences here.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execFileSync } from "node:child_process";

const escapeOsascript = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** True when running inside a cmux terminal surface. */
const isInCmux = (): boolean => Boolean(process.env.CMUX_WORKSPACE_ID);

/**
 * Notify via cmux. Targets the current surface (CMUX_SURFACE_ID) so a click
 * on the panel row / system notification focuses the exact Pi pane. Falls back
 * to the workspace when only CMUX_WORKSPACE_ID is set.
 */
const notifyCmux = (title: string, body: string): boolean => {
	if (!isInCmux()) return false;
	try {
		const args = ["notify", "--title", title, "--body", body];
		const surface = process.env.CMUX_SURFACE_ID;
		const workspace = process.env.CMUX_WORKSPACE_ID;
		if (surface) {
			args.push("--surface", surface);
		} else if (workspace) {
			args.push("--workspace", workspace);
		}
		execFileSync("cmux", args, { timeout: 3000, stdio: "ignore" });
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
	if (notifyCmux(title, body)) return;
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
			const via = isInCmux()
				? `cmux (surface: ${process.env.CMUX_SURFACE_ID ?? "?"})`
				: "osascript";
			ctx.ui.notify(`Testing via ${via}`, "info");
			notify("π test", "Click me — should focus this workspace!");
		},
	});
}
