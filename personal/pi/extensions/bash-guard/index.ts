/**
 * Bash Guard — Adversarial Security Review Extension
 *
 * Intercepts bash tool calls and runs 5 parallel security reviews using
 * Claude Haiku 4.5 (via the user's configured model registry). Based on vote consensus:
 *
 *   Unanimous YES  → auto-allow (notification, or debug dialog)
 *   Unanimous NO   → markdown dialog with explanation + override
 *   Split / mixed  → markdown dialog with explanation + override
 *
 * Timeouts and errors count as abstentions (ignored in vote tally).
 * Toggle with `/guard on|off|debug`. Not exposed as a tool — LLM cannot disable it.
 *
 * Override memory: when the user overrides a NO/split decision, the command is
 * recorded. Exact repeat commands are auto-allowed with a notification. Past
 * overrides are provided as context to voters so they can learn user preferences.
 */

import {
	complete,
	type Model,
	type TextContent,
	type ThinkingContent,
	type ToolCall,
	type ToolResultMessage,
	type UserMessage,
} from "@mariozechner/pi-ai";
import {
	isToolCallEventType,
	DynamicBorder,
	getMarkdownTheme,
	type ExtensionAPI,
	type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Container, Markdown, matchesKey, Key, Spacer, Text } from "@mariozechner/pi-tui";

// ── Configuration ────────────────────────────────────────────────────────────

/** Number of votes per available model. Total voters = available models × this. */
const VOTES_PER_MODEL = 5;
const VOTE_TIMEOUT_MS = 5000;

const EXPLAINER_PROVIDER = "anthropic";
const EXPLAINER_MODEL_ID = "claude-haiku-4-5";
const EXPLAINER_CONTEXT_MESSAGES = 20;

const VOTER_SYSTEM_PROMPT = `You are a security reviewer. Your only job is to review a single bash command and decide if it is safe.

You will receive a bash command inside <command> tags. The message may also include <previous_decisions> showing commands the user previously reviewed and explicitly allowed despite security concerns. These decisions represent the user's explicit intent and should carry significant weight in your review. If the command under review is similar in nature, scope, or target to a previously allowed command, you should vote YES. Only vote NO if the command is substantially more dangerous than what the user has already approved — for example, targeting a different sensitive path, adding network exfiltration, or escalating scope far beyond prior approvals.

Review the command in <command> tags and respond with a single word: YES or NO. Do not explain. Do not add any other text.

YES means: the command is safe to run on a developer's machine.
NO means: the command is unsafe or risky.

Guidelines for your review:
- Deleting or overwriting files or directories → NO
- Accessing or exposing credentials, keys, tokens → NO
- Network requests to untrusted or unexpected endpoints → NO
- Installing software from untrusted sources → NO
- Irreversible or destructive operations → NO
- Privilege escalation (sudo, chmod 777) → NO
- Modifying system configuration or services → NO
- Modifying global or user-wide config (--global flags, writing to $HOME dotfiles, global installs) → NO
- Reading files, listing directories, running tests, building projects, installing declared project dependencies, git read operations, text processing → YES`;

const EXPLAINER_SYSTEM_PROMPT = `You are reviewing a bash command that an AI coding assistant is attempting to execute. A panel of security reviewers flagged this command.

Based on the conversation context provided, respond in exactly this format:

**What it does:** One sentence describing what the command does.

**Why it's being run:** One sentence explaining why the assistant is trying to run it, referencing the user's request.

**Risk:** One sentence flagging any potential risks or confirming it's safe.

Be factual and concise. Do not add any other text outside this format.`;

// ── Safe-command whitelist ────────────────────────────────────────────────────

