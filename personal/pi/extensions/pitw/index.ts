/**
 * /btw — Quick ephemeral side questions for pi
 *
 * Inspired by Claude Code's /btw command. Ask a quick question using
 * your conversation context without polluting the main thread.
 *
 * Usage:
 *   /btw what does this function do?
 *   /btw is there a simpler way to write this?
 *   /btw what's the difference between X and Y?
 *
 * The response appears in a panel, rendered as Markdown.
 * Press Enter or Escape to dismiss. Nothing is persisted — zero trace
 * in your conversation history.
 *
 * Press 'c' to ask a follow-up question and continue the conversation.
 * Press 'n' to open a new pi session with the full Q&A context.
 */

import { complete, type Message } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, SessionEntry, Theme } from "@mariozechner/pi-coding-agent";
import { BorderedLoader, convertToLlm, getMarkdownTheme, serializeConversation } from "@mariozechner/pi-coding-agent";
import { type Component, Markdown, matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SYSTEM_PROMPT = `You are a helpful side-channel assistant. The user is asking a quick question while working on something else. Their recent session context is included below for reference.

Rules:
- Answer concisely and directly
- Use the session context when it's relevant, but draw on your full knowledge for anything else
- Do not suggest tool calls or actions — just answer the question
- Use markdown formatting for readability
- Keep responses focused — this is a quick aside, not a main task`;

/** Max conversation context chars to include (keeps token usage reasonable) */
const MAX_CONTEXT_CHARS = 80_000;

const PROMOTE_SYSTEM_PROMPT = `You are turning a side conversation into a prompt. The user had a quick /btw side chat and wants to bring it into their main coding session.

You are given:
1. The main session context (what they've been working on)
2. The /btw side conversation (questions and answers)

Generate a prompt that carries the user's original intent forward, with whatever the side conversation uncovered as supporting context. Follow this pattern:

1. Start with what the user wants to do (restate their original question/goal as a task)
2. Then include "Here's some context I found:" followed by the key information from the btw answers

Example: if the user asked "how does Redis TTL work" and got an explanation, output:
"Set up Redis caching with appropriate TTLs for the shop settings endpoint. Here's some context I found: [key points from the answer]"

Example: if the user asked "who is Tobi" and got a partial answer, output:
"Find out who Tobi is. Here's some context I found so far: [what was learned]"

Rules:
- Always carry the original intent forward, even if the btw answer was incomplete
- Include the substance of what was learned, not just "we discussed this"
- Keep it concise — this is a prompt, not an essay
- Do NOT use markdown formatting — plain text only
- Do NOT ask clarifying questions — just synthesize what you have

Output ONLY the prompt text. No preamble, no explanation, no wrapping quotes.`;

type BtwResult =
	| { action: "dismiss" }
	| { action: "new-session" }
	| { action: "continue"; followUp: string }
	| { action: "promote" };

export default function (pi: ExtensionAPI) {
	pi.registerCommand("btw", {
		description: "Quick ephemeral side question — leaves no trace in conversation",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/btw requires interactive mode", "error");
				return;
			}

			const question = args.trim();
			if (!question) {
				ctx.ui.notify("Usage: /btw <question>", "warning");
				return;
			}

			const model = ctx.model;
			if (!model) {
				ctx.ui.notify("No model selected", "error");
				return;
			}

			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok || !auth.apiKey) {
				ctx.ui.notify(auth.ok ? `No API key for ${model.provider}` : auth.error, "error");
				return;
			}

			// Gather conversation context from the current branch
			const branch = ctx.sessionManager.getBranch();
			const messages = branch
				.filter((entry): entry is SessionEntry & { type: "message" } => entry.type === "message")
				.map((entry) => entry.message);

			const llmMessages = convertToLlm(messages);
			let conversationText = serializeConversation(llmMessages);

			if (conversationText.length > MAX_CONTEXT_CHARS) {
				conversationText = "...(truncated)...\n" + conversationText.slice(-MAX_CONTEXT_CHARS);
			}

			const systemPrompt = `${SYSTEM_PROMPT}\n\n<conversation_context>\n${conversationText}\n</conversation_context>`;
			const cwd = ctx.cwd;

			// Conversation loop
			const btwMessages: Message[] = [];
			let currentQuestion = question;

			while (true) {
				// Add user question to conversation history
				btwMessages.push({
					role: "user",
					content: [{ type: "text", text: currentQuestion }],
					timestamp: Date.now(),
				});

				// Phase 1: Show loader while waiting for response
				const answer = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
					const loader = new BorderedLoader(tui, theme, `💬 btw: thinking…`);
					loader.onAbort = () => done(null);

					(async () => {
						try {
							const response = await complete(
								model,
								{ systemPrompt, messages: btwMessages },
								{
									apiKey: auth.apiKey!,
									headers: auth.headers,
									signal: loader.signal,
								},
							);

							if (response.stopReason === "aborted") {
								done(null);
								return;
							}

							const text = response.content
								.filter((c): c is { type: "text"; text: string } => c.type === "text")
								.map((c) => c.text)
								.join("\n");

							// DEBUGGING: Force async tick before calling done
							setTimeout(() => done(text), 0);
						} catch (err: unknown) {
							const msg = err instanceof Error ? err.message : String(err);
							if (!msg.includes("abort")) {
								setTimeout(() => done(`Error: ${msg}`), 0);
							} else {
								done(null);
							}
						}
					})();

					return loader;
				});

				if (answer === null) {
					ctx.ui.notify("Cancelled", "info");
					return;
				}

				// Add assistant response to conversation history
				btwMessages.push({
					role: "assistant",
					content: [{ type: "text", text: answer }],
					timestamp: Date.now(),
				});

				// Phase 2: Show the result panel
				const result = await ctx.ui.custom<BtwResult>((_tui, theme, _kb, done) => {
					return new BtwResultPanel(theme, btwMessages, done);
				});

				if (result?.action === "continue") {
					// Ask for follow-up question
					const followUp = await ctx.ui.input("Follow-up question:", "");
					if (!followUp) {
						ctx.ui.notify("Cancelled", "info");
						return;
					}
					currentQuestion = followUp;
					continue; // Loop back to ask the follow-up
				} else if (result?.action === "promote") {
					// Synthesize the btw conversation into a useful steer
					const steer = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
						const loader = new BorderedLoader(tui, theme, `💬 Synthesizing prompt…`);
						loader.onAbort = () => done(null);

						(async () => {
							try {
								const response = await complete(
									model,
									{
										systemPrompt: PROMOTE_SYSTEM_PROMPT,
										messages: [
											{
												role: "user",
												content: [{
													type: "text",
													text: `## Session context\n\n${conversationText}\n\n## /btw side conversation\n\n${formatBtwThread(btwMessages)}`,
												}],
												timestamp: Date.now(),
											},
										],
									},
									{
										apiKey: auth.apiKey!,
										headers: auth.headers,
										signal: loader.signal,
									},
								);

								if (response.stopReason === "aborted") {
									done(null);
									return;
								}

								const text = response.content
									.filter((c): c is { type: "text"; text: string } => c.type === "text")
									.map((c) => c.text)
									.join("\n");

								setTimeout(() => done(text), 0);
							} catch (err: unknown) {
								const msg = err instanceof Error ? err.message : String(err);
								if (!msg.includes("abort")) setTimeout(() => done(null), 0);
								else done(null);
							}
						})();

						return loader;
					});

					if (steer) {
						ctx.ui.setEditorText(steer);
						ctx.ui.notify("Prompt ready — edit and submit when ready", "info");
					} else {
						ctx.ui.notify("Cancelled", "info");
					}
					return;
				} else if (result?.action === "new-session") {
					// Spawn new terminal with full conversation context
					const fullContext = formatConversationForNewSession(btwMessages, cwd);
					spawnNewPiSession(fullContext, cwd);
					ctx.ui.notify("Opening new pi session in a new terminal…", "info");
					return;
				} else {
					// Dismiss
					return;
				}
			}
		},
	});
}

