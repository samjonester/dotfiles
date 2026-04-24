/**
 * Context Viz Extension
 *
 * Adds `/context` — a graphical breakdown of the current context window by
 * category (like Claude Code's /context). Estimates tokens per category using
 * the same chars/4 heuristic pi uses internally, and renders a donut chart
 * plus a legend showing absolute tokens and percent-of-window.
 *
 * Categories:
 *   - system prompt       (ctx.getSystemPrompt())
 *   - user messages       (role: user)
 *   - assistant text      (assistant text blocks)
 *   - thinking            (assistant thinking blocks)
 *   - tool calls          (assistant toolCall blocks, args)
 *   - tool results        (role: toolResult)
 *   - bash executions     (role: bashExecution)
 *   - custom / extensions (role: custom, branchSummary, compactionSummary)
 *   - free                (contextWindow - used)
 *
 * Shows the authoritative number from `ctx.getContextUsage()` as "reported"
 * alongside the summed estimate, so the two can be compared.
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	Theme,
} from "@mariozechner/pi-coding-agent";
import { type Focusable, matchesKey, visibleWidth } from "@mariozechner/pi-tui";

/** Loose shape — we only touch role + content fields on messages. */
type AnyMessage = { role: string; [k: string]: any };

type CategoryKey =
	| "system"
	| "user"
	| "assistant"
	| "thinking"
	| "toolCalls"
	| "toolResults"
	| "bash"
	| "custom";

interface Category {
	key: CategoryKey;
	label: string;
	color: "accent" | "success" | "warning" | "error" | "text" | "dim";
	tokens: number;
}

const CATEGORY_ORDER: { key: CategoryKey; label: string; color: Category["color"] }[] =
	[
		{ key: "system", label: "system prompt", color: "accent" },
		{ key: "user", label: "user messages", color: "success" },
		{ key: "assistant", label: "assistant text", color: "warning" },
		{ key: "thinking", label: "thinking", color: "error" },
		{ key: "toolCalls", label: "tool calls", color: "accent" },
		{ key: "toolResults", label: "tool results", color: "success" },
		{ key: "bash", label: "bash executions", color: "warning" },
		{ key: "custom", label: "custom / summaries", color: "error" },
	];

function chars4(n: number): number {
	return Math.ceil(n / 4);
}

/** Token estimator, closely mirroring pi's internal heuristic. */
function categorize(message: AnyMessage): Partial<Record<CategoryKey, number>> {
	const out: Partial<Record<CategoryKey, number>> = {};
	switch (message.role) {
		case "user": {
			let chars = 0;
			const content = (message as unknown as { content: string | Array<{ type: string; text?: string }> })
				.content;
			if (typeof content === "string") chars = content.length;
			else if (Array.isArray(content)) {
				for (const b of content) {
					if (b.type === "text" && b.text) chars += b.text.length;
					if (b.type === "image") chars += 4800;
				}
			}
			out.user = chars4(chars);
			return out;
		}
		case "assistant": {
			const a = message as AssistantMessage;
			// content can be a plain string in imported/legacy sessions
			if (typeof (a.content as unknown) === "string") {
				out.assistant = chars4((a.content as unknown as string).length);
				return out;
			}
			let text = 0,
				think = 0,
				tool = 0;
			for (const block of a.content) {
				if (block.type === "text") text += block.text.length;
				else if (block.type === "thinking") think += block.thinking.length;
				else if (block.type === "toolCall")
					tool += block.name.length + JSON.stringify(block.arguments).length;
			}
			if (text) out.assistant = chars4(text);
			if (think) out.thinking = chars4(think);
			if (tool) out.toolCalls = chars4(tool);
			return out;
		}
		case "toolResult": {
			let chars = 0;
			if (typeof message.content === "string") chars = message.content.length;
			else if (Array.isArray(message.content))
				for (const b of message.content) {
					if (b.type === "text" && b.text) chars += b.text.length;
					if (b.type === "image") chars += 4800;
				}
			out.toolResults = chars4(chars);
			return out;
		}
		case "bashExecution": {
			out.bash = chars4(message.command.length + message.output.length);
			return out;
		}
		case "custom": {
			let chars = 0;
			if (typeof message.content === "string") chars = message.content.length;
			else if (Array.isArray(message.content))
				for (const b of message.content) {
					if (b.type === "text" && b.text) chars += b.text.length;
					if (b.type === "image") chars += 4800;
				}
			out.custom = chars4(chars);
			return out;
		}
		case "branchSummary":
		case "compactionSummary": {
			out.custom = chars4(message.summary.length);
			return out;
		}
	}
	return out;
}