const SAFE_COMMAND_PATTERNS: RegExp[] = [
	/^\s*ls\b/, /^\s*cat\b/, /^\s*echo\b/, /^\s*printf\b/,
	/^\s*pwd\s*$/, /^\s*whoami\s*$/, /^\s*date\b/,
	/^\s*head\b/, /^\s*tail\b/, /^\s*wc\b/,
	/^\s*grep\b/, /^\s*rg\b/,
	// find/fd omitted: -exec, -delete can run/delete anything
	// awk omitted: system() builtin, internal file I/O
	// sort omitted: -o flag writes to files
	/^\s*which\b/, /^\s*type\b/, /^\s*file\b/, /^\s*stat\b/,
	/^\s*du\b/, /^\s*df\b/, /^\s*tree\b/, /^\s*man\b/, /^\s*diff\b/,
	/^\s*md5(sum)?\b/, /^\s*sha\d+sum\b/,
	/^\s*uniq\b/, /^\s*cut\b/, /^\s*tr\b/, /^\s*jq\b/,
	/^\s*git\s+(status|log|diff|show|branch|tag|remote|stash\s+list|config\s+--get)\b/,
	/^\s*cd\b/, /^\s*basename\b/, /^\s*dirname\b/, /^\s*realpath\b/, /^\s*readlink\b/,
	/^\s*env\s*$/, /^\s*printenv\b/, /^\s*uname\b/, /^\s*id\s*$/,
	/^\s*hostname\b/, /^\s*nproc\s*$/, /^\s*free\b/, /^\s*uptime\s*$/,
	/^\s*test\b/, /^\s*\[\s/,
];

/** Hoisted guard patterns for shell metacharacters that disqualify whitelist. */
const UNSAFE_SHELL_CHARS = /[|;&`\n]/;
const SUBSHELL_PATTERN = /\$\(/;
const REDIRECT_PATTERN = />{1,2}/;

function isWhitelisted(command: string): boolean {
	// Collapse line-continuations and stray newlines into spaces so that
	// long paths wrapped by the LLM don't trigger the \n guard.
	const trimmed = command.trim().replace(/\\\n\s*/g, "").replace(/\n\s*/g, " ");
	if (UNSAFE_SHELL_CHARS.test(trimmed)) return false;
	if (SUBSHELL_PATTERN.test(trimmed)) return false;
	if (REDIRECT_PATTERN.test(trimmed)) return false;
	return SAFE_COMMAND_PATTERNS.some((p) => p.test(trimmed));
}

// ── Shared helpers ───────────────────────────────────────────────────────────

/** Minimal theme interface for type safety instead of `any`. */
interface Theme {
	fg(style: string, text: string): string;
	bold(text: string): string;
}

function truncateCmd(command: string, max = 80): string {
	return command.length > max ? command.slice(0, max - 3) + "..." : command;
}

/** Extract text content from any message content array. Accepts wide input, filters internally. */
function extractText(content: ReadonlyArray<{ type: string; text?: string }>, sep = ""): string {
	return content
		.filter((c): c is TextContent => c.type === "text" && typeof c.text === "string")
		.map((c) => c.text)
		.join(sep);
}

function countVotes(records: ReadonlyArray<VoterRecord>) {
	let yes = 0, no = 0, pending = 0, abstained = 0;
	for (const r of records) {
		switch (r.status) {
			case "yes": yes++; break;
			case "no": no++; break;
			case "pending": pending++; break;
			default: abstained++; break;
		}
	}
	return { yes, no, pending, abstained, decided: yes + no };
}

/** Create a themed border component. */
function border(theme: Theme) {
	return new DynamicBorder((s: string) => theme.fg("borderAccent", s));
}

// ── Types ────────────────────────────────────────────────────────────────────

type VoteStatus = "pending" | "yes" | "no" | "timeout" | "error";

/** Status display metadata lookup table. */
const STATUS_META: Record<VoteStatus, { icon: string; style: string; debugLabel: string }> = {
	pending: { icon: "○", style: "dim", debugLabel: "…  " },
	yes:     { icon: "●", style: "success", debugLabel: "YES" },
	no:      { icon: "●", style: "error", debugLabel: "NO " },
	timeout: { icon: "◌", style: "warning", debugLabel: "TMO" },
	error:   { icon: "◌", style: "warning", debugLabel: "ERR" },
};

interface VoterRecord {
	label: string;
	status: VoteStatus;
	durationMs: number;
	error?: string;
}

interface VoteResult {
	records: VoterRecord[];
	yesCount: number;
	noCount: number;
	decidedCount: number;
	abstentions: number;
	unanimous: "yes" | "no" | null;
	cancelled: boolean;
	durationMs: number;
}

interface VoterModel {
	model: Model<any>;
	apiKey: string;
	label: string;
}

interface VoteOverride {
	command: string;
	outcome: "split" | "no";
	voteBreakdown: string;
	timestamp: number;
}

// ── Voter model resolution ───────────────────────────────────────────────────

let cachedVoterModels: VoterModel[] | null = null;
let overrideHistory: VoteOverride[] = [];

async function resolveVoterModels(ctx: ExtensionContext): Promise<VoterModel[]> {
	if (cachedVoterModels) return cachedVoterModels;

	const candidates: Array<{ provider: string; id: string; label: string }> = [
		{ provider: "anthropic", id: "claude-haiku-4-5", label: "haiku-4.5" },
	];

	const available: VoterModel[] = [];
	for (const candidate of candidates) {
		try {
			const model = ctx.modelRegistry.find(candidate.provider, candidate.id);
			if (!model) continue;
			const apiKey = await ctx.modelRegistry.getApiKey(model);
			if (apiKey) available.push({ model, apiKey, label: candidate.label });
		} catch {}
	}
	cachedVoterModels = available;
	return available;
}

function distributeVoters(voterModels: VoterModel[]): VoterModel[] {
	if (voterModels.length === 0) return [];
	const count = voterModels.length * VOTES_PER_MODEL;
	return Array.from({ length: count }, (_, i) => voterModels[i % voterModels.length]);
}

// ── Single vote ──────────────────────────────────────────────────────────────

function buildVoterMessage(command: string, overrides: ReadonlyArray<VoteOverride>): string {
	const parts: string[] = [];
	if (overrides.length > 0) {
		parts.push("<previous_decisions>");
		for (const o of overrides) {
			parts.push("<decision>");
			parts.push(`<command>${o.command}</command>`);
			parts.push(`<vote_outcome>${o.outcome === "no" ? "unanimous NO" : "split"} (${o.voteBreakdown})</vote_outcome>`);
			parts.push(`<user_decision>allowed</user_decision>`);
			parts.push("</decision>");
		}
		parts.push("</previous_decisions>");
		parts.push("");
	}
	parts.push(`<command>${command}</command>`);
	return parts.join("\n");
}


async function castVote(
	voter: VoterModel,
	command: string,
	overrides: ReadonlyArray<VoteOverride>,
	parentSignal?: AbortSignal,
): Promise<VoterRecord> {
	const t0 = performance.now();
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), VOTE_TIMEOUT_MS);

	const onParentAbort = () => controller.abort();
	parentSignal?.addEventListener("abort", onParentAbort, { once: true });

	try {
		const response = await complete(
			voter.model,
			{
				systemPrompt: VOTER_SYSTEM_PROMPT,
				messages: [{
					role: "user" as const,
					content: [{ type: "text" as const, text: buildVoterMessage(command, overrides) }],
					timestamp: Date.now(),
				}],
			},
			{ apiKey: voter.apiKey, maxTokens: 256, signal: controller.signal },
		);

		const ms = performance.now() - t0;

		if (response.stopReason === "error") {
			return { label: voter.label, status: "error", durationMs: ms, error: response.errorMessage ?? "API error" };
		}

		const text = extractText(response.content).trim().toUpperCase();
		if (text.startsWith("YES")) return { label: voter.label, status: "yes", durationMs: ms };
		if (text.startsWith("NO")) return { label: voter.label, status: "no", durationMs: ms };
		return { label: voter.label, status: "error", durationMs: ms, error: `Unexpected: "${text.slice(0, 40)}" (stop: ${response.stopReason})` };
	} catch (e: any) {
		const ms = performance.now() - t0;
		const msg = e?.message ?? String(e);
		if (controller.signal.aborted && !parentSignal?.aborted) {
			return { label: voter.label, status: "timeout", durationMs: ms, error: msg };
		}
		return { label: voter.label, status: "error", durationMs: ms, error: msg };
	} finally {
		clearTimeout(timer);
		parentSignal?.removeEventListener("abort", onParentAbort);
	}
}

// ── Vote result computation ──────────────────────────────────────────────────

function computeVoteResult(records: VoterRecord[], cancelled: boolean, durationMs: number): VoteResult {
	const { yes, no, decided, abstained } = countVotes(records);

	let unanimous: "yes" | "no" | null = null;
	if (decided > 0 && yes === decided) unanimous = "yes";
	else if (decided > 0 && no === decided) unanimous = "no";

	return { records, yesCount: yes, noCount: no, decidedCount: decided, abstentions: abstained, unanimous, cancelled, durationMs };
}

/** Format voter errors for notification. Computed inline at the single use site. */
function formatVoterErrors(records: ReadonlyArray<VoterRecord>, max = 3): string[] {
	const errors: string[] = [];
	for (const r of records) {
		if (r.error && errors.length < max) errors.push(`[${r.label}] ${r.error}`);
	}
	return errors;
}

// ── Render helpers ───────────────────────────────────────────────────────────

function renderVoteIcons(records: ReadonlyArray<VoterRecord>, theme: Theme): string {
	return records.map((r) => {
		const meta = STATUS_META[r.status];
		return theme.fg(meta.style, meta.icon);
	}).join(" ");
}

function renderVoteSummary(records: ReadonlyArray<VoterRecord>, theme: Theme): string {
	const { yes, no, pending, abstained } = countVotes(records);
	const sep = theme.fg("dim", " · ");
	const parts: string[] = [];
	if (yes > 0) parts.push(theme.fg("success", `${yes} YES`));
	if (no > 0) parts.push(theme.fg("error", `${no} NO`));
	if (pending > 0) parts.push(theme.fg("dim", `${pending} pending`));
	if (abstained > 0) parts.push(theme.fg("warning", `${abstained} abstained`));
	return parts.join(sep);
}

/** Single-pass: builds table rows and accumulates per-model stats together. */
function renderDebugTable(records: VoterRecord[], theme: Theme): string {
	const lines: string[] = [];
	lines.push(theme.fg("dim", "  ┄┄ Debug ┄┄"));

	const byModel = new Map<string, { total: number; count: number }>();

	for (let i = 0; i < records.length; i++) {
		const r = records[i];
		const meta = STATUS_META[r.status];
		const idx = theme.fg("dim", `  #${i + 1}`);
		const label = theme.fg("muted", r.label.padEnd(16));
		const ms = theme.fg("dim", `${Math.round(r.durationMs)}ms`.padStart(6));
		const status = theme.fg(meta.style, meta.debugLabel);

		let line = `${idx} ${label} ${status}  ${ms}`;
		if (r.error) line += `  ${theme.fg("dim", r.error.slice(0, 40))}`;
		lines.push(line);

		if (r.status !== "pending") {
			const entry = byModel.get(r.label) ?? { total: 0, count: 0 };
			entry.total += r.durationMs;
			entry.count++;
			byModel.set(r.label, entry);
		}
	}

	if (byModel.size > 0) {
		const entries = Array.from(byModel.entries())
			.map(([label, { total, count }]) => ({ label, avg: Math.round(total / count) }));
		let fastest = Infinity;
		for (const e of entries) if (e.avg < fastest) fastest = e.avg;
		const avgs = entries
			.map((e) => {
				const text = `${e.label} ${e.avg}ms`;
				return e.avg === fastest ? theme.fg("muted", theme.bold(text)) : theme.fg("muted", text);
			})
			.join(theme.fg("dim", " · "));
		lines.push(`  ${theme.fg("dim", "Avg:")} ${avgs}`);
	}

	return lines.join("\n");
}

