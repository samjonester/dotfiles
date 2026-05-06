/**
 * Persistent Memory Extension
 *
 * Gives pi a personal memory bank that persists across sessions.
 * Inspired by shopify-playground/brain's memory bank system.
 *
 * On session start: loads activeProjects.md, dailyContext.md, and
 * all knowledge files. Archives dailyContext.md when the date rolls over.
 *
 * On agent_end / session_before_switch / session_shutdown: auto-persists
 * a one-line summary of completed work to dailyContext.md's Completed
 * section when the agent hasn't already called memory_update or
 * memory_append. Filters out trivial sessions (<3 assistant turns) and
 * subagent runs.
 *
 * Injection is configurable via /memory config or ~/.pi/memory/config.json.
 * Each content type has an independent frequency:
 *   activeProjects: "every-turn" (default) | "first-turn" | "off"
 *   dailyContext:   "every-turn" (default) | "first-turn" | "off"
 *   knowledge:      "every-turn" (default) | "first-turn" | "off"
 *   history:        "every-turn" (default) | "first-turn" | "off"
 *
 * Provides tools for the agent to read/update/search memory bank files
 * and a /memory command to inspect current state.
 *
 * Memory bank location: ~/.pi/memory/
 *   core/activeProjects.md  — active work and priorities
 *   core/dailyContext.md    — today's work, decisions, carry-forward
 *   knowledge/              — reference docs
 *   knowledge/index.csv     — trigger-word index (optional, for future use)
 *   history/daily/          — archived dailyContext by date
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { MemoryIndex } from "./search.js";
import { QMDSearch } from "./qmd-search.js";

const MEMORY_ROOT = process.env.PI_MEMORY_DIR ?? path.join(os.homedir(), ".pi", "memory");
const CORE_DIR = path.join(MEMORY_ROOT, "core");
const KNOWLEDGE_DIR = path.join(MEMORY_ROOT, "knowledge");
const HISTORY_DIR = path.join(MEMORY_ROOT, "history", "daily");

// ── Search Index ─────────────────────────────────────────────────

const memoryIndex = new MemoryIndex(MEMORY_ROOT);
const qmdSearch = new QMDSearch();

// ── Injection Config + State ─────────────────────────────────────────

type Frequency = "every-turn" | "first-turn" | "off";
const VALID_FREQUENCIES: Frequency[] = ["every-turn", "first-turn", "off"];

export interface InjectionConfig {
	activeProjects: Frequency;
	dailyContext: Frequency;
	knowledge: Frequency;
	history: Frequency;
}

const CONFIG_KEYS: (keyof InjectionConfig)[] = ["activeProjects", "dailyContext", "knowledge", "history"];

export const DEFAULT_CONFIG: InjectionConfig = {
	activeProjects: "every-turn",
	dailyContext: "every-turn",
	knowledge: "every-turn",
	history: "every-turn",
};

const CONFIG_PATH = path.join(MEMORY_ROOT, "config.json");

export function loadConfig(): InjectionConfig {
	try {
		const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
		const inj = raw?.injection ?? {};
		const result = { ...DEFAULT_CONFIG };
		for (const key of CONFIG_KEYS) {
			if (VALID_FREQUENCIES.includes(inj[key])) {
				result[key] = inj[key];
			}
		}
		return result;
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

export function saveConfig(config: InjectionConfig): void {
	let file: Record<string, unknown> = {};
	try {
		file = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
	} catch {}
	file.injection = { ...config };
	fs.writeFileSync(CONFIG_PATH, JSON.stringify(file, null, 2) + "\n", "utf-8");
}

/** Determine if a content type should be injected this turn */
export function shouldInject(setting: Frequency, alreadyInjected: boolean): boolean {
	if (setting === "off") return false;
	if (setting === "first-turn" && alreadyInjected) return false;
	return true;
}

let config: InjectionConfig = loadConfig();
const injectedTypes: Record<keyof InjectionConfig, boolean> = {
	activeProjects: false,
	dailyContext: false,
	knowledge: false,
	history: false,
};

// ── Helpers ──────────────────────────────────────────────────────

