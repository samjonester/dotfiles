import { describe, it, expect, vi } from "vitest";
import * as child_process from "node:child_process";

import {
	cleanUrl,
	collectLinks,
	extractLinks,
	friendlyLabel,
	isSafeOpenUrl,
	openCommand,
	openUrl,
	textFromEntry,
} from "./helpers.js";

vi.mock("node:child_process", () => ({
	execFile: vi.fn(),
}));

// ── openUrl ───────────────────────────────────────────────────────────────────

describe("openUrl", () => {
	it("resolves null on success", async () => {
		vi.mocked(child_process.execFile).mockImplementation((_cmd, _args, cb: any) => {
			cb(null);
			return {} as any;
		});
		const result = await openUrl("https://example.com");
		expect(result).toBeNull();
	});

	it("resolves with error message on failure", async () => {
		vi.mocked(child_process.execFile).mockImplementation((_cmd, _args, cb: any) => {
			cb(new Error("spawn xdg-open ENOENT"));
			return {} as any;
		});
		const result = await openUrl("https://example.com");
		expect(result).toBe("spawn xdg-open ENOENT");
	});

	it("uses platform-appropriate command", async () => {
		vi.mocked(child_process.execFile).mockImplementation((_cmd, _args, cb: any) => {
			cb(null);
			return {} as any;
		});
		await openUrl("https://example.com");
		const call = vi.mocked(child_process.execFile).mock.calls[0];
		const cmd = call[0] as string;
		// Should be one of the platform commands
		expect(["open", "xdg-open", "rundll32"]).toContain(cmd);
	});

	it("refuses to open non-http(s) URLs without invoking execFile", async () => {
		vi.mocked(child_process.execFile).mockClear();
		const result = await openUrl("javascript:alert(1)");
		expect(result).toMatch(/refusing to open unsafe URL/);
		expect(child_process.execFile).not.toHaveBeenCalled();
	});

	it("refuses URLs containing whitespace without invoking execFile", async () => {
		vi.mocked(child_process.execFile).mockClear();
		const result = await openUrl("https://example.com /extra");
		expect(result).toMatch(/refusing to open unsafe URL/);
		expect(child_process.execFile).not.toHaveBeenCalled();
	});
});