/**
 * Shared container scaffolding. Returns container + dynamic text refs.
 * Callers that don't need live updates can ignore the text refs.
 */
function buildDialogContainer(
	theme: Theme,
	header: string,
	command: string,
	records: ReadonlyArray<VoterRecord>,
): { container: Container; voteIconsText: Text; voteSummaryText: Text } {
	const container = new Container();
	container.addChild(border(theme));
	container.addChild(new Spacer(1));
	container.addChild(new Text("  " + theme.fg("accent", theme.bold(header)), 1, 0));
	container.addChild(new Spacer(1));
	container.addChild(new Text("  " + theme.fg("muted", "$ ") + theme.fg("warning", truncateCmd(command)), 1, 0));
	container.addChild(new Spacer(1));

	const voteIconsText = new Text("  " + renderVoteIcons(records, theme), 1, 0);
	container.addChild(voteIconsText);
	const voteSummaryText = new Text("  " + renderVoteSummary(records, theme), 1, 0);
	container.addChild(voteSummaryText);

	return { container, voteIconsText, voteSummaryText };
}

// ── Vote tracking UI ─────────────────────────────────────────────────────────

async function runVoteTracking(
	ctx: ExtensionContext,
	command: string,
	voters: VoterModel[],
	overrides: ReadonlyArray<VoteOverride>,
): Promise<VoteResult> {
	/** Headless: no abort signal (each voter has its own timeout). */
	if (!ctx.hasUI) {
		const t0 = performance.now();
		const records = await Promise.all(voters.map((voter) => castVote(voter, command, overrides)));
		return computeVoteResult(records, false, performance.now() - t0);
	}

	return ctx.ui.custom<VoteResult>((tui, theme, _kb, done) => {
		const records: VoterRecord[] = voters.map((v) => ({
			label: v.label, status: "pending" as VoteStatus, durationMs: 0,
		}));
		const abortController = new AbortController();
		const t0 = performance.now();
		let finished = false;

		const { container, voteIconsText, voteSummaryText } = buildDialogContainer(
			theme, "🔒 Security Review", command, records,
		);

		const errorText = new Text("", 1, 0);
		container.addChild(errorText);
		container.addChild(new Spacer(1));
		container.addChild(new Text("  " + theme.fg("dim", "esc to cancel"), 1, 0));
		container.addChild(new Spacer(1));
		container.addChild(border(theme));

		const repaint = () => { container.invalidate(); tui.requestRender(); };

		const refresh = () => {
			voteIconsText.setText("  " + renderVoteIcons(records, theme));
			voteSummaryText.setText("  " + renderVoteSummary(records, theme));
			const firstErr = records.find((r) => r.error);
			if (firstErr) errorText.setText("  " + theme.fg("error", `Error: ${firstErr.error}`));
			repaint();
		};

		const finalize = () => {
			if (finished) return;
			finished = true;
			done(computeVoteResult(records, false, performance.now() - t0));
		};

		let remaining = voters.length;
		for (let i = 0; i < voters.length; i++) {
			const idx = i;
			castVote(voters[idx], command, overrides, abortController.signal).then((record) => {
				if (finished) return;
				records[idx] = record;
				remaining--;
				refresh();
				if (remaining === 0) finalize();
			});
		}

		return {
			render: (w: number) => container.render(w),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				if (matchesKey(data, Key.escape) && !finished) {
					finished = true;
					abortController.abort();
					done(computeVoteResult(records, true, performance.now() - t0));
				}
			},
		};
	});
}

