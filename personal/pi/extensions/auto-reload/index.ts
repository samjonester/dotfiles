/**
 * Auto-Reload Extension
 *
 * Gives the agent a reload_extensions tool to reload extensions/skills
 * after editing them. Run /auto-reload once per session to enable.
 * Run again to disable.
 *
 * Uses globalThis to persist captured functions across reloads,
 * so subsequent reloads work without re-bootstrapping.
 *
 * Commands:
 *   /auto-reload - Toggle auto-reload on/off
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

interface AutoReloadState {
	enabled: boolean;
	reload: (() => Promise<void>) | null;
	waitForIdle: (() => Promise<void>) | null;
}

const GLOBAL_KEY = "__piAutoReload";

function getState(): AutoReloadState {
	const g = globalThis as any;
	if (!g[GLOBAL_KEY]) {
		g[GLOBAL_KEY] = { enabled: false, reload: null, waitForIdle: null };
	}
	return g[GLOBAL_KEY];
}

export default function (pi: ExtensionAPI) {
	const state = getState();


	pi.registerCommand("auto-reload", {
		description: "Toggle auto-reload for extension development",
		handler: async (_args, ctx) => {
			if (state.enabled && state.reload) {
				state.enabled = false;
				state.reload = null;
				state.waitForIdle = null;
				ctx.ui.notify("Auto-reload: off", "info");
			} else {
				state.enabled = true;
				state.reload = () => ctx.reload();
				state.waitForIdle = () => ctx.waitForIdle();
				ctx.ui.notify("Auto-reload: on", "info");
			}
		},
	});

	pi.registerTool({
		name: "reload_extensions",
		label: "Reload Extensions",
		description:
			"Reload pi extensions, skills, prompts, and context files after modifying them. " +
			"IMPORTANT: This must be the LAST tool call in your turn. Do NOT output any text or call any other tools after this " +
			"-- the reload happens after the turn ends and a follow-up message will resume the conversation. " +
			"Note: requires /auto-reload to have been run once in the session to bootstrap.",
		promptSnippet: "Reload extensions and skills after editing them",
		promptGuidelines: [
			"After editing any file in ~/.pi/agent/extensions/, ~/.pi/agent/skills/, .pi/extensions/, or .pi/skills/, call reload_extensions so changes take effect.",
			"If reload_extensions says it needs bootstrapping, ask the user to run /auto-reload once.",
		],
		parameters: Type.Object({}),
		async execute() {
			if (!state.enabled || !state.reload || !state.waitForIdle) {
				return {
					content: [
						{
							type: "text",
							text: "Auto-reload is not enabled. Ask the user to run /auto-reload to enable it.",
						},
					],
					details: {},
				};
			}

			const { reload, waitForIdle } = state;
			const doReload = async () => {
				await waitForIdle();
				await reload();
				pi.sendUserMessage("Reload complete. Continue where you left off.");
			};
			doReload().catch(() => {
				// Reload failed (e.g. syntax error in edited extension).
				// Send a follow-up so the agent isn't stranded.
				pi.sendUserMessage("Reload failed. Check the extension for errors and try again.");
			});

			return {
				content: [
					{
						type: "text",
						text: "Reloading extensions after this turn. Stop here -- do not output any text or call other tools. A follow-up message will resume the conversation after reload.",
					},
				],
				details: {},
			};
		},
	});
}
