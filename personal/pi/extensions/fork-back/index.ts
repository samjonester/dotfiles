/**
 * fork-back — Return to the parent session after a /fork or Ctrl+Shift+F.
 *
 * Usage:
 *   /back    Switch back to the session this one was forked from.
 *
 * How it works:
 *   1. On session_start with reason "fork", captures previousSessionFile
 *      and persists it as a custom entry (survives restarts).
 *   2. On session_start (always), reconstructs the parent path from
 *      either the session header (parentSession) or the custom entry.
 *   3. /back calls switchSession() to jump directly to the parent.
 *
 * Why not just read the header?
 *   There's a bug in pi where createBranchedSession defers writing the
 *   session file when the branch has no assistant messages (e.g., forking
 *   from the first user message). SessionManager.open then finds no file
 *   and creates a fresh session without parentSession in the header.
 *   The session_start event reliably provides previousSessionFile regardless.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync } from "node:fs";

const CUSTOM_TYPE = "fork-back-parent";

export default function (pi: ExtensionAPI) {
	let parentSessionFile: string | undefined;

	// Reconstruct state from session entries on load/resume/fork
	pi.on("session_start", async (event, ctx) => {
		parentSessionFile = undefined;

		// Source 1: session header (works when createBranchedSession writes the file)
		const header = ctx.sessionManager.getHeader();
		if ((header as any)?.parentSession) {
			parentSessionFile = (header as any).parentSession as string;
		}

		// Source 2: our persisted custom entry (works always)
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && (entry as any).customType === CUSTOM_TYPE) {
				const stored = (entry as any).data?.parentSessionFile;
				if (typeof stored === "string") {
					parentSessionFile = stored;
				}
			}
		}

		// If this is a fresh fork and we don't have a parent yet, persist it
		if (event.reason === "fork" && event.previousSessionFile && !parentSessionFile) {
			parentSessionFile = event.previousSessionFile;
			pi.appendEntry(CUSTOM_TYPE, { parentSessionFile: event.previousSessionFile });
		}
	});

	pi.registerCommand("back", {
		description: "Return to the session this one was forked from",
		handler: async (_args, ctx) => {
			if (!parentSessionFile) {
				ctx.ui.notify("No parent session — this session wasn't forked.", "warn");
				return;
			}

			if (!existsSync(parentSessionFile)) {
				ctx.ui.notify(`Parent session file no longer exists:\n${parentSessionFile}`, "error");
				return;
			}

			const result = await ctx.switchSession(parentSessionFile);
			if (result.cancelled) {
				ctx.ui.notify("Switch cancelled.", "info");
			}
		},
	});
}
