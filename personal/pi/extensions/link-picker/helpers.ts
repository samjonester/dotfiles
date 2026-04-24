/**
 * Pure helper functions for link extraction and labeling.
 * No pi/extension dependencies - easy to test.
 */

import { execFile } from "node:child_process";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FoundLink {
	url: string;
	label?: string;
}

// ── Extraction ────────────────────────────────────────────────────────────────

/** Markdown link with balanced-paren support: [text](url)
 *  Allows one level of nested parens in the URL, e.g. [doc](https://en.wikipedia.org/wiki/Fn_(math)) */
const MARKDOWN_LINK_RE = /\[([^\]]*)\]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))*)\)/g;

/** Plain URL (broad match including parens, cleaned up after) */
const PLAIN_URL_RE = /https?:\/\/[^\s<>\[\]'"`,;{}|\\^]+/g;

/** Strip trailing punctuation and unbalanced closing parens. */
export function cleanUrl(url: string): string {
	// Strip trailing punctuation (not parens - handled below)
	url = url.replace(/[.,:;!?]+$/, "");
	// Strip trailing closing parens that aren't balanced
	while (url.endsWith(")")) {
		const open = countChar(url, "(");
		const close = countChar(url, ")");
		if (close <= open) break;
		url = url.slice(0, -1);
	}
	// Strip any trailing punctuation exposed after paren removal
	url = url.replace(/[.,:;!?]+$/, "");
	return url;
}

/**
 * Extract all URLs from a block of text.
 * Markdown links are extracted first (with labels), then plain URLs.
 * Duplicates are skipped.
 */
export function extractLinks(text: string): FoundLink[] {
	const results: FoundLink[] = [];
	const seen = new Set<string>();

	// Markdown links first (they have labels)
	let m: RegExpExecArray | null;
	MARKDOWN_LINK_RE.lastIndex = 0;
	while ((m = MARKDOWN_LINK_RE.exec(text)) !== null) {
		const url = cleanUrl(m[2]);
		if (!seen.has(url)) {
			seen.add(url);
			results.push({ url, label: m[1] || undefined });
		}
	}

	// Plain URLs
	PLAIN_URL_RE.lastIndex = 0;
	while ((m = PLAIN_URL_RE.exec(text)) !== null) {
		const url = cleanUrl(m[0]);
		if (!seen.has(url)) {
			seen.add(url);
			results.push({ url });
		}
	}

	return results;
}

// ── Display Labels ────────────────────────────────────────────────────────────

/**
 * Build a short, human-readable label for a URL.
 * Recognizes GitHub PRs/issues, Buildkite builds, Slack, Vault, and falls
 * back to hostname + path.
 */
export function friendlyLabel(url: string, label?: string): string {
	try {
		const u = new URL(url);

		// GitHub PR/issue
		const gh = u.pathname.match(/^\/([^/]+\/[^/]+)\/(pull|issues?)\/(\d+)/);
		if (gh) {
			const kind = gh[2] === "pull" ? "PR" : "Issue";
			const short = `${gh[1]} ${kind} #${gh[3]}`;
			return label ? `${label} - ${short}` : short;
		}

		// GitHub blob/file
		const blob = u.pathname.match(/^\/([^/]+\/[^/]+)\/blob\/.+\/(.+)$/);
		if (blob) {
			return label ? `${label} - ${blob[2]}` : `${blob[1]}/${blob[2]}`;
		}

		// Buildkite build
		if (u.hostname === "buildkite.com") {
			const bk = u.pathname.match(/\/([^/]+)\/([^/]+)\/builds\/(\d+)/);
			if (bk) return label || `Buildkite: ${bk[2]} #${bk[3]}`;
			return label || `Buildkite: ${u.pathname}`;
		}

		// Slack (exact host or subdomain, not lookalikes like evilslack.com)
		if (u.hostname === "slack.com" || u.hostname.endsWith(".slack.com")) {
			return label || "Slack message";
		}

		// Vault
		if (u.hostname === "vault.shopify.io") {
			const slug = u.pathname.split("/").filter(Boolean).pop();
			return label || (slug ? `Vault: ${slug}` : `Vault: ${u.pathname}`);
		}

		// Generic: hostname + path
		const path = u.pathname === "/" ? "" : u.pathname;
		return label || `${u.hostname}${path}`;
	} catch {
		return label || url;
	}
}

// ── Session Scanning ──────────────────────────────────────────────────────────

/**
 * Extract text content from a session entry.
 * Handles string content and content block arrays.
 */
export function textFromEntry(entry: {
	type: string;
	message?: {
		role?: string;
		content?: string | Array<{ type: string; text?: string }>;
	};
}): string {
	if (!entry || entry.type !== "message" || !entry.message) return "";
	const { content } = entry.message;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((b) => b.type === "text" && b.text)
			.map((b) => b.text!)
			.join("\n");
	}
	return "";
}

