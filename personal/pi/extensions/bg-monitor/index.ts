/**
 * Background Job Monitor
 *
 * Tracks bg_run / bg_stop / bg_wait tool calls and shows a live status
 * in the footer via setStatus. Polls PIDs every 5s to detect when jobs
 * exit between turns, so the count stays accurate even when the LLM
 * isn't actively checking.
 *
 * Footer examples:
 *   ⚙ bg: 2 running
 *   ⚙ bg: 1 running, 2 exited
 *   ✓ bg: 3 exited
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

interface BgJob {
	id: number;
	pid: number;
	command: string;
	startedAt: number;
	alive: boolean;
}

export default function bgMonitor(pi: ExtensionAPI) {
	const jobs = new Map<number, BgJob>();
	let pollInterval: ReturnType<typeof setInterval> | null = null;
	let ctx: ExtensionContext | null = null;

	// ── Status rendering ────────────────────────────────

	function updateFooter() {
		if (!ctx) return;
		const theme = ctx.ui.theme;

		if (jobs.size === 0) {
			ctx.ui.setStatus("bg-jobs", undefined);
			return;
		}

		const aliveCount = [...jobs.values()].filter((j) => j.alive).length;
		const exitedCount = [...jobs.values()].filter((j) => !j.alive).length;

		const parts: string[] = [];
		if (aliveCount > 0) parts.push(`${aliveCount} running`);
		if (exitedCount > 0) parts.push(`${exitedCount} exited`);

		if (aliveCount > 0) {
			ctx.ui.setStatus("bg-jobs", theme.fg("accent", `⚙ bg: ${parts.join(", ")}`));
		} else {
			// All exited — show briefly, then auto-clear after 30s
			ctx.ui.setStatus("bg-jobs", theme.fg("dim", `✓ bg: ${parts.join(", ")}`));
		}
	}

	// ── PID polling ─────────────────────────────────────

	async function checkProcesses() {
		const alive = [...jobs.values()].filter((j) => j.alive);
		if (alive.length === 0) {
			pruneStaleExited();
			return;
		}

		let changed = false;
		for (const job of alive) {
			try {
				const result = await pi.exec("kill", ["-0", String(job.pid)]);
				if (result.code !== 0) {
					job.alive = false;
					changed = true;
				}
			} catch {
				job.alive = false;
				changed = true;
			}
		}

		if (changed) updateFooter();
	}

	/** Remove exited jobs older than 60s to keep the map tidy */
	function pruneStaleExited() {
		const cutoff = Date.now() - 60_000;
		let pruned = false;
		for (const [id, job] of jobs) {
			if (!job.alive && job.startedAt < cutoff) {
				jobs.delete(id);
				pruned = true;
			}
		}
		if (pruned) updateFooter();
	}

	function startPolling() {
		if (pollInterval) return;
		pollInterval = setInterval(() => {
			checkProcesses();
		}, 5_000);
	}

	function stopPolling() {
		if (pollInterval) {
			clearInterval(pollInterval);
			pollInterval = null;
		}
	}

	// ── Text parsing helpers ────────────────────────────

	function extractText(content: unknown): string {
		if (!Array.isArray(content)) return "";
		return content
			.filter((c: { type?: string }) => c.type === "text")
			.map((c: { text?: string }) => c.text || "")
			.join("\n");
	}

	function parseJobFromText(text: string, command: string): BgJob | null {
		const idMatch =
			text.match(/\bjob\s+#?(\d+)/i) || text.match(/\bID\b[:\s]*(\d+)/i);
		const pidMatch =
			text.match(/\bpid[:\s]*(\d+)/i) || text.match(/\bPID\b[:\s]*(\d+)/i);

		if (idMatch && pidMatch) {
			return {
				id: parseInt(idMatch[1]),
				pid: parseInt(pidMatch[1]),
				command: command.slice(0, 100),
				startedAt: Date.now(),
				alive: true,
			};
		}
		return null;
	}

	// ── Lifecycle events ────────────────────────────────

	pi.on("session_start", async (_event, extensionCtx) => {
		ctx = extensionCtx;
		jobs.clear();
		updateFooter();
		startPolling();
	});

	pi.on("session_shutdown", async () => {
		stopPolling();
		jobs.clear();
		ctx = null;
	});

	// ── Tool result interception ────────────────────────

	pi.on("tool_result", async (event, extensionCtx) => {
		ctx = extensionCtx;

		if (event.toolName === "bg_run" && !event.isError) {
			const input = event.input as { command?: string } | undefined;
			const command = input?.command || "unknown";

			// Prefer structured details if available
			const details = event.details as { id?: number; pid?: number } | undefined;
			if (details?.id != null && details?.pid != null) {
				jobs.set(details.id, {
					id: details.id,
					pid: details.pid,
					command: command.slice(0, 100),
					startedAt: Date.now(),
					alive: true,
				});
			} else {
				// Fall back to text parsing
				const text = extractText(event.content);
				const job = parseJobFromText(text, command);
				if (job) jobs.set(job.id, job);
			}
			updateFooter();
		}

		if (event.toolName === "bg_stop") {
			const id = (event.input as { id?: number })?.id;
			if (id != null) {
				const job = jobs.get(id);
				if (job) job.alive = false;
				updateFooter();
			}
		}

		if (event.toolName === "bg_wait") {
			const id = (event.input as { id?: number })?.id;
			if (id != null) {
				const job = jobs.get(id);
				if (job) job.alive = false;
				updateFooter();
			}
		}

		// bg_list with "No background jobs" → clear everything
		if (event.toolName === "bg_list") {
			const text = extractText(event.content);
			if (/no background jobs/i.test(text)) {
				jobs.clear();
			}
			updateFooter();
		}
	});
}