// ─── Formatters ──────────────────────────────────────────────────────

function formatBtwThread(messages: Message[]): string {
	const parts: string[] = [];
	for (const msg of messages) {
		const text = msg.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n");
		const label = msg.role === "user" ? "User" : "Assistant";
		parts.push(`**${label}:** ${text}`);
	}
	return parts.join("\n\n");
}

function formatConversationForNewSession(messages: Message[], cwd: string): string {
	const lines: string[] = [
		"# Context from /btw",
		"",
	];

	for (const msg of messages) {
		const text = msg.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n");

		if (msg.role === "user") {
			lines.push(`**Question:** ${text}`);
			lines.push("");
		} else if (msg.role === "assistant") {
			lines.push("**Answer:**");
			lines.push(text);
			lines.push("");
		}
	}

	lines.push(`**Working directory:** \`${cwd}\``);
	lines.push("");
	lines.push("---");
	lines.push("");
	lines.push("I opened this session to continue from the above /btw conversation.");
	lines.push("Wait for me to tell you what's next.");

	return lines.join("\n");
}

// ─── New Session Spawner ─────────────────────────────────────────────

function spawnNewPiSession(contextText: string, cwd: string) {
	const ts = Date.now();

	// Write context to a temp file
	const contextPath = join(tmpdir(), `btw-context-${ts}.md`);
	writeFileSync(contextPath, contextText);

	// Startup script reads context file as pi's initial prompt
	const esc = (s: string) => s.replace(/'/g, "'\\''");
	const scriptPath = join(tmpdir(), `btw-${ts}.sh`);
	writeFileSync(
		scriptPath,
		[
			"#!/bin/bash",
			`cd '${esc(cwd)}'`,
			`exec pi "$(cat '${esc(contextPath)}')"`,
		].join("\n"),
		{ mode: 0o755 },
	);

	const term = (process.env.TERM_PROGRAM || "").toLowerCase();

	if (term.includes("ghostty")) {
		const child = spawn("ghostty", ["-e", scriptPath], { detached: true, stdio: "ignore" });
		child.unref();
	} else if (term.includes("iterm")) {
		const child = spawn("osascript", [
			"-e",
			`tell application "iTerm2" to create window with default profile command "${scriptPath}"`,
		], { detached: true, stdio: "ignore" });
		child.unref();
	} else if (term.includes("wezterm")) {
		const child = spawn("wezterm", ["cli", "spawn", "--new-window", "--", scriptPath], { detached: true, stdio: "ignore" });
		child.unref();
	} else if (term.includes("kitty")) {
		const child = spawn("kitty", ["@", "launch", "--type=os-window", scriptPath], { detached: true, stdio: "ignore" });
		child.unref();
	} else {
		// macOS fallback: Terminal.app
		const child = spawn("osascript", [
			"-e",
			`tell application "Terminal" to do script "${scriptPath}"`,
		], { detached: true, stdio: "ignore" });
		child.unref();
	}
}

// ─── Result Panel ────────────────────────────────────────────────────

class BtwResultPanel implements Component {
	private markdowns: Array<{ role: "user" | "assistant"; markdown: Markdown; text: string }> = [];
	private theme: Theme;
	private done: (value: BtwResult) => void;

	constructor(theme: Theme, messages: Message[], done: (value: BtwResult) => void) {
		this.theme = theme;
		this.done = done;

		// Render each message
		for (const msg of messages) {
			const text = msg.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n");

			this.markdowns.push({
				role: msg.role as "user" | "assistant",
				markdown: new Markdown(text, 0, 0, getMarkdownTheme()),
				text,
			});
		}
	}

	handleInput(data: string): boolean {
		if (matchesKey(data, "return") || matchesKey(data, "escape")) {
			this.done({ action: "dismiss" });
			return true;
		}
		if (data === "c" || data === "C") {
			this.done({ action: "continue", followUp: "" });
			return true;
		}
		if (data === "p" || data === "P") {
			this.done({ action: "promote" });
			return true;
		}
		if (data === "n" || data === "N") {
			this.done({ action: "new-session" });
			return true;
		}
		return true;
	}

	render(width: number): string[] {
		const th = this.theme;
		const innerW = width - 2;
		const PAD = 2;
		const contentW = innerW - PAD * 2;
		const lines: string[] = [];

		const row = (content: string) => {
			const left = " ".repeat(PAD);
			const truncated = truncateToWidth(content, contentW);
			const vis = visibleWidth(truncated);
			const right = " ".repeat(Math.max(0, innerW - PAD - vis));
			return th.fg("border", "│") + left + truncated + right + th.fg("border", "│");
		};

		const emptyRow = () =>
			th.fg("border", "│") + " ".repeat(innerW) + th.fg("border", "│");

		// ── Header ──
		lines.push(th.fg("border", `╭${"─".repeat(innerW)}╮`));
		lines.push(row(th.fg("accent", th.bold("💬 btw"))));
		lines.push(emptyRow());

		// ── Conversation ──
		for (let i = 0; i < this.markdowns.length; i++) {
			const item = this.markdowns[i]!;

			if (item.role === "user") {
				// Question
				const qLines = wrapText(item.text, contentW - 2);
				for (const ql of qLines) {
					lines.push(row(th.fg("dim", th.italic(`> ${ql}`))));
				}
			} else {
				// Answer
				const mdLines = item.markdown.render(contentW);
				for (const ml of mdLines) {
					lines.push(row(ml));
				}
			}

			// Separator between Q&A pairs (but not after the last answer)
			if (item.role === "assistant" && i < this.markdowns.length - 1) {
				lines.push(emptyRow());
				lines.push(th.fg("border", "├" + "─".repeat(innerW) + "┤"));
				lines.push(emptyRow());
			} else if (item.role === "user") {
				lines.push(emptyRow());
			}
		}

		lines.push(emptyRow());

		// ── Footer ──
		const status = th.fg("dim", "Enter/Esc dismiss • ") +
			th.fg("accent", "c") + th.fg("dim", " continue • ") +
			th.fg("accent", "p") + th.fg("dim", " promote • ") +
			th.fg("accent", "n") + th.fg("dim", " new session");
		lines.push(row(status));
		lines.push(th.fg("border", `╰${"─".repeat(innerW)}╯`));

		return lines;
	}

	invalidate(): void {}
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** Simple word-wrap for a string to fit within a given width */
function wrapText(text: string, maxWidth: number): string[] {
	if (maxWidth <= 0) return [text];
	const words = text.split(/\s+/);
	const lines: string[] = [];
	let current = "";

	for (const word of words) {
		if (current.length === 0) {
			current = word;
		} else if (current.length + 1 + word.length <= maxWidth) {
			current += " " + word;
		} else {
			lines.push(current);
			current = word;
		}
	}
	if (current.length > 0) lines.push(current);
	return lines.length > 0 ? lines : [""];
}
