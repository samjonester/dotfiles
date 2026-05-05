import { describe, it, expect } from "vitest";
import {
	SESSION_EMOJI,
	TITLE_COLORS,
	randomEmoji,
	randomTitleColor,
	fgHex,
	detectWorldContext,
	parseSessionName,
	buildTerminalTitle,
} from "./helpers";

// ─── randomEmoji ────────────────────────────────────────────────────────────

describe("randomEmoji", () => {
	it("returns an emoji from the pool", () => {
		const emoji = randomEmoji();
		expect(SESSION_EMOJI).toContain(emoji);
	});
});

// ─── randomTitleColor ───────────────────────────────────────────────────────

describe("randomTitleColor", () => {
	it("returns a color from the pool", () => {
		const color = randomTitleColor();
		expect(TITLE_COLORS).toContain(color);
	});
});

// ─── fgHex ──────────────────────────────────────────────────────────────────

describe("fgHex", () => {
	it("wraps text in 24-bit ANSI color codes", () => {
		const result = fgHex("#FF0000", "hello");
		expect(result).toBe("\x1b[38;2;255;0;0mhello\x1b[0m");
	});

	it("parses mixed hex values", () => {
		const result = fgHex("#1A2B3C", "test");
		expect(result).toBe("\x1b[38;2;26;43;60mtest\x1b[0m");
	});
});

// ─── detectWorldContext ─────────────────────────────────────────────────────

describe("detectWorldContext", () => {
	it("returns null for non-world paths", () => {
		expect(detectWorldContext("/home/user/project")).toEqual({
			treeName: null,
			zone: null,
		});
	});

	it("detects tree name at src root", () => {
		expect(detectWorldContext("/Users/me/world/trees/root/src")).toEqual({
			treeName: "root",
			zone: null,
		});
	});

	it("detects tree name and zone", () => {
		expect(detectWorldContext("/Users/me/world/trees/t1/src/areas/core/shopify")).toEqual({
			treeName: "t1",
			zone: "areas/core/shopify",
		});
	});

	it("truncates zone to 3 segments", () => {
		expect(detectWorldContext("/Users/me/world/trees/root/src/a/b/c/d/e")).toEqual({
			treeName: "root",
			zone: "a/b/c",
		});
	});

	it("handles 1-segment zone", () => {
		expect(detectWorldContext("/Users/me/world/trees/t2/src/libraries")).toEqual({
			treeName: "t2",
			zone: "libraries",
		});
	});

	it("handles 2-segment zone", () => {
		expect(detectWorldContext("/Users/me/world/trees/t3/src/areas/tools")).toEqual({
			treeName: "t3",
			zone: "areas/tools",
		});
	});
});

// ─── parseSessionName ───────────────────────────────────────────────────────

describe("parseSessionName", () => {
	it("returns empty for empty string", () => {
		const result = parseSessionName("");
		expect(result.emoji).toBe("");
		expect(result.label).toBe("");
		expect(result.titleColor).toBe("");
	});

	it("parses emoji + label format", () => {
		const result = parseSessionName("🔮 fix checkout bug");
		expect(result.emoji).toBe("🔮");
		expect(result.label).toBe("fix checkout bug");
		expect(TITLE_COLORS).toContain(result.titleColor);
	});

	it("handles plain name without emoji", () => {
		const result = parseSessionName("fix checkout bug");
		expect(SESSION_EMOJI).toContain(result.emoji);
		expect(result.label).toBe("fix checkout bug");
		expect(TITLE_COLORS).toContain(result.titleColor);
	});

	it("parses variation selector emoji", () => {
		const result = parseSessionName("⚡ fast test");
		expect(result.emoji).toBe("⚡");
		expect(result.label).toBe("fast test");
	});

	it("handles multi-codepoint emoji", () => {
		const result = parseSessionName("🛠️ refactor auth");
		expect(result.emoji).toBe("🛠️");
		expect(result.label).toBe("refactor auth");
	});
});

// ─── buildTerminalTitle ─────────────────────────────────────────────────────

describe("buildTerminalTitle", () => {
	it("returns π alone when no context", () => {
		expect(buildTerminalTitle(null, null, "", "")).toBe("π");
	});

	it("includes tree name", () => {
		expect(buildTerminalTitle("root", null, "", "")).toBe("π root");
	});

	it("includes zone", () => {
		expect(buildTerminalTitle("root", "areas/core", "", "")).toBe("π root //areas/core");
	});

	it("includes label with emoji", () => {
		expect(buildTerminalTitle("t1", "areas/core", "🔮", "fix bug")).toBe(
			"π t1 //areas/core — 🔮 fix bug",
		);
	});

	it("skips label segment when label is empty", () => {
		expect(buildTerminalTitle("root", "areas/tools", "🎯", "")).toBe("π root //areas/tools");
	});
});