// ── Explainer ────────────────────────────────────────────────────────────────

/** Try preferred explainer model, then fall back to ctx.model. Both with reasoning disabled. */
async function resolveExplainerModel(
	ctx: ExtensionContext,
): Promise<{ model: Model<any>; apiKey: string } | null> {
	const candidates: Array<Model<any> | null | undefined> = [
		(() => { try { return ctx.modelRegistry.find(EXPLAINER_PROVIDER, EXPLAINER_MODEL_ID); } catch { return null; } })(),
		ctx.model,
	];

	for (const model of candidates) {
		if (!model) continue;
		try {
			const apiKey = await ctx.modelRegistry.getApiKey(model);
			if (apiKey) return { model: { ...model, reasoning: false }, apiKey };
		} catch {}
	}
	return null;
}

async function getExplanation(
	ctx: ExtensionContext,
	command: string,
	voteResult: VoteResult,
): Promise<string> {
	const explainer = await resolveExplainerModel(ctx);
	if (!explainer) return "Unable to generate explanation — no model available.";

	const branch = ctx.sessionManager.getBranch();
	const recentEntries = branch.slice(-EXPLAINER_CONTEXT_MESSAGES);

	const contextLines: string[] = [];
	for (const entry of recentEntries) {
		if (entry.type !== "message" || !("role" in entry.message)) continue;
		const msg = entry.message;

		if (msg.role === "user") {
			const text = extractText(msg.content as ReadonlyArray<{ type: string; text?: string }>, "\n");
			if (text) contextLines.push(`<message role="user">${text}</message>`);
		} else if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") {
					const tp = part as TextContent;
					if (tp.text) contextLines.push(`<message role="assistant">${tp.text}</message>`);
				} else if (part.type === "thinking") {
					const tp = part as ThinkingContent;
					contextLines.push(`<thinking>${tp.thinking}</thinking>`);
				} else if (part.type === "toolCall") {
					const tp = part as ToolCall;
					contextLines.push(`<tool_call name="${tp.name}">${JSON.stringify(tp.arguments, null, 2)}</tool_call>`);
				}
			}
		} else if (msg.role === "toolResult") {
			const tr = msg as ToolResultMessage;
			const text = extractText(tr.content as ReadonlyArray<{ type: string; text?: string }>, "\n");
			const truncated = text.length > 500 ? text.slice(0, 500) + "\n…(truncated)" : text;
			contextLines.push(`<tool_result name="${tr.toolName}"${tr.isError ? ' error="true"' : ""}>${truncated}</tool_result>`);
		}
	}

	const userMessage: UserMessage = {
		role: "user",
		content: [{
			type: "text",
			text: [
				`<context>`, ...contextLines, `</context>`, ``,
				`<command>${command}</command>`, ``,
				`Security review results: ${voteResult.yesCount} YES, ${voteResult.noCount} NO` +
					(voteResult.abstentions > 0 ? `, ${voteResult.abstentions} abstained` : "") +
					` (out of ${voteResult.records.length} reviewers).`, ``,
				`Based on the conversation context, explain what this command does, why the assistant is trying to run it, and flag any risks.`,
			].join("\n"),
		}],
		timestamp: Date.now(),
	};

	try {
		const response = await complete(
			explainer.model,
			{ systemPrompt: EXPLAINER_SYSTEM_PROMPT, messages: [userMessage] },
			{ apiKey: explainer.apiKey, maxTokens: 300 },
		);
		return extractText(response.content, "\n").trim();
	} catch {
		return "Unable to generate explanation.";
	}
}

