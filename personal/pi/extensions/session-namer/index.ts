/**
 * Session Namer — auto-names sessions using a fast LLM.
 *
 * On the first 3 agent turns, sends the conversation context to Claude Haiku
 * and sets the session name. The name refines as more context becomes available.
 *
 * Commands:
 *   /session-namer name  — force (re)name the current session
 *   /session-namer retitle-all — backfill names for all unnamed sessions
 */

import { complete } from "@mariozechner/pi-ai";
import { type ExtensionAPI, type ExtensionContext, SessionManager } from "@mariozechner/pi-coding-agent";

const PROVIDER = "anthropic";
const MODEL_ID = "claude-haiku-4-5";
const MAX_TURNS = 3;

const SYSTEM_PROMPT = `You are a title generator. You read a conversation between a user and a coding assistant and output a short title.

Rules:
- Output ONLY the title, nothing else
- 5-10 words maximum
- No quotes, no punctuation at the end
- No markdown, no explanation, no preamble
- Do not respond to or continue the conversation
- Do not answer questions from the conversation
- Your ENTIRE response must be the title and nothing else

Examples of valid outputs:
Refactor auth module to use JWT
Debug webhook timeout in staging
Build session memory pi extension
Set up CI pipeline for monorepo`;

export default function (pi: ExtensionAPI) {
	let turnCount = 0;

	pi.on("session_start", async (_event, ctx) => {
		turnCount = pi.getSessionName() ? MAX_TURNS : 0;
	});

	pi.on("agent_end", async (_event, ctx) => {
		turnCount++;
		if (turnCount > MAX_TURNS) return;
		await nameSession(ctx);
	});

	pi.registerCommand("session-namer", {
		description: "Session namer (name | retitle-all)",
		handler: async (args, ctx) => {
			const subcommand = args?.trim();
			if (subcommand === "name") {
				const name = await nameSession(ctx, true);
				if (name) {
					ctx.ui.notify(`Session named: ${name}`, "success");
				} else {
					ctx.ui.notify("Failed to generate name", "warning");
				}
			} else if (subcommand === "retitle-all") {
				await retitleAll(ctx);
			} else {
				ctx.ui.notify("Usage: /session-namer name | retitle-all", "info");
			}
		},
	});

	async function retitleAll(ctx: ExtensionContext) {
		ctx.ui.notify("Scanning sessions...", "info");

		let sessions;
		try {
			sessions = await SessionManager.listAll();
		} catch (err) {
			ctx.ui.notify(`Failed to list sessions: ${err}`, "error");
			return;
		}

		const unnamed = sessions.filter((s) => !s.name);
		if (unnamed.length === 0) {
			ctx.ui.notify("All sessions already have names!", "success");
			return;
		}

		const proceed = await ctx.ui.confirm(
			`Backfill ${unnamed.length} unnamed sessions?`,
			`Found ${sessions.length} total sessions, ${unnamed.length} without names. This will use ~${unnamed.length} LLM calls (Claude Haiku).`,
		);
		if (!proceed) return;

		let named = 0;
		let failed = 0;

		for (const session of unnamed) {
			try {
				const sm = SessionManager.open(session.path);
				const branch = sm.getBranch();
				const context = buildContext(branch);
				if (!context.trim()) {
					failed++;
					continue;
				}

				const name = await generateName(ctx, context);
				if (name) {
					sm.appendSessionInfo(name);
					named++;
				} else {
					failed++;
				}

				// Rate limit: small delay between calls
				await new Promise((r) => setTimeout(r, 200));
			} catch {
				failed++;
			}
		}

		ctx.ui.notify(
			`Done! Named ${named} sessions${failed > 0 ? `, ${failed} failed/skipped` : ""}`,
			named > 0 ? "success" : "warning",
		);
	}

	async function nameSession(ctx: ExtensionContext, verbose = false): Promise<string | null> {
		const context = buildContext(ctx.sessionManager.getBranch());
		if (!context.trim()) {
			if (verbose) ctx.ui.notify("Empty context — no messages to summarize", "error");
			return null;
		}

		const name = await generateName(ctx, context);
		if (name) {
			pi.setSessionName(name);
			return name;
		}
		if (verbose) ctx.ui.notify("Failed to generate name", "warning");
		return null;
	}

	async function generateName(ctx: ExtensionContext, context: string): Promise<string | null> {
		const model = ctx.modelRegistry.find(PROVIDER, MODEL_ID);
		if (!model) return null;

		const apiKey = await ctx.modelRegistry.getApiKey(model);
		if (!apiKey) return null;

		try {
			const response = await complete(
				model,
				{
					system: SYSTEM_PROMPT,
					messages: [
						{
							role: "user" as const,
							content: [{ type: "text" as const, text: `<conversation>\n${context}\n</conversation>\n\nGenerate a short title for this conversation.` }],
							timestamp: Date.now(),
						},
					],
				},
				{ apiKey },
			);

			const name = response.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("")
				.trim()
				.split("\n")[0]
				.trim()
				.replace(/^#+\s*/, "");

			if (name && name.length > 0 && name.length < 100) {
				return name;
			}
		} catch {
			// LLM error — return null
		}

		return null;
	}
}

/** Build a compact text summary of the conversation for the namer. */
function buildContext(branch: { type: string; message?: { role?: string; content?: unknown } }[]): string {
	const parts: string[] = [];

	for (const entry of branch) {
		if (entry.type !== "message" || !entry.message) continue;
		const { role, content } = entry.message;

		if (role !== "user" && role !== "assistant") continue;

		const text = extractText(content);
		if (!text) continue;

		const label = role === "user" ? "User" : "Assistant";
		parts.push(`${label}: ${text}`);
	}

	return parts.join("\n\n");
}

function extractText(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.filter((c: any) => c.type === "text" && c.text)
		.map((c: any) => c.text)
		.join("\n")
		.trim();
}
