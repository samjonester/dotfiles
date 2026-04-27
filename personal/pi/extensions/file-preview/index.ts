/**
 * file-preview — Pi Extension
 *
 * Detects text-file paths in user messages and renders inline previews in
 * the chat between the user message and the assistant response.
 *
 * Supported types:
 * - JSON (`.json`)
 * - CSV/TSV (`.csv`, `.tsv`)
 * - Markdown (`.md`)
 * - YAML (`.yml`, `.yaml`)
 * - Diff/patch (`.diff`, `.patch`)
 * - Code (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rb`, `.go`, `.rs`, `.java`, `.sh`)
 *
 * Image previews are intentionally not supported. Pi v0.70.2 disables Kitty/
 * iTerm graphics protocols when running inside tmux (regardless of outer
 * terminal or `allow-passthrough` config); see upstream issue
 * https://github.com/badlogic/pi-mono/issues/2374. Until that lands, image
 * previews would only show a redundant fallback line, so this extension
 * skips images entirely.
 *
 * Behavior:
 * - Previews render collapsed by default (header only).
 * - Toggle expand/collapse with `ctrl+o` (pi's built-in `app.tools.expand`
 *   keybinding — pi globally toggles all custom message renderers'
 *   `expanded` flag, so we just respect it).
 *
 * Path detection:
 * - Absolute paths (`/Users/...`)
 * - Tilde-prefixed (`~/...` → `os.homedir()`)
 * - Relative paths (resolved against `process.cwd()`)
 * All gated by `fs.existsSync` to avoid false positives on casual mentions.
 *
 * Delivery: previews are sent as a custom message with `deliverAs: "nextTurn"`
 * which queues the message until the user's next turn. The agent-session then
 * appends pending nextTurn messages right after the user message in the prompt
 * sequence — so the preview renders between the user's text and the assistant
 * response.
 */

import type { ExtensionAPI, Theme } from "@mariozechner/pi-coding-agent";
import { getMarkdownTheme, highlightCode, getLanguageFromPath } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------- Configuration ----------

const MAX_TEXT_BYTES = 100 * 1024; // 100KB
const MAX_PATHS_PER_MESSAGE = 8;

// Per-type line caps when expanded (kept per-type for future tuning;
// all currently 100 lines / rows)
const CAP_JSON_LINES = 100;
const CAP_CSV_ROWS = 100;
const CAP_MARKDOWN_LINES = 100;
const CAP_CODE_LINES = 100;
const CAP_DIFF_LINES = 100;
const CAP_YAML_LINES = 100;

// ---------- Types ----------

type PreviewType = "json" | "csv" | "markdown" | "code" | "diff" | "yaml";

interface FilePreviewItem {
	type: PreviewType;
	path: string;
	displayPath: string;
	sizeBytes: number;
	lineCount: number;
	text: string;
}

interface FilePreviewDetails {
	items: FilePreviewItem[];
}

// ---------- Path detection ----------

const CODE_EXTS = new Set(["ts", "tsx", "js", "jsx", "py", "rb", "go", "rs", "java", "sh"]);

const SUPPORTED_EXT_REGEX = /\.(json|ya?ml|md|csv|tsv|ts|tsx|js|jsx|py|rb|go|rs|java|sh|diff|patch)$/i;