// ── Unified review dialog ────────────────────────────────────────────────────

async function showReviewDialog(
	ctx: ExtensionContext,
	command: string,
	result: VoteResult,
	header: string,
	debugEnabled: boolean,
	interactive: boolean,
): Promise<{ allowed: boolean; explanation: string }> {
	return ctx.ui.custom<{ allowed: boolean; explanation: string }>((tui, theme, _kb, done) => {
		const mdTheme = getMarkdownTheme();
		let explanationText = "";
		let resolved = false;

		const { container } = buildDialogContainer(theme, header, command, result.records);
		container.addChild(new Spacer(1));

		const explanationMd = new Markdown(theme.fg("dim", "⏳ Analyzing command…"), 2, 0, mdTheme);
		container.addChild(explanationMd);

		const debugText = new Text("", 1, 0);
		container.addChild(debugText);
		if (debugEnabled) {
			debugText.setText("\n" + renderDebugTable(result.records, theme));
		}

		container.addChild(new Spacer(1));
		container.addChild(new Text(
			interactive
				? "  " + theme.fg("dim", "y") + theme.fg("muted", " allow  ") + theme.fg("dim", "n/esc") + theme.fg("muted", " block")
				: "  " + theme.fg("dim", "press any key to continue"),
			1, 0,
		));
		container.addChild(new Spacer(1));
		container.addChild(border(theme));

		const repaint = () => { container.invalidate(); tui.requestRender(); };

		// getExplanation never rejects (internal try/catch), so .catch is defensive only
		getExplanation(ctx, command, result).then((text) => {
			explanationText = text;
			explanationMd.setText(text);
			repaint();
		});

		return {
			render: (w: number) => container.render(w),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				if (resolved) return;
				if (interactive) {
					if (data === "y" || data === "Y") { resolved = true; done({ allowed: true, explanation: explanationText }); }
					else if (data === "n" || data === "N" || matchesKey(data, Key.escape)) { resolved = true; done({ allowed: false, explanation: explanationText }); }
				} else {
					resolved = true;
					done({ allowed: true, explanation: explanationText });
				}
			},
		};
	});
}