interface Snapshot {
	cats: Category[];
	usedEst: number;
	reportedTokens: number | null;
	contextWindow: number;
	modelId: string;
	sessionName: string | undefined;
}

function snapshot(ctx: ExtensionCommandContext): Snapshot {
	const cats: Category[] = CATEGORY_ORDER.map((c) => ({ ...c, tokens: 0 }));
	const byKey = new Map(cats.map((c) => [c.key, c]));

	// System prompt
	try {
		const sp = ctx.getSystemPrompt?.() ?? "";
		byKey.get("system")!.tokens = chars4(sp.length);
	} catch {
		// ignore
	}

	// Walk the branch. Turn SessionEntry -> AgentMessage using role/type.
	for (const entry of ctx.sessionManager.getBranch() as any[]) {
		let msg: AnyMessage | undefined;
		if (entry.type === "message") {
			msg = entry.message;
		} else if (entry.type === "custom_message") {
			// Extension-injected message (counts as "custom")
			msg = { role: "custom", content: entry.content };
		} else if (entry.type === "branch_summary") {
			msg = { role: "branchSummary", summary: entry.summary };
		} else if (entry.type === "compaction") {
			msg = { role: "compactionSummary", summary: entry.summary };
		}
		if (!msg) continue;
		const parts = categorize(msg);
		for (const [k, v] of Object.entries(parts)) {
			const c = byKey.get(k as CategoryKey);
			if (c && v) c.tokens += v;
		}
	}

	const usedEst = cats.reduce((s, c) => s + c.tokens, 0);

	let usage: ReturnType<NonNullable<typeof ctx.getContextUsage>> | undefined;
	try {
		usage = ctx.getContextUsage?.();
	} catch {
		// getContextUsage can throw — degrade to estimate-only
	}
	const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
	const reportedTokens = usage?.tokens ?? null;

	return {
		cats,
		usedEst,
		reportedTokens,
		contextWindow,
		modelId: ctx.model?.id ?? "no-model",
		sessionName: ctx.sessionManager.getSessionName?.() ?? undefined,
	};
}