describe("isSafeOpenUrl", () => {
	it("accepts plain http URLs", () => {
		expect(isSafeOpenUrl("http://example.com")).toBe(true);
	});

	it("accepts plain https URLs with query and fragment", () => {
		expect(isSafeOpenUrl("https://example.com/path?a=1&b=2#frag")).toBe(true);
	});

	it("rejects empty strings", () => {
		expect(isSafeOpenUrl("")).toBe(false);
	});

	it("rejects non-string input", () => {
		expect(isSafeOpenUrl(undefined as unknown as string)).toBe(false);
		expect(isSafeOpenUrl(null as unknown as string)).toBe(false);
	});

	it("rejects javascript: URLs", () => {
		expect(isSafeOpenUrl("javascript:alert(1)")).toBe(false);
	});

	it("rejects file: URLs", () => {
		expect(isSafeOpenUrl("file:///etc/passwd")).toBe(false);
	});

	it("rejects data: URLs", () => {
		expect(isSafeOpenUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
	});

	it("rejects URLs with embedded whitespace", () => {
		expect(isSafeOpenUrl("https://example.com /x")).toBe(false);
		expect(isSafeOpenUrl("https://example.com\n/x")).toBe(false);
		expect(isSafeOpenUrl("https://example.com\t/x")).toBe(false);
	});

	it("rejects URLs with control characters", () => {
		expect(isSafeOpenUrl("https://example.com\x00")).toBe(false);
	});

	it("rejects malformed URLs", () => {
		expect(isSafeOpenUrl("not a url")).toBe(false);
	});
});

describe("openCommand", () => {
	it("returns 'open' on macOS", () => {
		expect(openCommand("darwin")).toEqual({ cmd: "open", args: [] });
	});

	it("returns rundll32 url.dll,FileProtocolHandler on Windows (no shell)", () => {
		expect(openCommand("win32")).toEqual({
			cmd: "rundll32",
			args: ["url.dll,FileProtocolHandler"],
		});
	});

	it("returns 'xdg-open' on Linux", () => {
		expect(openCommand("linux")).toEqual({ cmd: "xdg-open", args: [] });
	});
});

// ── cleanUrl ──────────────────────────────────────────────────────────────────

describe("cleanUrl", () => {
	it("strips trailing period", () => {
		expect(cleanUrl("https://example.com.")).toBe("https://example.com");
	});

	it("strips trailing comma", () => {
		expect(cleanUrl("https://example.com,")).toBe("https://example.com");
	});

	it("strips trailing unbalanced parenthesis", () => {
		expect(cleanUrl("https://example.com)")).toBe("https://example.com");
	});

	it("preserves balanced parentheses in URL", () => {
		const url = "https://en.wikipedia.org/wiki/Function_(mathematics)";
		expect(cleanUrl(url)).toBe(url);
	});

	it("preserves multiple balanced paren groups", () => {
		const url = "https://example.com/a(b)/c(d)";
		expect(cleanUrl(url)).toBe(url);
	});

	it("strips unbalanced trailing paren after balanced ones", () => {
		expect(cleanUrl("https://en.wikipedia.org/wiki/Fn_(math))"))
			.toBe("https://en.wikipedia.org/wiki/Fn_(math)");
	});

	it("strips punctuation exposed after paren removal", () => {
		expect(cleanUrl("https://example.com).")).toBe("https://example.com");
	});

	it("strips multiple trailing punctuation", () => {
		expect(cleanUrl("https://example.com).")).toBe("https://example.com");
	});

	it("strips trailing semicolons and colons", () => {
		expect(cleanUrl("https://example.com;")).toBe("https://example.com");
		expect(cleanUrl("https://example.com:")).toBe("https://example.com");
	});

	it("strips trailing exclamation and question marks", () => {
		expect(cleanUrl("https://example.com!")).toBe("https://example.com");
		expect(cleanUrl("https://example.com?")).toBe("https://example.com");
	});

	it("preserves query strings", () => {
		expect(cleanUrl("https://example.com?foo=bar")).toBe("https://example.com?foo=bar");
	});

	it("preserves fragment anchors", () => {
		expect(cleanUrl("https://example.com#section")).toBe("https://example.com#section");
	});

	it("returns clean URLs unchanged", () => {
		expect(cleanUrl("https://example.com/path")).toBe("https://example.com/path");
	});
});

// ── extractLinks ──────────────────────────────────────────────────────────────

describe("extractLinks", () => {
	it("extracts a plain URL", () => {
		const result = extractLinks("Check out https://example.com for details");
		expect(result).toEqual([{ url: "https://example.com" }]);
	});

	it("extracts multiple plain URLs", () => {
		const result = extractLinks("See https://a.com and https://b.com");
		expect(result).toEqual([
			{ url: "https://a.com" },
			{ url: "https://b.com" },
		]);
	});

	it("extracts markdown links with labels", () => {
		const result = extractLinks("See [my link](https://example.com) for info");
		expect(result).toEqual([{ url: "https://example.com", label: "my link" }]);
	});

	it("extracts markdown links with empty label text", () => {
		const result = extractLinks("[](https://example.com)");
		expect(result).toEqual([{ url: "https://example.com" }]);
	});

	it("deduplicates URLs from markdown and plain text", () => {
		const text = "[link](https://example.com) also https://example.com";
		const result = extractLinks(text);
		expect(result).toEqual([{ url: "https://example.com", label: "link" }]);
	});

	it("prefers markdown label when URL appears in both forms", () => {
		const text = "[PR #42](https://github.com/org/repo/pull/42) - see https://github.com/org/repo/pull/42";
		const result = extractLinks(text);
		expect(result).toHaveLength(1);
		expect(result[0].label).toBe("PR #42");
	});

	it("handles multiple markdown links", () => {
		const text = "[a](https://a.com) and [b](https://b.com)";
		const result = extractLinks(text);
		expect(result).toEqual([
			{ url: "https://a.com", label: "a" },
			{ url: "https://b.com", label: "b" },
		]);
	});

	it("cleans trailing punctuation from plain URLs", () => {
		const result = extractLinks("Visit https://example.com.");
		expect(result).toEqual([{ url: "https://example.com" }]);
	});

	it("deduplicates markdown links with same URL", () => {
		const text = "[link1](https://example.com) and [link2](https://example.com)";
		const result = extractLinks(text);
		expect(result).toHaveLength(1);
		expect(result[0].label).toBe("link1");
	});

	it("handles http URLs", () => {
		const result = extractLinks("http://example.com");
		expect(result).toEqual([{ url: "http://example.com" }]);
	});

	it("returns empty array for text with no URLs", () => {
		expect(extractLinks("no links here")).toEqual([]);
	});

	it("returns empty array for empty string", () => {
		expect(extractLinks("")).toEqual([]);
	});

	it("handles URLs with query params and fragments", () => {
		const result = extractLinks("https://example.com/path?q=1&b=2#section");
		expect(result).toEqual([{ url: "https://example.com/path?q=1&b=2#section" }]);
	});

	it("extracts URLs with line numbers (GitHub blob style)", () => {
		const result = extractLinks("https://github.com/org/repo/blob/main/file.rb#L42-L58");
		expect(result).toEqual([{ url: "https://github.com/org/repo/blob/main/file.rb#L42-L58" }]);
	});

	it("extracts URLs with balanced parentheses (Wikipedia)", () => {
		const result = extractLinks("See https://en.wikipedia.org/wiki/Function_(mathematics) for details");
		expect(result).toEqual([{ url: "https://en.wikipedia.org/wiki/Function_(mathematics)" }]);
	});

	it("extracts markdown links with nested parens in URL", () => {
		const result = extractLinks("[doc](https://en.wikipedia.org/wiki/Function_(mathematics))");
		expect(result).toEqual([{ url: "https://en.wikipedia.org/wiki/Function_(mathematics)", label: "doc" }]);
	});
});

// ── friendlyLabel ─────────────────────────────────────────────────────────────

describe("friendlyLabel", () => {
	it("formats GitHub PRs", () => {
		expect(friendlyLabel("https://github.com/Shopify/kepler/pull/7452"))
			.toBe("Shopify/kepler PR #7452");
	});

	it("formats GitHub PRs with label", () => {
		expect(friendlyLabel("https://github.com/Shopify/kepler/pull/7452", "#7452"))
			.toBe("#7452 - Shopify/kepler PR #7452");
	});

	it("formats GitHub issues", () => {
		expect(friendlyLabel("https://github.com/org/repo/issues/123"))
			.toBe("org/repo Issue #123");
	});

	it("formats GitHub issue (singular)", () => {
		expect(friendlyLabel("https://github.com/org/repo/issue/99"))
			.toBe("org/repo Issue #99");
	});

	it("formats GitHub blob links", () => {
		expect(friendlyLabel("https://github.com/org/repo/blob/main/src/file.ts"))
			.toBe("org/repo/file.ts");
	});

	it("formats GitHub blob links with label", () => {
		expect(friendlyLabel("https://github.com/org/repo/blob/main/src/file.ts", "the file"))
			.toBe("the file - file.ts");
	});

	it("formats Buildkite build links", () => {
		expect(friendlyLabel("https://buildkite.com/shopify/kepler/builds/12345"))
			.toBe("Buildkite: kepler #12345");
	});

	it("formats Buildkite non-build paths", () => {
		expect(friendlyLabel("https://buildkite.com/shopify/kepler"))
			.toBe("Buildkite: /shopify/kepler");
	});

	it("formats Buildkite non-build paths with label", () => {
		expect(friendlyLabel("https://buildkite.com/shopify/kepler", "CI"))
			.toBe("CI");
	});

	it("formats Slack links", () => {
		expect(friendlyLabel("https://shopify.slack.com/archives/C123/p456"))
			.toBe("Slack message");
	});

	it("formats Slack links with label", () => {
		expect(friendlyLabel("https://shopify.slack.com/archives/C123/p456", "thread"))
			.toBe("thread");
	});

	it("formats the apex slack.com host", () => {
		expect(friendlyLabel("https://slack.com/help/articles/123"))
			.toBe("Slack message");
	});

	it("does not label Slack lookalike domains as Slack", () => {
		expect(friendlyLabel("https://evilslack.com/archives/C/p"))
			.toBe("evilslack.com/archives/C/p");
		expect(friendlyLabel("https://slack.com.evil.tld/archives/C/p"))
			.toBe("slack.com.evil.tld/archives/C/p");
	});

	it("formats Vault links", () => {
		expect(friendlyLabel("https://vault.shopify.io/page/my-document"))
			.toBe("Vault: my-document");
	});

	it("formats Vault root path without slug", () => {
		expect(friendlyLabel("https://vault.shopify.io/"))
			.toBe("Vault: /");
	});

	it("formats Vault root with label", () => {
		expect(friendlyLabel("https://vault.shopify.io/page/my-doc", "My Doc"))
			.toBe("My Doc");
	});

	it("falls back to hostname + path for unknown URLs", () => {
		expect(friendlyLabel("https://docs.ruby-lang.org/en/3.3/String.html"))
			.toBe("docs.ruby-lang.org/en/3.3/String.html");
	});

	it("uses label when provided for unknown URLs", () => {
		expect(friendlyLabel("https://example.com/foo", "my label"))
			.toBe("my label");
	});

	it("handles root path URLs", () => {
		expect(friendlyLabel("https://example.com/"))
			.toBe("example.com");
	});

	it("returns URL as-is for invalid URLs", () => {
		expect(friendlyLabel("not-a-url")).toBe("not-a-url");
	});

	it("returns label for invalid URLs when label provided", () => {
		expect(friendlyLabel("not-a-url", "my label")).toBe("my label");
	});
});

// ── textFromEntry ─────────────────────────────────────────────────────────────

describe("textFromEntry", () => {
	it("extracts string content", () => {
		expect(textFromEntry({
			type: "message",
			message: { content: "hello https://example.com" },
		})).toBe("hello https://example.com");
	});

	it("extracts text from content block array", () => {
		expect(textFromEntry({
			type: "message",
			message: {
				content: [
					{ type: "text", text: "first" },
					{ type: "text", text: "second" },
				],
			},
		})).toBe("first\nsecond");
	});

	it("skips non-text content blocks", () => {
		expect(textFromEntry({
			type: "message",
			message: {
				content: [
					{ type: "image" },
					{ type: "text", text: "hello" },
				],
			},
		})).toBe("hello");
	});

	it("returns empty string for non-message entries", () => {
		expect(textFromEntry({ type: "custom" })).toBe("");
	});

	it("returns empty string for missing message", () => {
		expect(textFromEntry({ type: "message" })).toBe("");
	});

	it("returns empty string for null entry", () => {
		expect(textFromEntry(null as any)).toBe("");
	});

	it("returns empty string for undefined content", () => {
		expect(textFromEntry({ type: "message", message: {} })).toBe("");
	});

	it("handles content blocks with missing text field", () => {
		expect(textFromEntry({
			type: "message",
			message: {
				content: [
					{ type: "text" },
					{ type: "text", text: "valid" },
				],
			},
		})).toBe("valid");
	});
});

// ── collectLinks ──────────────────────────────────────────────────────────────

describe("collectLinks", () => {
	it("collects links from multiple assistant entries, newest first", () => {
		const entries = [
			{ type: "message", message: { role: "assistant", content: "See https://a.com" } },
			{ type: "message", message: { role: "assistant", content: "And https://b.com" } },
		];
		const result = collectLinks(entries);
		expect(result).toEqual([
			{ url: "https://b.com" },
			{ url: "https://a.com" },
		]);
	});

	it("keeps the newest label when a URL appears in multiple messages", () => {
		const entries = [
			{ type: "message", message: { role: "assistant", content: "[old label](https://example.com)" } },
			{ type: "message", message: { role: "assistant", content: "[new label](https://example.com)" } },
		];
		const result = collectLinks(entries);
		expect(result).toHaveLength(1);
		expect(result[0].label).toBe("new label");
	});

	it("collects links from user entries", () => {
		const entries = [
			{ type: "message", message: { role: "user", content: "Check https://a.com" } },
		];
		expect(collectLinks(entries)).toEqual([{ url: "https://a.com" }]);
	});

	it("skips toolResult entries by default", () => {
		const entries = [
			{ type: "message", message: { role: "toolResult", content: "https://noise.com from file" } },
			{ type: "message", message: { role: "assistant", content: "https://real.com" } },
		];
		const result = collectLinks(entries);
		expect(result).toEqual([{ url: "https://real.com" }]);
	});

	it("includes toolResult entries when explicitly requested", () => {
		const entries = [
			{ type: "message", message: { role: "toolResult", content: "https://tool.com" } },
			{ type: "message", message: { role: "assistant", content: "https://asst.com" } },
		];
		const result = collectLinks(entries, { roles: new Set(["assistant", "user", "toolResult"]) });
		expect(result).toEqual([
			{ url: "https://asst.com" },
			{ url: "https://tool.com" },
		]);
	});

	it("includes entries without a role (non-standard entries)", () => {
		const entries = [
			{ type: "message", message: { content: "https://norole.com" } },
		];
		expect(collectLinks(entries)).toEqual([{ url: "https://norole.com" }]);
	});

	it("deduplicates across entries", () => {
		const entries = [
			{ type: "message", message: { role: "assistant", content: "https://example.com" } },
			{ type: "message", message: { role: "assistant", content: "https://example.com again" } },
		];
		const result = collectLinks(entries);
		expect(result).toEqual([{ url: "https://example.com" }]);
	});

	it("skips non-message entries", () => {
		const entries = [
			{ type: "custom" },
			{ type: "message", message: { role: "assistant", content: "https://example.com" } },
		];
		const result = collectLinks(entries);
		expect(result).toEqual([{ url: "https://example.com" }]);
	});

	it("returns empty array when no links found", () => {
		const entries = [
			{ type: "message", message: { role: "assistant", content: "no links here" } },
		];
		expect(collectLinks(entries)).toEqual([]);
	});

	it("returns empty array for empty entries", () => {
		expect(collectLinks([])).toEqual([]);
	});

	it("skips entries with no extractable text", () => {
		const entries = [
			{ type: "message", message: { role: "assistant", content: [] } },
			{ type: "message", message: { role: "assistant", content: "https://real.com" } },
		];
		expect(collectLinks(entries)).toEqual([{ url: "https://real.com" }]);
	});

	it("preserves markdown labels", () => {
		const entries = [
			{ type: "message", message: { role: "assistant", content: "[PR](https://github.com/org/repo/pull/1)" } },
		];
		const result = collectLinks(entries);
		expect(result).toEqual([{ url: "https://github.com/org/repo/pull/1", label: "PR" }]);
	});

	describe("lastMessageOnly", () => {
		it("returns links from only the last assistant message", () => {
			const entries = [
				{ type: "message", message: { role: "assistant", content: "Old: https://old.com" } },
				{ type: "message", message: { role: "user", content: "https://user.com" } },
				{ type: "message", message: { role: "assistant", content: "New: https://new.com" } },
			];
			const result = collectLinks(entries, { lastMessageOnly: true });
			expect(result).toEqual([{ url: "https://new.com" }]);
		});

		it("returns empty array when no assistant messages exist", () => {
			const entries = [
				{ type: "message", message: { role: "user", content: "https://user.com" } },
			];
			const result = collectLinks(entries, { lastMessageOnly: true });
			expect(result).toEqual([]);
		});

		it("returns empty array when last assistant message has no links", () => {
			const entries = [
				{ type: "message", message: { role: "assistant", content: "https://old.com" } },
				{ type: "message", message: { role: "assistant", content: "no links here" } },
			];
			const result = collectLinks(entries, { lastMessageOnly: true });
			expect(result).toEqual([]);
		});

		it("still skips toolResult entries before finding last assistant", () => {
			const entries = [
				{ type: "message", message: { role: "assistant", content: "https://real.com" } },
				{ type: "message", message: { role: "toolResult", content: "https://noise.com" } },
			];
			const result = collectLinks(entries, { lastMessageOnly: true });
			expect(result).toEqual([{ url: "https://real.com" }]);
		});
	});
});