// ── Extension entry point ────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let guardEnabled = true;
	let debugEnabled = false;

	function updateStatus(ctx: ExtensionContext) {
		const t = ctx.ui.theme;
		if (!guardEnabled) ctx.ui.setStatus("bash-guard", t.fg("dim", "🔓 guard off"));
		else if (debugEnabled) ctx.ui.setStatus("bash-guard", t.fg("success", "🔒 guard") + " " + t.fg("dim", "🔍"));
		else ctx.ui.setStatus("bash-guard", t.fg("success", "🔒 guard"));
	}

	/** Append-only persistence. Restore reads last entry only (reverse scan). */
	function persistState() {
		pi.appendEntry("bash-guard-state", { guardEnabled, debugEnabled });
	}

	pi.registerCommand("guard", {
		description: "Toggle bash guard (on/off/debug)",
		getArgumentCompletions: (prefix: string) => {
			const opts = ["on", "off", "debug"];
			const filtered = opts.filter((o) => o.startsWith(prefix));
			return filtered.length > 0 ? filtered.map((o) => ({ value: o, label: o })) : null;
		},
		handler: async (args, ctx) => {
			const arg = args?.trim().toLowerCase();
			if (arg === "on") guardEnabled = true;
			else if (arg === "off") guardEnabled = false;
			else if (arg === "debug") debugEnabled = !debugEnabled;
			else guardEnabled = !guardEnabled;

			persistState();
			updateStatus(ctx);
			ctx.ui.notify(
				arg === "debug"
					? (debugEnabled ? "🔍 Debug mode enabled" : "🔍 Debug mode disabled")
					: (guardEnabled ? "🔒 Bash guard enabled" : "🔓 guard disabled"),
				"info",
			);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const entries = ctx.sessionManager.getEntries();

		// Restore last persisted guard state (reverse scan, break on first match)
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (entry.type === "custom" && entry.customType === "bash-guard-state") {
				const data = entry.data as { guardEnabled?: boolean; debugEnabled?: boolean };
				if (data.guardEnabled !== undefined) guardEnabled = data.guardEnabled;
				if (data.debugEnabled !== undefined) debugEnabled = data.debugEnabled;
				break;
			}
		}

		// Restore override history (forward scan, collect all)
		overrideHistory = [];
		for (const entry of entries) {
			if (entry.type === "custom" && entry.customType === "bash-guard-override") {
				overrideHistory.push(entry.data as VoteOverride);
			}
		}

		// Invalidate voter model cache (new session may have different keys)
		cachedVoterModels = null;
		updateStatus(ctx);
	});

	// ── Main hook ──
	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return;
		if (!guardEnabled) return;

		const command = event.input.command;
		if (isWhitelisted(command)) return;

		const previousOverride = overrideHistory.find((o) => o.command === command);
		if (previousOverride) {
			if (ctx.hasUI) {
				ctx.ui.notify(`✅ Previously allowed (${previousOverride.voteBreakdown}) — skipping review`, "info");
			}
			return;
		}

		const voterModels = await resolveVoterModels(ctx);

		if (voterModels.length === 0) {
			if (!ctx.hasUI) {
				return { block: true, reason: "Bash guard: no voter models available and no UI." };
			}
			const ok = await ctx.ui.confirm(
				"🔒 Bash Guard",
				`No fast review models available. Allow this command?\n\n  $ ${command}`,
			);
			if (!ok) return { block: true, reason: "Blocked by user (no review models)." };
			return;
		}

		const voters = distributeVoters(voterModels);
		const result = await runVoteTracking(ctx, command, voters, overrideHistory);

		// Surface voter errors inline
		const voterErrors = formatVoterErrors(result.records);
		if (voterErrors.length > 0 && ctx.hasUI) {
			ctx.ui.notify(`⚠️ Voter errors:\n${voterErrors.join("\n")}`, "warning");
		}

		if (result.cancelled) {
			return { block: true, reason: "Security review cancelled by user." };
		}

		const elapsed = `${(result.durationMs / 1000).toFixed(1)}s`;
		const voteBreakdown =
			`${result.yesCount} YES / ${result.noCount} NO` +
			(result.abstentions > 0 ? ` / ${result.abstentions} abstained` : "");

		// ── Unanimous YES ──
		if (result.unanimous === "yes") {
			if (ctx.hasUI && debugEnabled) {
				const header = `✅ Security review passed (${result.decidedCount}/${result.records.length}) in ${elapsed}`;
				await showReviewDialog(ctx, command, result, header, true, false);
			} else if (ctx.hasUI) {
				const detail = result.abstentions > 0
					? `${result.yesCount} YES, ${result.abstentions} abstained`
					: `${result.yesCount}/${result.records.length}`;
				ctx.ui.notify(`✅ Security review passed (${detail}) in ${elapsed}`, "info");
			}
			return;
		}

		// ── Unanimous NO or Split vote ──
		if (!ctx.hasUI) {
			const label = result.unanimous === "no" ? "unanimously rejected" : "inconclusive";
			return {
				block: true,
				reason: `Security review ${label} (${voteBreakdown}). Blocked in non-interactive mode.`,
			};
		}

		const icon = result.unanimous === "no" ? "⛔" : "⚠️";
		const header = result.unanimous === "no"
			? `${icon} Command blocked (${result.noCount}/${result.decidedCount} NO) in ${elapsed}`
			: `${icon} Split vote (${voteBreakdown}) in ${elapsed}`;

		const { allowed, explanation } = await showReviewDialog(ctx, command, result, header, debugEnabled, true);

		if (allowed) {
			const override: VoteOverride = {
				command,
				outcome: result.unanimous === "no" ? "no" : "split",
				voteBreakdown: `${result.yesCount} YES / ${result.noCount} NO`,
				timestamp: Date.now(),
			};
			overrideHistory.push(override);
			pi.appendEntry("bash-guard-override", override);
			ctx.ui.notify(`⚠️ User override — allowed despite ${voteBreakdown}`, "warning");
			return;
		}

		return {
			block: true,
			reason: `Security review: ${voteBreakdown}. User declined.`
				+ (explanation ? ` Explanation: ${explanation}` : ""),
		};
	});
}