/** Roles to scan by default. Tool results contain file contents, command
 *  output, and search results - too noisy. */
const DEFAULT_ROLES = new Set(["assistant", "user"]);

export interface CollectOptions {
	/** Which message roles to scan (default: assistant + user). */
	roles?: Set<string>;
	/** When true, only scan the last assistant message instead of all. */
	lastMessageOnly?: boolean;
}

/**
 * Collect all unique links from session entries, newest first.
 * Only scans user and assistant messages by default, skipping tool results
 * which contain file contents and incidental URLs.
 *
 * When a URL appears in multiple messages, the newest occurrence wins
 * (keeping its label and position).
 *
 * With `lastMessageOnly`, only the most recent assistant message is scanned.
 */
export function collectLinks(
	entries: Array<{ type: string; message?: any }>,
	options?: CollectOptions,
): FoundLink[] {
	const roles = options?.roles ?? DEFAULT_ROLES;

	let toScan = entries.filter((entry) => {
		if (entry.type !== "message" || !entry.message) return false;
		const role = entry.message.role as string | undefined;
		if (role && !roles.has(role)) return false;
		return true;
	});

	if (options?.lastMessageOnly) {
		const last = findLast(toScan, (e) => e.message?.role === "assistant");
		toScan = last ? [last] : [];
	}

	// Iterate newest-first so the first occurrence we record is the latest
	const result: FoundLink[] = [];
	const seen = new Set<string>();

	for (let i = toScan.length - 1; i >= 0; i--) {
		const text = textFromEntry(toScan[i]);
		if (!text) continue;
		for (const link of extractLinks(text)) {
			if (!seen.has(link.url)) {
				seen.add(link.url);
				result.push(link);
			}
		}
	}

	return result;
}

/** Count occurrences of a character in a string. */
function countChar(str: string, ch: string): number {
	let n = 0;
	for (let i = 0; i < str.length; i++) {
		if (str[i] === ch) n++;
	}
	return n;
}

/** Array.findLast polyfill for older Node versions. */
function findLast<T>(arr: T[], predicate: (item: T) => boolean): T | undefined {
	for (let i = arr.length - 1; i >= 0; i--) {
		if (predicate(arr[i])) return arr[i];
	}
	return undefined;
}

// ── Browser Open ──────────────────────────────────────────────────────────────

/**
 * Platform-specific command to open a URL in the default browser.
 *
 * On Windows this uses `rundll32 url.dll,FileProtocolHandler` rather than
 * `cmd /c start`. `cmd.exe` parses `&`, `|`, `<`, `>` in its arguments, which
 * both breaks query strings and can execute arbitrary commands from a crafted
 * URL. `rundll32` invokes the default handler directly with no shell
 * tokenisation.
 */
export function openCommand(platform: string = process.platform): { cmd: string; args: string[] } {
	switch (platform) {
		case "darwin":
			return { cmd: "open", args: [] };
		case "win32":
			return { cmd: "rundll32", args: ["url.dll,FileProtocolHandler"] };
		default:
			return { cmd: "xdg-open", args: [] };
	}
}

/**
 * True if `url` is a plain http(s) URL with no whitespace or control
 * characters. Everything else (javascript:, file:, data:, malformed,
 * non-string) is rejected before we hand a value to an OS launcher.
 */
export function isSafeOpenUrl(url: string): boolean {
	if (typeof url !== "string" || url.length === 0) return false;
	if (/[\s\x00-\x1f\x7f]/.test(url)) return false;
	try {
		const u = new URL(url);
		return u.protocol === "http:" || u.protocol === "https:";
	} catch {
		return false;
	}
}

/**
 * Open a URL in the default browser. Cross-platform (macOS, Linux, Windows).
 * Only plain http(s) URLs pass `isSafeOpenUrl`; anything else returns an
 * error without spawning a process.
 * Returns null on success, or an error message string on failure.
 */
export function openUrl(url: string): Promise<string | null> {
	if (!isSafeOpenUrl(url)) {
		return Promise.resolve(`refusing to open unsafe URL: ${url}`);
	}
	const { cmd, args } = openCommand();
	return new Promise((resolve) => {
		execFile(cmd, [...args, url], (err) => {
			if (err) {
				resolve(err.message);
			} else {
				resolve(null);
			}
		});
	});
}