// Match path-like tokens (no spaces). Permissive — we validate via fs.existsSync.
// Accepts: /abs/path/file.ext, ~/rel/path/file.ext, relative/path/file.ext, ./rel.ext, ../rel.ext
const PATH_TOKEN_REGEX = /(?:^|[\s(`"'])((?:~|\.{0,2}\/|\/)?[\w./@\-+]+\.[a-zA-Z0-9]+)/g;

function classifyPath(filePath: string): PreviewType | null {
	const lower = filePath.toLowerCase();
	const m = lower.match(/\.([a-z0-9]+)$/);
	if (!m) return null;
	const ext = m[1];
	if (ext === "json") return "json";
	if (ext === "csv" || ext === "tsv") return "csv";
	if (ext === "md") return "markdown";
	if (ext === "yml" || ext === "yaml") return "yaml";
	if (ext === "diff" || ext === "patch") return "diff";
	if (CODE_EXTS.has(ext)) return "code";
	return null;
}

function resolvePath(token: string): string | null {
	let resolved: string;
	if (token.startsWith("~/") || token === "~") {
		resolved = path.join(os.homedir(), token.slice(2));
	} else if (token.startsWith("/")) {
		resolved = token;
	} else {
		resolved = path.resolve(process.cwd(), token);
	}
	try {
		const stat = fs.statSync(resolved);
		if (!stat.isFile()) return null;
		return resolved;
	} catch {
		return null;
	}
}

function detectPaths(text: string): string[] {
	const found = new Set<string>();
	let match: RegExpExecArray | null;
	PATH_TOKEN_REGEX.lastIndex = 0;
	while ((match = PATH_TOKEN_REGEX.exec(text)) !== null) {
		const token = match[1];
		if (!SUPPORTED_EXT_REGEX.test(token)) continue;
		const resolved = resolvePath(token);
		if (!resolved) continue;
		found.add(resolved);
		if (found.size >= MAX_PATHS_PER_MESSAGE) break;
	}
	return Array.from(found);
}

// ---------- Loading ----------

function shortenForDisplay(filePath: string): string {
	const home = os.homedir();
	if (filePath.startsWith(home)) return "~" + filePath.slice(home.length);
	return filePath;
}

function loadPreview(filePath: string): FilePreviewItem | null {
	let stat: fs.Stats;
	try {
		stat = fs.statSync(filePath);
	} catch {
		return null;
	}
	const type = classifyPath(filePath);
	if (!type) return null;
	if (stat.size > MAX_TEXT_BYTES) return null;
	try {
		const text = fs.readFileSync(filePath, "utf-8");
		return {
			type,
			path: filePath,
			displayPath: shortenForDisplay(filePath),
			sizeBytes: stat.size,
			lineCount: text.split("\n").length,
			text,
		};
	} catch {
		return null;
	}
}

// ---------- Formatting helpers ----------

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function truncateLines(text: string, cap: number): { body: string; truncated: number } {
	const lines = text.split("\n");
	if (lines.length <= cap) return { body: text, truncated: 0 };
	return { body: lines.slice(0, cap).join("\n"), truncated: lines.length - cap };
}

function formatJson(text: string): string {
	try {
		return JSON.stringify(JSON.parse(text), null, 2);
	} catch {
		return text;
	}
}

// Per-cell display cap — keeps a single long value from blowing out alignment
// for every row to the right. Cells longer than this are truncated with `…`.
const CSV_MAX_CELL_WIDTH = 40;

function formatCsv(text: string, sep: string): string {
	const rows = text
		.split(/\r?\n/)
		.filter((l) => l.length > 0)
		.slice(0, CAP_CSV_ROWS + 1) // +1 for header
		.map((line) => line.split(sep));
	if (rows.length === 0) return text;
	const widths: number[] = [];
	for (const row of rows) {
		for (let i = 0; i < row.length; i++) {
			const len = Math.min(row[i].length, CSV_MAX_CELL_WIDTH);
			widths[i] = Math.max(widths[i] ?? 0, len);
		}
	}
	const trunc = (s: string, w: number) => (s.length > w ? s.slice(0, Math.max(w - 1, 0)) + "…" : s);
	return rows
		.map((row) =>
			row
				.map((cell, i) => {
					const w = widths[i] ?? 0;
					const t = trunc(cell, w);
					return i < row.length - 1 ? t.padEnd(w) : t;
				})
				.join("  "),
		)
		.join("\n");
}

function formatCode(text: string, filePath: string, theme: Theme): string {
	const { body, truncated } = truncateLines(text, CAP_CODE_LINES);
	const lang = getLanguageFromPath(filePath);
	let highlighted: string[];
	try {
		highlighted = highlightCode(body, lang);
	} catch {
		highlighted = body.split("\n");
	}
	const totalLines = highlighted.length;
	const gutterWidth = String(totalLines).length;
	const numbered = highlighted
		.map((line, i) => `${theme.fg("dim", String(i + 1).padStart(gutterWidth))}  ${line}`)
		.join("\n");
	return truncated > 0
		? `${numbered}\n${theme.fg("dim", `... (${truncated} more lines)`)}`
		: numbered;
}

function highlightOrPlain(text: string, lang: string, truncated: number, theme: Theme): string {
	let highlighted: string[];
	try {
		highlighted = highlightCode(text, lang);
	} catch {
		highlighted = text.split("\n");
	}
	let out = highlighted.join("\n");
	if (truncated > 0) out += "\n" + theme.fg("dim", `... (${truncated} more lines)`);
	return out;
}

function formatDiff(text: string, theme: Theme): string {
	const { body, truncated } = truncateLines(text, CAP_DIFF_LINES);
	const lines = body.split("\n").map((line) => {
		if (line.startsWith("+++") || line.startsWith("---")) return theme.fg("muted", line);
		if (line.startsWith("@@")) return theme.fg("accent", line);
		if (line.startsWith("+")) return theme.fg("success", line);
		if (line.startsWith("-")) return theme.fg("error", line);
		return line;
	});
	const out = lines.join("\n");
	return truncated > 0 ? `${out}\n${theme.fg("dim", `... (${truncated} more lines)`)}` : out;
}

// ---------- Rendering ----------

function renderHeader(item: FilePreviewItem, theme: Theme, expanded: boolean): string {
	const icons: Record<PreviewType, string> = {
		json: "{}",
		csv: "📊",
		markdown: "📝",
		code: "</>",
		diff: "±",
		yaml: "≡",
	};
	const icon = icons[item.type] ?? "📎";
	const lineInfo = ` · ${item.lineCount}L`;
	const sizeInfo = ` · ${formatSize(item.sizeBytes)}`;
	const hint = expanded
		? theme.fg("dim", "  (ctrl+o to collapse)")
		: theme.fg("dim", "  (ctrl+o to expand)");
	return `${theme.fg("accent", "»")} ${theme.fg("muted", `${icon} ${item.displayPath}${lineInfo}${sizeInfo}`)}${hint}`;
}

function renderTextItem(
	item: FilePreviewItem,
	theme: Theme,
	expanded: boolean,
	container: Container,
): void {
	if (!expanded) return;

	switch (item.type) {
		case "json": {
			const pretty = formatJson(item.text);
			const { body, truncated } = truncateLines(pretty, CAP_JSON_LINES);
			container.addChild(new Text(highlightOrPlain(body, "json", truncated, theme), 1, 0));
			break;
		}
		case "csv": {
			const sep = item.path.toLowerCase().endsWith(".tsv") ? "\t" : ",";
			const formatted = formatCsv(item.text, sep);
			container.addChild(new Text(formatted, 1, 0));
			break;
		}
		case "markdown": {
			const { body, truncated } = truncateLines(item.text, CAP_MARKDOWN_LINES);
			container.addChild(new Markdown(body, 1, 0, getMarkdownTheme()));
			if (truncated > 0) {
				container.addChild(new Text(theme.fg("dim", `... (${truncated} more lines)`), 1, 0));
			}
			break;
		}
		case "code": {
			const formatted = formatCode(item.text, item.path, theme);
			container.addChild(new Text(formatted, 1, 0));
			break;
		}
		case "diff": {
			const formatted = formatDiff(item.text, theme);
			container.addChild(new Text(formatted, 1, 0));
			break;
		}
		case "yaml": {
			const { body, truncated } = truncateLines(item.text, CAP_YAML_LINES);
			container.addChild(new Text(highlightOrPlain(body, "yaml", truncated, theme), 1, 0));
			break;
		}
	}
}

// ---------- Extension entry ----------

export default function (pi: ExtensionAPI) {
	pi.on("input", async (event, _ctx) => {
		// Don't process extension-injected messages (loop guard)
		if (event.source === "extension") return { action: "continue" };

		if (!event.text) return { action: "continue" };

		const paths = detectPaths(event.text);
		if (paths.length === 0) return { action: "continue" };

		const items: FilePreviewItem[] = [];
		for (const p of paths) {
			const item = loadPreview(p);
			if (item) items.push(item);
		}
		if (items.length === 0) return { action: "continue" };

		const summary = items.map((i) => path.basename(i.path)).join(", ");

		pi.sendMessage(
			{
				customType: "file-preview",
				content: `📎 ${summary}`,
				display: true,
				details: { items } as FilePreviewDetails,
			},
			{ deliverAs: "nextTurn" },
		);

		return { action: "continue" };
	});

	pi.registerMessageRenderer("file-preview", (message, options, theme) => {
		const details = message.details as FilePreviewDetails | undefined;
		const items = details?.items ?? [];
		const expanded = options.expanded;

		const container = new Container();
		container.addChild(new Spacer(1));

		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			if (i > 0) container.addChild(new Spacer(1));

			container.addChild(new Text(renderHeader(item, theme, expanded), 1, 0));
			renderTextItem(item, theme, expanded, container);
		}

		return container;
	});
}