function fmt(n: number): string {
	if (n < 1000) return `${n}`;
	if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 2 : 1)}k`;
	return `${(n / 1_000_000).toFixed(2)}M`;
}

function pct(part: number, whole: number): string {
	/* istanbul ignore next -- defensive guard; callers always pass whole > 0 */
	if (whole <= 0) return "  –  ";
	const p = (part / whole) * 100;
	if (p < 0.1 && part > 0) return "<0.1%";
	return `${p.toFixed(p < 10 ? 1 : 0)}%`;
}

// ────────────────────────────────────────────────────────────────────────────
// Donut rendering
// ────────────────────────────────────────────────────────────────────────────

const DONUT_COLS = 34; // char width of donut region
const DONUT_ROWS = 15; // char height of donut region (odd so there's a center row)

/**
 * Cells are ~2x tall as wide, so we scale Y to get a round donut.
 *
 * centerText is plain strings; each row's color is picked per-line.
 */
function renderDonut(
	cats: Category[],
	free: number,
	denom: number,
	theme: Theme,
	centerText: { text: string; color: Category["color"] }[],
): string[] {
	const cx = (DONUT_COLS - 1) / 2;
	const cy = (DONUT_ROWS - 1) / 2;
	const rOuter = Math.min(cx, cy * 2) - 0.2;
	const rInner = rOuter * 0.55;

	// Build angular segments. Start at top (-π/2), clockwise.
	const total = Math.max(denom, 1);
	type Seg = { start: number; end: number; color: Category["color"] | "dim" };
	const segs: Seg[] = [];
	let angle = -Math.PI / 2;
	const pushSeg = (fraction: number, color: Seg["color"]) => {
		const span = fraction * 2 * Math.PI;
		segs.push({ start: angle, end: angle + span, color });
		angle += span;
	};
	for (const c of cats) {
		if (c.tokens > 0) pushSeg(c.tokens / total, c.color);
	}
	if (free > 0) pushSeg(free / total, "dim");

	const cellColor = (x: number, y: number): Seg["color"] | null => {
		const dx = x - cx;
		const dy = (y - cy) * 2;
		const r = Math.sqrt(dx * dx + dy * dy);
		if (r > rOuter || r < rInner) return null;
		let a = Math.atan2(dy, dx);
		if (a < -Math.PI / 2) a += 2 * Math.PI;
		for (const s of segs) if (a >= s.start && a < s.end) return s.color;
		return "dim";
	};

	// Pre-compute which rows carry center text and the column range each occupies.
	const textMid = Math.floor(cy);
	const textStart = textMid - Math.floor(centerText.length / 2);
	const textForRow = (y: number): { text: string; color: Category["color"]; x0: number; x1: number } | null => {
		const idx = y - textStart;
		if (idx < 0 || idx >= centerText.length) return null;
		const entry = centerText[idx];
		/* istanbul ignore next -- centerText entries always have non-empty text */
		if (!entry.text) return null;
		const w = entry.text.length;
		const x0 = Math.floor(cx - (w - 1) / 2);
		return { ...entry, x0, x1: x0 + w - 1 };
	};

	const lines: string[] = [];
	for (let y = 0; y < DONUT_ROWS; y++) {
		const txt = textForRow(y);
		let line = "";
		for (let x = 0; x < DONUT_COLS; x++) {
			if (txt && x >= txt.x0 && x <= txt.x1) {
				if (x === txt.x0) line += theme.fg(txt.color, txt.text);
				continue;
			}
			const color = cellColor(x, y);
			if (color === null) line += " ";
			else line += theme.fg(color, "█");
		}
		lines.push(line);
	}
	return lines;
}

class ContextVizOverlay implements Focusable {
	readonly width = 86;
	focused = false;

	constructor(
		private theme: Theme,
		private snap: Snapshot,
		private done: () => void,
	) {}

	handleInput(data: string): void {
		if (
			matchesKey(data, "escape") ||
			matchesKey(data, "return") ||
			matchesKey(data, "q") ||
			data === "q"
		) {
			this.done();
		}
	}

	invalidate(): void {}
	dispose(): void {}

	render(_width: number): string[] {
		const w = this.width;
		const th = this.theme;
		const innerW = w - 2;
		const lines: string[] = [];

		const pad = (s: string, len: number) => {
			const vis = visibleWidth(s);
			return s + " ".repeat(Math.max(0, len - vis));
		};
		const row = (content: string) =>
			th.fg("border", "│") + pad(content, innerW) + th.fg("border", "│");

		const { cats, usedEst, reportedTokens, contextWindow, modelId, sessionName } = this.snap;
		const denom = contextWindow > 0 ? contextWindow : usedEst || 1;

		lines.push(th.fg("border", `╭${"─".repeat(innerW)}╮`));
		const title = `📊 Context window — ${modelId}${sessionName ? ` · ${sessionName}` : ""}`;
		lines.push(row(" " + th.fg("accent", title)));
		lines.push(row(""));

		const free = Math.max(0, contextWindow - usedEst);

		// Center-of-donut text: big percent used + raw numbers.
		const usedForCenter = reportedTokens ?? usedEst;
		const pctStr = contextWindow > 0 ? pct(usedForCenter, contextWindow) : "–";
		const centerText: { text: string; color: Category["color"] }[] = [
			{ text: pctStr, color: "accent" },
			{ text: fmt(usedForCenter), color: "text" },
			{ text: contextWindow ? `/ ${fmt(contextWindow)}` : "used", color: "dim" },
		];

		// Render donut once, zip with legend rows on the right.
		const donutLines = renderDonut(cats, free, denom, th, centerText);

		// Build legend rows.
		const legendRows: string[] = [];
		const labelW = 20;
		const tokW = 8;
		const pctW = 7;
		legendRows.push(
			th.fg("dim", pad("category", labelW)) +
				th.fg("dim", pad("tokens", tokW)) +
				th.fg("dim", pad("%", pctW)),
		);
		for (const c of cats) {
			const swatch = th.fg(c.color, "●");
			const label = pad(`${swatch} ${c.label}`, labelW);
			const tokens = pad(fmt(c.tokens), tokW);
			const percent = pad(pct(c.tokens, denom), pctW);
			legendRows.push(label + tokens + percent);
		}
		if (contextWindow > 0) {
			const label = pad(`${th.fg("dim", "○")} free`, labelW);
			legendRows.push(label + pad(fmt(free), tokW) + pad(pct(free, denom), pctW));
		}

		// Zip donut rows with legend rows.
		const zipHeight = Math.max(donutLines.length, legendRows.length);
		for (let i = 0; i < zipHeight; i++) {
			/* istanbul ignore next -- donut always has >= legend rows */
			const left = donutLines[i] ?? " ".repeat(DONUT_COLS);
			const right = legendRows[i] ?? "";
			lines.push(row(" " + left + "  " + right));
		}

		lines.push(row(""));

		// Totals
		const sumLine =
			`${th.fg("text", "sum of parts: ")}${th.fg("accent", fmt(usedEst))}` +
			(contextWindow ? th.fg("dim", ` / ${fmt(contextWindow)} (${pct(usedEst, contextWindow)})`) : "");
		lines.push(row(" " + sumLine));

		if (reportedTokens !== null) {
			const reportedLine =
				`${th.fg("text", "reported:     ")}${th.fg("accent", fmt(reportedTokens))}` +
				(contextWindow
					? th.fg("dim", ` / ${fmt(contextWindow)} (${pct(reportedTokens, contextWindow)})`)
					: "");
			lines.push(row(" " + reportedLine));
			lines.push(
				row(
					" " +
						th.fg(
							"dim",
							"reported = last assistant usage + trailing estimate; sum = per-category estimate",
						),
				),
			);
		} else {
			lines.push(
				row(
					" " + th.fg("dim", "reported: unavailable (no assistant usage yet; estimate only)"),
				),
			);
		}

		lines.push(row(""));
		lines.push(row(" " + th.fg("dim", "Enter / Esc / q to close")));
		lines.push(th.fg("border", `╰${"─".repeat(innerW)}╯`));

		return lines;
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("context", {
		description: "Show a graphical breakdown of the current context window",
		handler: async (args, ctx) => {
			const snap = snapshot(ctx);
			const verb = args.trim().toLowerCase();

			if (verb === "print" || verb === "-p" || !ctx.hasUI) {
				// Plain-text fallback (non-interactive / JSON / print mode)
				const lines: string[] = [];
				lines.push(
					`context — ${snap.modelId}` +
						(snap.contextWindow ? ` (window ${fmt(snap.contextWindow)})` : ""),
				);
				for (const c of snap.cats) {
					lines.push(
						`  ${c.label.padEnd(20)} ${fmt(c.tokens).padStart(8)}  ${pct(c.tokens, snap.contextWindow || snap.usedEst || 1)}`,
					);
				}
				if (snap.contextWindow) {
					const free = Math.max(0, snap.contextWindow - snap.usedEst);
					lines.push(
						`  ${"free".padEnd(20)} ${fmt(free).padStart(8)}  ${pct(free, snap.contextWindow)}`,
					);
				}
				lines.push(
					`  sum=${fmt(snap.usedEst)}` +
						(snap.reportedTokens !== null ? `  reported=${fmt(snap.reportedTokens)}` : ""),
				);
				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}

			await ctx.ui.custom<void>(
				(_tui, theme, _keybindings, done) =>
					new ContextVizOverlay(theme, snap, () => done(undefined)),
				{ overlay: true },
			);
		},
	});
}
