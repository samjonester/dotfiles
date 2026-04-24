/**
 * Tests for shell-mode helpers.
 * Run: npx vitest run helpers.test.ts
 */

import { describe, it, expect } from "vitest";
import {
	buildList,
	matchesCommandList,
	parsePrefix,
	classifyCommand,
	invalidateListCache,
	DEFAULT_INTERACTIVE_COMMANDS,
	DEFAULT_FULLSCREEN_COMMANDS,
	DEFAULT_BACKGROUND_COMMANDS,
} from "./helpers.ts";

// ── matchesCommandList ────────────────────────────────────────────────────────

describe("matchesCommandList", () => {
	it("matches exact command", () => {
		expect(matchesCommandList("vim", ["vim"])).toBe(true);
	});

	it("matches command with arguments", () => {
		expect(matchesCommandList("vim file.txt", ["vim"])).toBe(true);
	});

	it("matches command with tab separator", () => {
		expect(matchesCommandList("vim\tfile.txt", ["vim"])).toBe(true);
	});

	it("matches multi-word command", () => {
		expect(matchesCommandList("git commit -m 'msg'", ["git commit"])).toBe(true);
	});

	it("matches after pipe", () => {
		expect(matchesCommandList("cat file | less", ["less"])).toBe(true);
	});

	it("matches after pipe with arguments", () => {
		expect(matchesCommandList("cat file | less -R", ["less"])).toBe(true);
	});

	it("does not match partial command names", () => {
		expect(matchesCommandList("vimrc", ["vim"])).toBe(false);
	});

	it("does not match unrelated commands", () => {
		expect(matchesCommandList("ls -la", ["vim", "less"])).toBe(false);
	});

	it("is case-insensitive", () => {
		expect(matchesCommandList("VIM file.txt", ["vim"])).toBe(true);
	});

	it("handles leading whitespace", () => {
		expect(matchesCommandList("  vim file.txt", ["vim"])).toBe(true);
	});

	it("matches empty list returns false", () => {
		expect(matchesCommandList("vim", [])).toBe(false);
	});
});

// ── buildList ─────────────────────────────────────────────────────────────────

describe("buildList", () => {
	it("returns defaults when no env vars set", () => {
		const result = buildList(["vim", "less"]);
		expect(result).toEqual(["vim", "less"]);
	});

	it("adds from env var", () => {
		const orig = process.env.TEST_ADD;
		process.env.TEST_ADD = "htop,btop";
		try {
			const result = buildList(["vim"], "TEST_ADD");
			expect(result).toEqual(["vim", "htop", "btop"]);
		} finally {
			if (orig === undefined) delete process.env.TEST_ADD;
			else process.env.TEST_ADD = orig;
		}
	});

	it("excludes from env var", () => {
		const orig = process.env.TEST_EXCLUDE;
		process.env.TEST_EXCLUDE = "vim";
		try {
			const result = buildList(["vim", "less"], undefined, "TEST_EXCLUDE");
			expect(result).toEqual(["less"]);
		} finally {
			if (orig === undefined) delete process.env.TEST_EXCLUDE;
			else process.env.TEST_EXCLUDE = orig;
		}
	});

	it("exclude is case-insensitive", () => {
		const orig = process.env.TEST_EXCLUDE;
		process.env.TEST_EXCLUDE = "VIM";
		try {
			const result = buildList(["vim", "less"], undefined, "TEST_EXCLUDE");
			expect(result).toEqual(["less"]);
		} finally {
			if (orig === undefined) delete process.env.TEST_EXCLUDE;
			else process.env.TEST_EXCLUDE = orig;
		}
	});
});

// ── parsePrefix ───────────────────────────────────────────────────────────────

describe("parsePrefix", () => {
	it("returns null mode for plain command", () => {
		const r = parsePrefix("ls -la");
		expect(r.mode).toBeNull();
		expect(r.command).toBe("ls -la");
	});

	it("parses !i prefix", () => {
		const r = parsePrefix("i some-command --flag");
		expect(r.mode).toBe("interactive");
		expect(r.command).toBe("some-command --flag");
	});

	it("parses !f prefix", () => {
		const r = parsePrefix("f some-command");
		expect(r.mode).toBe("fullscreen");
		expect(r.command).toBe("some-command");
	});

	it("does not parse !if prefix (bash keyword collision)", () => {
		const r = parsePrefix("if some-command");
		expect(r.mode).toBeNull();
		expect(r.command).toBe("if some-command");
	});

	it("parses !fi prefix as fullscreen", () => {
		const r = parsePrefix("fi some-command");
		expect(r.mode).toBe("fullscreen");
		expect(r.command).toBe("some-command");
	});

	it("parses !& prefix as background", () => {
		const r = parsePrefix("& dev up");
		expect(r.mode).toBe("background");
		expect(r.command).toBe("dev up");
	});

	it("parses !& with tab", () => {
		const r = parsePrefix("&\tdev up");
		expect(r.mode).toBe("background");
		expect(r.command).toBe("dev up");
	});

	it("parses !bg prefix as background", () => {
		const r = parsePrefix("bg dev up");
		expect(r.mode).toBe("background");
		expect(r.command).toBe("dev up");
	});

	it("does not parse prefix without space", () => {
		const r = parsePrefix("ifconfig eth0");
		expect(r.mode).toBeNull();
		expect(r.command).toBe("ifconfig eth0");
	});

	it("does not parse 'i' as prefix in the middle", () => {
		const r = parsePrefix("run i something");
		expect(r.mode).toBeNull();
		expect(r.command).toBe("run i something");
	});

	// Trailing &
	it("parses trailing & as background", () => {
		const r = parsePrefix("dev up &");
		expect(r.mode).toBe("background");
		expect(r.command).toBe("dev up");
	});

	it("parses trailing & with extra whitespace", () => {
		const r = parsePrefix("dev up  &  ");
		expect(r.mode).toBe("background");
		expect(r.command).toBe("dev up");
	});

	it("does not treat && as trailing &", () => {
		const r = parsePrefix("foo && bar");
		expect(r.mode).toBeNull();
		expect(r.command).toBe("foo && bar");
	});

	it("does not treat &> as trailing &", () => {
		const r = parsePrefix("cmd &> /dev/null");
		expect(r.mode).toBeNull();
		expect(r.command).toBe("cmd &> /dev/null");
	});
});