function ensureDirs() {
	for (const dir of [CORE_DIR, KNOWLEDGE_DIR, HISTORY_DIR]) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

function readIfExists(filePath: string): string | null {
	try {
		return fs.readFileSync(filePath, "utf-8");
	} catch {
		return null;
	}
}

function today(): string {
	return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/** Extract the date from dailyContext.md's "## Date" or first line */
function extractDate(content: string): string | null {
	const match = content.match(/^##?\s*(?:Date:?\s*)?(\d{4}-\d{2}-\d{2})/m);
	return match?.[1] ?? null;
}

/** Archive yesterday's dailyContext and start fresh */
function archiveDailyContext(): { archived: boolean; archivePath?: string } {
	const dailyPath = path.join(CORE_DIR, "dailyContext.md");
	const content = readIfExists(dailyPath);
	if (!content) return { archived: false };

	const fileDate = extractDate(content);
	if (!fileDate || fileDate === today()) return { archived: false };

	// Archive to history/daily/YYYY-MM/YYYY-MM-DD-dailyContext.md
	const ym = fileDate.slice(0, 7);
	const archiveDir = path.join(HISTORY_DIR, ym);
	fs.mkdirSync(archiveDir, { recursive: true });

	const archivePath = path.join(archiveDir, `${fileDate}-dailyContext.md`);
	fs.writeFileSync(archivePath, content, "utf-8");

	// Reset dailyContext with today's date and carry-forward section
	const carryForward = extractSection(content, "Context for Tomorrow") ?? "";
	const fresh = [
		`## ${today()}`,
		"",
		"### Current Session",
		"- Starting new session",
		"",
		...(carryForward
			? ["### Carried Forward", carryForward, ""]
			: []),
		"### In Progress",
		"",
		"### Completed",
		"",
		"### Key Decisions",
		"",
		"### Context for Tomorrow",
		"",
	].join("\n");

	fs.writeFileSync(dailyPath, fresh, "utf-8");
	return { archived: true, archivePath };
}

/** Extract a markdown section by heading */
function extractSection(content: string, heading: string): string | null {
	const regex = new RegExp(`^###?\\s+${heading}\\s*$`, "m");
	const match = content.match(regex);
	if (!match || match.index === undefined) return null;

	const start = match.index + match[0].length;
	const nextHeading = content.slice(start).search(/^###?\s+/m);
	const section = nextHeading === -1
		? content.slice(start)
		: content.slice(start, start + nextHeading);

	return section.trim() || null;
}

// ── Auto-Persist ─────────────────────────────────────────────────

/** AgentMessage type alias (duck-typed for minimal coupling) */
type AnyMessage = Record<string, any>;

/**
 * Analyse messages from an agent run and produce a one-line summary for
 * dailyContext.md's Completed section, or null if nothing meaningful happened.
 *
 * Skips if:
 *   - Fewer than 3 assistant turns (trivial / no real work)
 *   - The agent already called memory_update or memory_append (already persisted)
 *   - The session is a subagent run (first user message starts with "Task:" or agent frontmatter)
 *   - No tool calls that indicate file changes or significant commands
 */
function extractSessionSummary(messages: AnyMessage[]): string | null {
	// Require at least 3 assistant messages (multi-turn = real work)
	const assistantMessages = messages.filter((m) => m.role === "assistant");
	if (assistantMessages.length < 3) return null;

	// If the agent manually touched memory, trust it and skip auto-persist
	const memoryAlreadyUpdated = messages.some(
		(m) =>
			m.role === "toolResult" &&
			(m.toolName === "memory_update" || m.toolName === "memory_append"),
	);
	if (memoryAlreadyUpdated) return null;

	// Pull the first user prompt as the session description
	const firstUserMsg = messages.find((m) => m.role === "user");
	const rawPrompt = firstUserMsg
		? typeof firstUserMsg.content === "string"
			? firstUserMsg.content
			: Array.isArray(firstUserMsg.content)
				? (firstUserMsg.content.find((c: AnyMessage) => c.type === "text")
						?.text ?? "")
				: ""
		: "";

	// Skip subagent runs — they produce high-volume, low-value entries
	// (e.g., 5 identical review-* subagent summaries for one PR review).
	// Detection: the subagent tool injects the task as "Task: ..." and/or
	// agent definition frontmatter as "---\nname: ..."
	const trimmed = rawPrompt.trimStart();
	if (trimmed.startsWith("Task:") || /^---\r?\nname:/m.test(trimmed)) {
		return null;
	}
	const promptExcerpt = rawPrompt.replace(/\n/g, " ").trim().slice(0, 80);

	// Walk all assistant tool calls and collect file changes + bash commands
	const modifiedFiles = new Set<string>();
	const significantCmds: string[] = [];

	for (const msg of assistantMessages) {
		if (!Array.isArray(msg.content)) continue;
		for (const block of msg.content as AnyMessage[]) {
			if (block.type !== "toolCall") continue;
			const name: string = block.name ?? "";
			const args: AnyMessage = block.arguments ?? {};

			if (name === "write" || name === "edit") {
				const p: string = args.path ?? args.file ?? "";
				if (p) modifiedFiles.add(path.basename(p));
			} else if (name === "bash") {
				// Grab first line of the command, strip trivial invocations
				const cmd = (args.command ?? "").split("\n")[0].trim().slice(0, 60);
				if (cmd.length > 3 && !cmd.startsWith("#") && !cmd.startsWith("echo")) {
					significantCmds.push(cmd);
				}
			}
		}
	}

	// Nothing actionable happened
	if (modifiedFiles.size === 0 && significantCmds.length === 0) return null;

	// Build the summary line
	const parts: string[] = [];
	if (promptExcerpt) parts.push(`"${promptExcerpt}"`);
	if (modifiedFiles.size > 0) {
		parts.push(`modified: ${[...modifiedFiles].slice(0, 3).join(", ")}`);
	}
	if (significantCmds.length > 0) {
		// Most telling command is usually the first meaningful one
		parts.push(`ran: ${significantCmds[0]}`);
	}

	return `- [auto] ${parts.join(" — ")}`;
}

/**
 * Append a text entry to the "Completed" section of dailyContext.md.
 * Uses the same logic as the memory_append tool.
 */
function appendToCompleted(text: string): void {
	const filePath = path.join(CORE_DIR, "dailyContext.md");
	const content = readIfExists(filePath);
	if (!content) return;

	const regex = /^(###?\s+Completed\s*)$/m;
	const match = content.match(regex);
	if (!match || match.index === undefined) return;

	const insertPoint = match.index + match[0].length;
	const after = content.slice(insertPoint);
	const nextHeading = after.search(/^###?\s+/m);

	let updated: string;
	if (nextHeading === -1) {
		updated = content.trimEnd() + "\n" + text + "\n";
	} else {
		const before = content.slice(0, insertPoint + nextHeading);
		const rest = content.slice(insertPoint + nextHeading);
		updated = before.trimEnd() + "\n" + text + "\n\n" + rest;
	}

	fs.writeFileSync(filePath, updated, "utf-8");
}

/** Scaffold default memory bank files if they don't exist */
function scaffold() {
	ensureDirs();

	const activeProjectsPath = path.join(CORE_DIR, "activeProjects.md");
	if (!fs.existsSync(activeProjectsPath)) {
		fs.writeFileSync(
			activeProjectsPath,
			[
				"# Active Projects",
				"",
				"<!-- Format: - [Project Name] (P0-P4) - path/or/description - [aliases] -->",
				"",
				"## P0 — Critical",
				"",
				"## P1 — High",
				"",
				"## P2 — Medium",
				"",
				"## P3 — Low",
				"",
			].join("\n"),
			"utf-8",
		);
	}

	const dailyContextPath = path.join(CORE_DIR, "dailyContext.md");
	if (!fs.existsSync(dailyContextPath)) {
		fs.writeFileSync(
			dailyContextPath,
			[
				`## ${today()}`,
				"",
				"### Current Session",
				"- First session with memory bank",
				"",
				"### In Progress",
				"",
				"### Completed",
				"",
				"### Key Decisions",
				"",
				"### Context for Tomorrow",
				"",
			].join("\n"),
			"utf-8",
		);
	}

	const indexPath = path.join(KNOWLEDGE_DIR, "index.csv");
	if (!fs.existsSync(indexPath)) {
		fs.writeFileSync(
			indexPath,
			"filename,description,trigger_words\n",
			"utf-8",
		);
	}
}

// ── Extension ────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	scaffold();

	// Build search index on load
	memoryIndex.build();

	// Track the most recent agent messages so session_before_switch /
	// session_shutdown can access them without receiving them directly.
	let lastAgentMessages: AnyMessage[] = [];
	let lastAgentPersisted = false;

	// ── Session Start: archive stale dailyContext + rebuild index ──
	pi.on("session_start", async (_event, ctx) => {
		config = loadConfig();
		for (const key of CONFIG_KEYS) injectedTypes[key] = false;

		// Reset per-session auto-persist tracking
		lastAgentMessages = [];
		lastAgentPersisted = false;

		const archive = archiveDailyContext();
		if (archive.archived) {
			ctx.ui.notify(`Archived previous dailyContext → ${archive.archivePath}`, "info");
		}
		// Rebuild MiniSearch index (always needed as fallback)
		const count = memoryIndex.build();

		// Check if qmd is available for enhanced search
		qmdSearch.resetAvailability();
		if (qmdSearch.available) {
			// Re-index so qmd picks up any files changed outside the session
			qmdSearch.updateIndex();
			ctx.ui.notify(`Memory search: qmd (semantic) + MiniSearch fallback | ${count} documents`, "info");
		} else {
			ctx.ui.notify(`Memory search index: ${count} documents`, "info");
		}
	});

	// ── After Compaction: reset injection flags so memory is re-injected ──
	pi.on("session_compact", async (_event, _ctx) => {
		for (const key of CONFIG_KEYS) injectedTypes[key] = false;
	});

	// ── Agent End: auto-persist if agent didn't update memory ──
	pi.on("agent_end", async (event, ctx) => {
		lastAgentMessages = event.messages ?? [];
		lastAgentPersisted = false;

		try {
			const summary = extractSessionSummary(lastAgentMessages);
			if (summary) {
				appendToCompleted(summary);
				lastAgentPersisted = true;
				ctx.ui.notify("[memory] Auto-saved session summary to dailyContext.md", "info");
			}
		} catch (err) {
			// Never let auto-persist crash the session
			ctx.ui.notify(`[memory] Auto-persist failed: ${err}`, "warning");
		}
	});

	// ── Session Before Switch: flush any un-persisted summary ──
	pi.on("session_before_switch", async (_event, ctx) => {
		if (lastAgentPersisted || lastAgentMessages.length === 0) return;

		try {
			const summary = extractSessionSummary(lastAgentMessages);
			if (summary) {
				appendToCompleted(summary);
				lastAgentPersisted = true;
				ctx.ui.notify("[memory] Auto-saved session summary before switch", "info");
			}
		} catch {
			// Silent — we're mid-switch, don't block it
		}
	});

	// ── Session Shutdown: last-chance flush ──
	pi.on("session_shutdown", async (_event, _ctx) => {
		if (lastAgentPersisted || lastAgentMessages.length === 0) return;

		try {
			const summary = extractSessionSummary(lastAgentMessages);
			if (summary) {
				appendToCompleted(summary);
			}
		} catch {
			// Silent — we're exiting
		}
	});

	// ── Before Agent Start: inject memory context ──
	pi.on("before_agent_start", async (event, _ctx) => {
		const injectAP = shouldInject(config.activeProjects, injectedTypes.activeProjects);
		const injectDC = shouldInject(config.dailyContext, injectedTypes.dailyContext);
		const injectKnowledge = shouldInject(config.knowledge, injectedTypes.knowledge);
		const injectHistory = shouldInject(config.history, injectedTypes.history);

		// Nothing to inject this turn
		if (!injectAP && !injectDC && !injectKnowledge && !injectHistory) return;

		const parts: string[] = ["# Memory Bank Context\n"];

		if (injectAP) {
			const activeProjects = readIfExists(path.join(CORE_DIR, "activeProjects.md"));
			if (activeProjects) parts.push("## Active Projects\n", activeProjects, "");
		}
		if (injectDC) {
			const dailyContext = readIfExists(path.join(CORE_DIR, "dailyContext.md"));
			if (dailyContext) parts.push("## Daily Context\n", dailyContext, "");
		}

		// Search-based injection for knowledge and history.
		// Always use MiniSearch (in-memory BM25, ~0ms) for context injection —
		// qmd's hybrid search (BM25 + vector + LLM re-ranking) blocks for 1-2s
		// per invocation, which creates a noticeable lag on every prompt.
		// qmd is still used for explicit memory_search tool calls where latency
		// is acceptable and semantic quality matters more.
		if (injectKnowledge || injectHistory) {
			const hits = memoryIndex.searchForContext(event.prompt, 3, undefined, { includeKnowledge: injectKnowledge, includeHistory: injectHistory });

			if (hits.length > 0) {
				parts.push("## Relevant Knowledge\n");
				for (const hit of hits) {
					parts.push(`--- ${hit.path} (score: ${Math.round(hit.score)}) ---\n${hit.content}\n`);
				}
			}
		}

		// Mark types as injected AFTER successful construction (avoids
		// permanently skipping injection if an error occurs above)
		if (injectAP) injectedTypes.activeProjects = true;
		if (injectDC) injectedTypes.dailyContext = true;
		if (injectKnowledge) injectedTypes.knowledge = true;
		if (injectHistory) injectedTypes.history = true;

		return {
			message: {
				customType: "memory-context",
				content: parts.join("\n"),
				display: false,
			},
		};
	});

	// ── Tool: memory_read ──
	pi.registerTool({
		name: "memory_read",
		label: "Memory Read",
		description:
			"Read a file from the persistent memory bank. Use to check activeProjects, dailyContext, knowledge files, or daily history.",
		promptSnippet: "Read persistent memory bank files (activeProjects, dailyContext, knowledge, history)",
		parameters: Type.Object({
			file: Type.String({
				description:
					"Relative path within ~/.pi/memory/ — e.g. core/activeProjects.md, core/dailyContext.md, knowledge/index.csv, history/daily/2025-03/2025-03-03-dailyContext.md",
			}),
		}),
		async execute(_toolCallId, params) {
			const filePath = path.resolve(MEMORY_ROOT, params.file);
			// Safety: stay inside MEMORY_ROOT
			if (!filePath.startsWith(MEMORY_ROOT)) {
				return {
					content: [{ type: "text", text: "Error: path must be within the memory bank directory." }],
					isError: true,
				};
			}
			const content = readIfExists(filePath);
			if (content === null) {
				return {
					content: [{ type: "text", text: `File not found: ${params.file}` }],
					isError: true,
				};
			}
			return { content: [{ type: "text", text: content }] };
		},
	});

	// ── Tool: memory_update ──
	pi.registerTool({
		name: "memory_update",
		label: "Memory Update",
		description:
			"Update a file in the persistent memory bank. Use to maintain activeProjects.md, dailyContext.md, or knowledge files across sessions.",
		promptSnippet: "Update persistent memory bank files (activeProjects, dailyContext, knowledge)",
		promptGuidelines: [
			// ── Core rules ──
			"Update dailyContext.md throughout the session: log completed work, decisions, and carry-forward items.",
			"Update activeProjects.md when project status changes (new projects, completed work, priority shifts).",
			"When updating dailyContext.md sections, APPEND to existing entries — never overwrite the whole section.",
			"Keep dailyContext.md under 150 lines. Keep activeProjects.md under 50 lines.",

			// ── Proactive knowledge capture ──
			"When the user establishes conventions, tone/voice rules, architectural decisions, workflow preferences, " +
				"or any reusable guidance — immediately store it as a knowledge file in knowledge/<name>.md. " +
				"Don't wait to be asked. Knowledge files are for things that should survive beyond today. " +
				"If you'd need to re-derive it in a future session, it belongs in knowledge/.",

			// ── Knowledge file discipline ──
			"Knowledge files should be concise: target 10-50 lines, max 100 lines. If a knowledge file grows past " +
				"100 lines, split it into focused files. Each file should cover one topic or convention.",
			"Include source attribution in knowledge files: who said it, when, and where (PR, Slack thread, meeting). " +
				"Add a '## Source' section at the bottom.",
			"If a pattern looks like a multi-step workflow (3+ steps that repeat), it belongs as a Skill, not a knowledge file.",

			// ── Word budgets ──
			"dailyContext entries must be concise: Completed items 15-25 words, Key Decisions 10-20 words, " +
				"activeProjects one line per project. Use progressive refinement: draft full, then shorten.",

			// ── No redundancy between sections ──
			"Each fact belongs in exactly one dailyContext section. Completed = actions taken (what you did). " +
				"Key Decisions = outcomes decided (what was resolved, with rationale). " +
				"Don't repeat the same information across sections. If a meeting produced a decision, " +
				"Completed says 'Held meeting with X' and Key Decisions captures the outcome.",

			// ── Self-verification ──
			"Before modifying code, committing, or taking any irreversible action, consider: is there a knowledge " +
				"file about conventions for this area? If unsure, call memory_search with the relevant topic first. " +
				"This is especially important for: git conventions, component patterns, API design rules, and testing standards.",
		],
		parameters: Type.Object({
			file: Type.String({
				description:
					"Relative path within ~/.pi/memory/ — e.g. core/dailyContext.md, core/activeProjects.md, knowledge/git-rules.md",
			}),
			content: Type.String({ description: "Full file content to write" }),
		}),
		async execute(_toolCallId, params) {
			const filePath = path.resolve(MEMORY_ROOT, params.file);
			if (!filePath.startsWith(MEMORY_ROOT)) {
				return {
					content: [{ type: "text", text: "Error: path must be within the memory bank directory." }],
					isError: true,
				};
			}
			fs.mkdirSync(path.dirname(filePath), { recursive: true });
			fs.writeFileSync(filePath, params.content, "utf-8");

			// Keep search indexes in sync
			memoryIndex.updateDocument(params.file);
			qmdSearch.updateIndex();

			return {
				content: [{ type: "text", text: `Updated ${params.file} (${params.content.length} bytes)` }],
			};
		},
	});

	// ── Tool: memory_append ──
	pi.registerTool({
		name: "memory_append",
		label: "Memory Append",
		description:
			"Append text to a section in a memory bank file. Safer than memory_update for adding entries to dailyContext.md without overwriting.",
		promptSnippet: "Append entries to a section in a memory bank file",
		parameters: Type.Object({
			file: Type.String({
				description: "Relative path within ~/.pi/memory/ — e.g. core/dailyContext.md",
			}),
			section: Type.String({
				description: 'Section heading to append to — e.g. "Completed", "In Progress", "Key Decisions"',
			}),
			text: Type.String({
				description: "Text to append (one entry per line, use - prefix for list items)",
			}),
		}),
		async execute(_toolCallId, params) {
			const filePath = path.resolve(MEMORY_ROOT, params.file);
			if (!filePath.startsWith(MEMORY_ROOT)) {
				return {
					content: [{ type: "text", text: "Error: path must be within the memory bank directory." }],
					isError: true,
				};
			}
			const content = readIfExists(filePath);
			if (content === null) {
				return {
					content: [{ type: "text", text: `File not found: ${params.file}` }],
					isError: true,
				};
			}

			// Find the section and insert before the next heading
			const regex = new RegExp(`^(###?\\s+${params.section}\\s*)$`, "m");
			const match = content.match(regex);
			if (!match || match.index === undefined) {
				return {
					content: [{ type: "text", text: `Section "${params.section}" not found in ${params.file}` }],
					isError: true,
				};
			}

			const insertPoint = match.index + match[0].length;
			const after = content.slice(insertPoint);
			const nextHeading = after.search(/^###?\s+/m);

			let updated: string;
			if (nextHeading === -1) {
				// Last section — append at end
				updated = content.trimEnd() + "\n" + params.text + "\n";
			} else {
				// Insert before next heading
				const before = content.slice(0, insertPoint + nextHeading);
				const rest = content.slice(insertPoint + nextHeading);
				updated = before.trimEnd() + "\n" + params.text + "\n\n" + rest;
			}

			fs.writeFileSync(filePath, updated, "utf-8");

			// Keep search indexes in sync
			memoryIndex.updateDocument(params.file);
			qmdSearch.updateIndex();

			return {
				content: [{ type: "text", text: `Appended to "${params.section}" in ${params.file}` }],
			};
		},
	});

	// ── Tool: memory_search ──
	pi.registerTool({
		name: "memory_search",
		label: "Memory Search",
		description:
			"Search across all memory bank files — knowledge, daily history, and core files. " +
			"Uses semantic search (qmd) when available, with BM25 fuzzy fallback. " +
			"Use to find past decisions, recall context from previous sessions, or discover relevant knowledge files.",
		promptSnippet: "Search across all memory bank files (knowledge, history, core) with fuzzy full-text search",
		parameters: Type.Object({
			query: Type.String({
				description: "Search query — natural language or keywords. Fuzzy matching handles typos and partial words.",
			}),
			limit: Type.Optional(
				Type.Number({ description: "Max results to return (default 5)" }),
			),
		}),
		async execute(_toolCallId, params) {
			const limit = params.limit ?? 5;
			const useQmd = qmdSearch.available;

			// Prefer qmd hybrid search (semantic + BM25 + re-ranking) over MiniSearch
			const results = useQmd
				? qmdSearch.queryHybrid(params.query, limit)
				: memoryIndex.search(params.query, limit);

			if (results.length === 0) {
				// If qmd returned nothing, fall back to MiniSearch
				if (useQmd) {
					const fallback = memoryIndex.search(params.query, limit);
					if (fallback.length > 0) {
						const formatted = fallback
							.map((r, i) => [
								`${i + 1}. **${r.title}** (${r.category})`,
								`   Path: ${r.path} | Score: ${Math.round(r.score)}`,
								`   ${r.snippet}`,
							].join("\n"))
							.join("\n\n");
						return {
							content: [{ type: "text", text: `Found ${fallback.length} results for "${params.query}" (MiniSearch fallback):\n\n${formatted}` }],
						};
					}
				}
				return {
					content: [{ type: "text", text: `No results found for "${params.query}"` }],
				};
			}

			const backend = useQmd ? "qmd" : "MiniSearch";
			const formatted = results
				.map((r, i) => [
					`${i + 1}. **${r.title}** (${r.category})`,
					`   Path: ${r.path} | Score: ${Math.round(r.score)}`,
					`   ${r.snippet}`,
				].join("\n"))
				.join("\n\n");

			return {
				content: [{ type: "text", text: `Found ${results.length} results for "${params.query}" (${backend}):\n\n${formatted}` }],
			};
		},
	});

	// ── Tool: memory_list ──
	pi.registerTool({
		name: "memory_list",
		label: "Memory List",
		description: "List files in the memory bank. Use to discover available knowledge files and history archives.",
		promptSnippet: "List files in the persistent memory bank",
		parameters: Type.Object({
			directory: Type.Optional(
				Type.String({
					description:
						'Relative directory within ~/.pi/memory/ — e.g. "knowledge", "history/daily", "core". Defaults to root.',
				}),
			),
		}),
		async execute(_toolCallId, params) {
			const dir = path.resolve(MEMORY_ROOT, params.directory ?? ".");
			if (!dir.startsWith(MEMORY_ROOT)) {
				return {
					content: [{ type: "text", text: "Error: path must be within the memory bank directory." }],
					isError: true,
				};
			}
			try {
				const entries = listRecursive(dir, MEMORY_ROOT);
				if (entries.length === 0) {
					return { content: [{ type: "text", text: "(empty)" }] };
				}
				return { content: [{ type: "text", text: entries.join("\n") }] };
			} catch {
				return {
					content: [{ type: "text", text: `Directory not found: ${params.directory ?? "."}` }],
					isError: true,
				};
			}
		},
	});

	// ── Command: /memory ──
	pi.registerCommand("memory", {
		description: "Show memory bank status. Subcommands: '/memory config [key] [value]' to configure injection, '/memory setup-qmd' for semantic search.",
		handler: async (args, ctx) => {
			const trimmed = args.trim();

			// Sub-command: setup-qmd
			if (trimmed === "setup-qmd") {
				ctx.ui.notify("Setting up qmd for memory bank...", "info");
				const result = qmdSearch.setup(MEMORY_ROOT);
				ctx.ui.notify(result.message, result.success ? "info" : "error");
				return;
			}

			// Sub-command: config [key] [value]
			if (trimmed === "config" || trimmed.startsWith("config ")) {
				const configArgs = trimmed.slice(6).trim();

				// No args: show current config
				if (!configArgs) {
					const configLines = CONFIG_KEYS.map((k) => `  ${k.padEnd(16)} ${config[k]}`);
					ctx.ui.notify(
						`Memory injection config (${CONFIG_PATH}):\n\n` +
						configLines.join("\n") + "\n\n" +
						`Usage: /memory config <key> <value>\n` +
						`Values: every-turn | first-turn | off`,
						"info",
					);
					return;
				}

				const [key, ...rest] = configArgs.split(/\s+/);
				const value = rest.join(" ") as Frequency;

				if (!CONFIG_KEYS.includes(key as keyof InjectionConfig)) {
					ctx.ui.notify(`Unknown config key: "${key}". Valid keys: ${CONFIG_KEYS.join(", ")}`, "error");
					return;
				}

				const configKey = key as keyof InjectionConfig;

				// No value: show current value for this key
				if (!value) {
					ctx.ui.notify(`${configKey} = ${config[configKey]}`, "info");
					return;
				}

				if (!VALID_FREQUENCIES.includes(value)) {
					ctx.ui.notify(`Invalid value: "${value}". Must be one of: ${VALID_FREQUENCIES.join(", ")}`, "error");
					return;
				}

				config[configKey] = value;
				injectedTypes[configKey] = false; // reset so next turn uses new config
				saveConfig(config);
				ctx.ui.notify(`Set ${configKey} = ${value} (persisted to config.json)`, "info");
				return;
			}

			const activeProjects = readIfExists(path.join(CORE_DIR, "activeProjects.md"));
			const dailyContext = readIfExists(path.join(CORE_DIR, "dailyContext.md"));

			const lines: string[] = [`Memory bank: ${MEMORY_ROOT}`, ""];
			lines.push(`injection:         ${CONFIG_KEYS.map((k) => `${k}=${config[k]}`).join(", ")}`);

			lines.push(`activeProjects.md: ${activeProjects ? `${activeProjects.split("\n").length} lines` : "missing"}`);
			lines.push(`dailyContext.md:   ${dailyContext ? `${dailyContext.split("\n").length} lines` : "missing"}`);

			// Count knowledge files (all .md in knowledge/)
			let knowledgeCount = 0;
			try {
				knowledgeCount = fs.readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith(".md")).length;
			} catch {}
			lines.push(`knowledge files:   ${knowledgeCount}`);

			// Count history archives
			let archiveCount = 0;
			try {
				const months = fs.readdirSync(HISTORY_DIR);
				for (const month of months) {
					const monthDir = path.join(HISTORY_DIR, month);
					if (fs.statSync(monthDir).isDirectory()) {
						archiveCount += fs.readdirSync(monthDir).length;
					}
				}
			} catch {}
			lines.push(`daily archives:    ${archiveCount} files`);
			lines.push(`search index:      ${memoryIndex.documentCount} documents`);

			// QMD status
			qmdSearch.resetAvailability();
			if (qmdSearch.available) {
				lines.push(`search backend:    qmd (semantic + BM25 + re-ranking) ✓`);
			} else {
				lines.push(`search backend:    MiniSearch (BM25 keyword only)`);
				lines.push(`                   Run '/memory setup-qmd' to enable semantic search`);
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}

// ── Utils ────────────────────────────────────────────────────────

function listRecursive(dir: string, root: string, maxDepth = 3, depth = 0): string[] {
	if (depth >= maxDepth) return [];
	const entries: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		const rel = path.relative(root, full);
		if (entry.isDirectory()) {
			entries.push(`${rel}/`);
			entries.push(...listRecursive(full, root, maxDepth, depth + 1));
		} else {
			entries.push(rel);
		}
	}
	return entries;
}