// ── classifyCommand ───────────────────────────────────────────────────────────

describe("classifyCommand", () => {
	it("classifies vim as fullscreen", () => {
		expect(classifyCommand("vim file.txt")).toBe("fullscreen");
	});

	it("classifies htop as fullscreen", () => {
		expect(classifyCommand("htop")).toBe("fullscreen");
	});

	it("classifies less after pipe as fullscreen", () => {
		expect(classifyCommand("cat file | less")).toBe("fullscreen");
	});

	it("classifies git rebase -i as interactive", () => {
		expect(classifyCommand("git rebase -i HEAD~3")).toBe("interactive");
	});

	it("classifies git rebase (non-interactive) as normal", () => {
		expect(classifyCommand("git rebase main")).toBe("normal");
	});

	it("classifies git commit as normal (non-interactive with -m)", () => {
		expect(classifyCommand("git commit -m 'msg'")).toBe("normal");
	});

	it("classifies ssh as interactive", () => {
		expect(classifyCommand("ssh user@host")).toBe("interactive");
	});

	it("classifies pi config as interactive", () => {
		expect(classifyCommand("pi config")).toBe("interactive");
	});

	it("classifies ls as normal", () => {
		expect(classifyCommand("ls -la")).toBe("normal");
	});

	it("classifies unknown command as normal", () => {
		expect(classifyCommand("my-custom-tool --flag")).toBe("normal");
	});

	it("fullscreen takes priority over interactive for shared commands", () => {
		// lazygit is fullscreen, not just interactive
		expect(classifyCommand("lazygit")).toBe("fullscreen");
	});

	// Graphite
	it("classifies gt create as interactive", () => {
		expect(classifyCommand("gt create -am 'msg'")).toBe("interactive");
	});

	it("classifies gt submit as interactive", () => {
		expect(classifyCommand("gt submit --stack")).toBe("interactive");
	});

	it("classifies gt checkout as interactive", () => {
		expect(classifyCommand("gt checkout")).toBe("interactive");
	});

	it("classifies gt sync as interactive", () => {
		expect(classifyCommand("gt sync")).toBe("interactive");
	});

	// GitHub CLI
	it("classifies gh pr create as interactive", () => {
		expect(classifyCommand("gh pr create")).toBe("interactive");
	});

	it("classifies gh auth login as interactive", () => {
		expect(classifyCommand("gh auth login")).toBe("interactive");
	});

	it("classifies gh copilot as interactive", () => {
		expect(classifyCommand("gh copilot suggest")).toBe("interactive");
	});

	// Shopify
	it("classifies dev init as interactive", () => {
		expect(classifyCommand("dev init")).toBe("interactive");
	});

	it("classifies zellij as fullscreen", () => {
		expect(classifyCommand("zellij")).toBe("fullscreen");
	});

	it("classifies devx rig up as fullscreen", () => {
		expect(classifyCommand("devx rig up")).toBe("fullscreen");
	});
});

// ── Default command lists ─────────────────────────────────────────────────────

describe("default command lists", () => {
	it("classifies command as background via env var", () => {
		const orig = process.env.BACKGROUND_COMMANDS;
		process.env.BACKGROUND_COMMANDS = "dev up";
		invalidateListCache();
		try {
			expect(classifyCommand("dev up")).toBe("background");
		} finally {
			if (orig === undefined) delete process.env.BACKGROUND_COMMANDS;
			else process.env.BACKGROUND_COMMANDS = orig;
			invalidateListCache();
		}
	});

	it("background takes priority over fullscreen and interactive", () => {
		const orig = process.env.BACKGROUND_COMMANDS;
		process.env.BACKGROUND_COMMANDS = "vim";
		invalidateListCache();
		try {
			expect(classifyCommand("vim")).toBe("background");
		} finally {
			if (orig === undefined) delete process.env.BACKGROUND_COMMANDS;
			else process.env.BACKGROUND_COMMANDS = orig;
			invalidateListCache();
		}
	});

	it("background default list is empty", () => {
		expect(DEFAULT_BACKGROUND_COMMANDS).toEqual([]);
	});

	it("interactive list has no overlap with fullscreen list", () => {
		const interactiveSet = new Set(DEFAULT_INTERACTIVE_COMMANDS.map((c) => c.toLowerCase()));
		const fullscreenSet = new Set(DEFAULT_FULLSCREEN_COMMANDS.map((c) => c.toLowerCase()));
		const overlap = [...interactiveSet].filter((c) => fullscreenSet.has(c));
		expect(overlap).toEqual([]);
	});

	it("interactive list is non-empty", () => {
		expect(DEFAULT_INTERACTIVE_COMMANDS.length).toBeGreaterThan(0);
	});

	it("fullscreen list is non-empty", () => {
		expect(DEFAULT_FULLSCREEN_COMMANDS.length).toBeGreaterThan(0);
	});
});
