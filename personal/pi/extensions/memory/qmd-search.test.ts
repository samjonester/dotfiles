import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as childProcess from "node:child_process";

import {
	execQMD,
	parseQMDJson,
	QMDSearch,
	QMD_COLLECTION_NAME,
	type QMDJsonResult,
} from "./qmd-search.js";

// ── Mock execFileSync ────────────────────────────────────────────

vi.mock("node:child_process", () => ({
	execFileSync: vi.fn(),
}));

const mockExecFileSync = vi.mocked(childProcess.execFileSync);

beforeEach(() => {
	vi.clearAllMocks();
});

// ── execQMD ──────────────────────────────────────────────────────

describe("execQMD", () => {
	it("returns stdout on success", () => {
		mockExecFileSync.mockReturnValue("output text");
		const result = execQMD(["status"]);
		expect(result).toBe("output text");
		expect(mockExecFileSync).toHaveBeenCalledWith(
			"qmd",
			["status"],
			expect.objectContaining({
				encoding: "utf-8",
				timeout: 30_000,
			}),
		);
	});

	it("returns null when command fails", () => {
		mockExecFileSync.mockImplementation(() => {
			throw new Error("command not found");
		});
		expect(execQMD(["status"])).toBeNull();
	});

	it("passes custom timeout", () => {
		mockExecFileSync.mockReturnValue("");
		execQMD(["query", "test"], 60_000);
		expect(mockExecFileSync).toHaveBeenCalledWith(
			"qmd",
			["query", "test"],
			expect.objectContaining({ timeout: 60_000 }),
		);
	});

	it("sets NO_COLOR env", () => {
		mockExecFileSync.mockReturnValue("");
		execQMD(["status"]);
		expect(mockExecFileSync).toHaveBeenCalledWith(
			"qmd",
			["status"],
			expect.objectContaining({
				env: expect.objectContaining({ NO_COLOR: "1" }),
			}),
		);
	});
});

// ── parseQMDJson ─────────────────────────────────────────────────

describe("parseQMDJson", () => {
	it("parses valid JSON array", () => {
		const input: QMDJsonResult[] = [
			{ docid: "#abc123", score: 0.85, file: "knowledge/git.md", title: "Git Rules" },
		];
		expect(parseQMDJson(JSON.stringify(input))).toEqual(input);
	});

	it("returns empty array for invalid JSON", () => {
		expect(parseQMDJson("not json")).toEqual([]);
	});

	it("returns empty array for non-array JSON", () => {
		expect(parseQMDJson('{"key": "value"}')).toEqual([]);
	});

	it("returns empty array for empty string", () => {
		expect(parseQMDJson("")).toEqual([]);
	});

	it("handles results with optional fields", () => {
		const input = [
			{
				docid: "#abc123",
				score: 0.9,
				file: "knowledge/tone.md",
				title: "Tone Guide",
				context: "Knowledge base",
				snippet: "Write with confidence...",
				body: "# Tone Guide\n\nWrite with confidence.",
			},
		];
		const result = parseQMDJson(JSON.stringify(input));
		expect(result[0].context).toBe("Knowledge base");
		expect(result[0].snippet).toBe("Write with confidence...");
		expect(result[0].body).toBe("# Tone Guide\n\nWrite with confidence.");
	});
});

// ── QMDSearch ────────────────────────────────────────────────────

describe("QMDSearch", () => {
	let qmd: QMDSearch;

	beforeEach(() => {
		qmd = new QMDSearch();
	});

	describe("available", () => {
		it("returns true when qmd status shows the collection", () => {
			mockExecFileSync.mockReturnValue(
				`Collections:\n  pi-memory  (42 docs, /home/user/.pi/memory)\n`,
			);
			expect(qmd.available).toBe(true);
		});

		it("returns false when qmd is not installed", () => {
			mockExecFileSync.mockImplementation(() => {
				throw new Error("command not found");
			});
			expect(qmd.available).toBe(false);
		});

		it("returns false when collection is not registered", () => {
			mockExecFileSync.mockReturnValue(
				`Collections:\n  other-collection  (10 docs)\n`,
			);
			expect(qmd.available).toBe(false);
		});

		it("caches availability check", () => {
			mockExecFileSync.mockReturnValue("pi-memory");
			expect(qmd.available).toBe(true);
			expect(qmd.available).toBe(true); // second call
			// execFileSync should only be called once (for "status")
			expect(mockExecFileSync).toHaveBeenCalledTimes(1);
		});

		it("resetAvailability forces re-check", () => {
			mockExecFileSync.mockReturnValue("pi-memory");
			expect(qmd.available).toBe(true);

			qmd.resetAvailability();
			mockExecFileSync.mockReturnValue("other-collection");
			expect(qmd.available).toBe(false);
		});
	});

	describe("search", () => {
		it("returns empty for empty query", () => {
			mockExecFileSync.mockReturnValue("pi-memory");
			expect(qmd.search("")).toEqual([]);
		});

		it("returns empty when qmd is not available", () => {
			mockExecFileSync.mockImplementation(() => {
				throw new Error("not found");
			});
			expect(qmd.search("test")).toEqual([]);
		});

		it("parses qmd search results", () => {
			// First call: status check
			mockExecFileSync.mockReturnValueOnce("pi-memory");
			// Second call: search
			mockExecFileSync.mockReturnValueOnce(
				JSON.stringify([
					{
						docid: "#abc123",
						score: 0.85,
						file: "knowledge/git-rules.md",
						title: "Git Rules",
						snippet: "Use conventional commits",
					},
				]),
			);

			const results = qmd.search("git conventions", 5);
			expect(results).toHaveLength(1);
			expect(results[0]).toEqual({
				path: "knowledge/git-rules.md",
				title: "Git Rules",
				score: 0.85,
				snippet: "Use conventional commits",
				category: "knowledge",
			});
		});

		it("passes correct CLI args", () => {
			mockExecFileSync.mockReturnValueOnce("pi-memory");
			mockExecFileSync.mockReturnValueOnce("[]");

			qmd.search("test query", 10);
			expect(mockExecFileSync).toHaveBeenCalledWith(
				"qmd",
				["search", "test query", "--json", "-n", "10", "-c", QMD_COLLECTION_NAME],
				expect.anything(),
			);
		});

		it("categorizes paths correctly", () => {
			mockExecFileSync.mockReturnValueOnce("pi-memory");
			mockExecFileSync.mockReturnValueOnce(
				JSON.stringify([
					{ docid: "#a", score: 0.9, file: "core/activeProjects.md", title: "Active" },
					{ docid: "#b", score: 0.8, file: "knowledge/rules.md", title: "Rules" },
					{ docid: "#c", score: 0.7, file: "history/daily/2025-03/file.md", title: "History" },
					{ docid: "#d", score: 0.6, file: "other/misc.md", title: "Misc" },
				]),
			);

			const results = qmd.search("test");
			expect(results.map((r) => r.category)).toEqual(["core", "knowledge", "history", "other"]);
		});

		it("returns empty when search command fails", () => {
			mockExecFileSync.mockReturnValueOnce("pi-memory"); // status ok
			mockExecFileSync.mockImplementationOnce(() => {
				throw new Error("search failed");
			});
			expect(qmd.search("test")).toEqual([]);
		});
	});

	describe("queryHybrid", () => {
		it("returns empty for empty query", () => {
			mockExecFileSync.mockReturnValue("pi-memory");
			expect(qmd.queryHybrid("")).toEqual([]);
		});

		it("uses 'query' command with 60s timeout", () => {
			mockExecFileSync.mockReturnValueOnce("pi-memory");
			mockExecFileSync.mockReturnValueOnce("[]");

			qmd.queryHybrid("semantic search test", 5);
			expect(mockExecFileSync).toHaveBeenCalledWith(
				"qmd",
				["query", "semantic search test", "--json", "-n", "5", "-c", QMD_COLLECTION_NAME],
				expect.objectContaining({ timeout: 60_000 }),
			);
		});

		it("passes minScore when positive", () => {
			mockExecFileSync.mockReturnValueOnce("pi-memory");
			mockExecFileSync.mockReturnValueOnce("[]");

			qmd.queryHybrid("test", 5, 0.3);
			expect(mockExecFileSync).toHaveBeenCalledWith(
				"qmd",
				["query", "test", "--json", "-n", "5", "-c", QMD_COLLECTION_NAME, "--min-score", "0.3"],
				expect.anything(),
			);
		});

		it("returns empty when query command fails", () => {
			mockExecFileSync.mockReturnValueOnce("pi-memory"); // status ok
			mockExecFileSync.mockImplementationOnce(() => {
				throw new Error("query failed");
			});
			expect(qmd.queryHybrid("test")).toEqual([]);
		});

		it("handles results without snippet", () => {
			mockExecFileSync.mockReturnValueOnce("pi-memory");
			mockExecFileSync.mockReturnValueOnce(
				JSON.stringify([
					{ docid: "#a", score: 0.9, file: "knowledge/a.md", title: "A" },
				]),
			);
			const results = qmd.queryHybrid("test");
			expect(results[0].snippet).toBe("");
		});

		it("omits minScore when zero", () => {
			mockExecFileSync.mockReturnValueOnce("pi-memory");
			mockExecFileSync.mockReturnValueOnce("[]");

			qmd.queryHybrid("test", 5, 0);
			const args = mockExecFileSync.mock.calls[1][1] as string[];
			expect(args).not.toContain("--min-score");
		});
	});

	describe("searchForContext", () => {
		it("returns empty for empty query", () => {
			mockExecFileSync.mockReturnValue("pi-memory");
			expect(qmd.searchForContext("")).toEqual([]);
		});

		it("filters out core files", () => {
			mockExecFileSync.mockReturnValueOnce("pi-memory");
			mockExecFileSync.mockReturnValueOnce(
				JSON.stringify([
					{ docid: "#a", score: 0.9, file: "core/activeProjects.md", title: "Active", body: "projects" },
					{ docid: "#b", score: 0.85, file: "knowledge/rules.md", title: "Rules", body: "conventions" },
				]),
			);

			const results = qmd.searchForContext("projects");
			expect(results).toHaveLength(1);
			expect(results[0].path).toBe("knowledge/rules.md");
		});

		it("includes knowledge files regardless of score", () => {
			mockExecFileSync.mockReturnValueOnce("pi-memory");
			mockExecFileSync.mockReturnValueOnce(
				JSON.stringify([
					{ docid: "#a", score: 0.9, file: "knowledge/high.md", title: "High", body: "content1" },
					{ docid: "#b", score: 0.1, file: "knowledge/low.md", title: "Low", body: "content2" },
				]),
			);

			const results = qmd.searchForContext("test", 5);
			expect(results).toHaveLength(2);
		});

		it("filters low-scoring history files", () => {
			mockExecFileSync.mockReturnValueOnce("pi-memory");
			mockExecFileSync.mockReturnValueOnce(
				JSON.stringify([
					{ docid: "#a", score: 0.9, file: "knowledge/high.md", title: "High", body: "a" },
					{ docid: "#b", score: 0.8, file: "history/daily/2025/file.md", title: "Good History", body: "b" },
					{ docid: "#c", score: 0.2, file: "history/daily/2025/old.md", title: "Bad History", body: "c" },
				]),
			);

			const results = qmd.searchForContext("test", 5);
			// History at 0.8 should pass (> 0.9 * 0.5 = 0.45), history at 0.2 should not
			expect(results.map((r) => r.path)).toContain("history/daily/2025/file.md");
			expect(results.map((r) => r.path)).not.toContain("history/daily/2025/old.md");
		});

		it("respects limit", () => {
			mockExecFileSync.mockReturnValueOnce("pi-memory");
			mockExecFileSync.mockReturnValueOnce(
				JSON.stringify([
					{ docid: "#a", score: 0.9, file: "knowledge/a.md", title: "A", body: "a" },
					{ docid: "#b", score: 0.8, file: "knowledge/b.md", title: "B", body: "b" },
					{ docid: "#c", score: 0.7, file: "knowledge/c.md", title: "C", body: "c" },
				]),
			);

			const results = qmd.searchForContext("test", 2);
			expect(results).toHaveLength(2);
		});

		it("uses body content, falls back to snippet", () => {
			mockExecFileSync.mockReturnValueOnce("pi-memory");
			mockExecFileSync.mockReturnValueOnce(
				JSON.stringify([
					{ docid: "#a", score: 0.9, file: "knowledge/a.md", title: "A", body: "full body content" },
					{ docid: "#b", score: 0.8, file: "knowledge/b.md", title: "B", snippet: "snippet only" },
				]),
			);

			const results = qmd.searchForContext("test", 5);
			expect(results[0].content).toBe("full body content");
			expect(results[1].content).toBe("snippet only");
		});

		it("passes minScore to searchForContext when positive", () => {
			mockExecFileSync.mockReturnValueOnce("pi-memory");
			mockExecFileSync.mockReturnValueOnce("[]");

			qmd.searchForContext("test", 3, 0.5);
			const args = mockExecFileSync.mock.calls[1][1] as string[];
			expect(args).toContain("--min-score");
			expect(args).toContain("0.5");
		});

		it("excludes 'other' category files", () => {
			mockExecFileSync.mockReturnValueOnce("pi-memory");
			mockExecFileSync.mockReturnValueOnce(
				JSON.stringify([
					{ docid: "#a", score: 0.9, file: "knowledge/rules.md", title: "Rules", body: "a" },
					{ docid: "#b", score: 0.85, file: "random/misc.md", title: "Misc", body: "b" },
				]),
			);

			const results = qmd.searchForContext("test", 5);
			expect(results).toHaveLength(1);
			expect(results[0].path).toBe("knowledge/rules.md");
		});

		it("returns empty when qmd command fails", () => {
			mockExecFileSync.mockReturnValueOnce("pi-memory"); // status ok
			mockExecFileSync.mockImplementationOnce(() => {
				throw new Error("query failed");
			});
			expect(qmd.searchForContext("test")).toEqual([]);
		});

		it("uses --full flag for full document content", () => {
			mockExecFileSync.mockReturnValueOnce("pi-memory");
			mockExecFileSync.mockReturnValueOnce("[]");

			qmd.searchForContext("test", 3);
			const args = mockExecFileSync.mock.calls[1][1] as string[];
			expect(args).toContain("--full");
		});

		it("excludes knowledge when includeKnowledge is false", () => {
			mockExecFileSync.mockReturnValueOnce("pi-memory");
			mockExecFileSync.mockReturnValueOnce(
				JSON.stringify([
					{ docid: "#a", score: 0.9, file: "knowledge/rules.md", title: "Rules", body: "a" },
					{ docid: "#b", score: 0.8, file: "history/daily/2025-01/2025-01-01.md", title: "Jan", body: "b" },
				]),
			);

			const results = qmd.searchForContext("test", 5, 0, { includeKnowledge: false });
			expect(results).toHaveLength(1);
			expect(results[0].path).toContain("history");
		});

		it("excludes history when includeHistory is false", () => {
			mockExecFileSync.mockReturnValueOnce("pi-memory");
			mockExecFileSync.mockReturnValueOnce(
				JSON.stringify([
					{ docid: "#a", score: 0.9, file: "knowledge/rules.md", title: "Rules", body: "a" },
					{ docid: "#b", score: 0.8, file: "history/daily/2025-01/2025-01-01.md", title: "Jan", body: "b" },
				]),
			);

			const results = qmd.searchForContext("test", 5, 0, { includeHistory: false });
			expect(results).toHaveLength(1);
			expect(results[0].path).toContain("knowledge");
		});

		it("computes history threshold from included categories only", () => {
			mockExecFileSync.mockReturnValueOnce("pi-memory");
			// Knowledge is excluded but scores highest — should not inflate history threshold
			mockExecFileSync.mockReturnValueOnce(
				JSON.stringify([
					{ docid: "#a", score: 1.0, file: "knowledge/rules.md", title: "Rules", body: "a" },
					{ docid: "#b", score: 0.45, file: "history/daily/2025-01/2025-01-01.md", title: "Jan", body: "b" },
				]),
			);

			// Without fix: topScore=1.0 from excluded knowledge, threshold=0.5, history(0.45) dropped
			// With fix: topScore=0.45 from history itself, threshold=0.225, history(0.45) included
			const results = qmd.searchForContext("test", 5, 0, { includeKnowledge: false });
			expect(results).toHaveLength(1);
			expect(results[0].path).toContain("history");
		});
	});

	describe("setup", () => {
		it("returns error when qmd is not installed", () => {
			mockExecFileSync.mockImplementation(() => {
				throw new Error("not found");
			});
			const result = qmd.setup("/home/user/.pi/memory");
			expect(result.success).toBe(false);
			expect(result.message).toContain("not installed");
		});

		it("adds collection when not existing", () => {
			// --version
			mockExecFileSync.mockReturnValueOnce("2.0.1");
			// status (no pi-memory)
			mockExecFileSync.mockReturnValueOnce("Collections:\n  other  (5 docs)\n");
			// collection add
			mockExecFileSync.mockReturnValueOnce("Collection added");
			// context add
			mockExecFileSync.mockReturnValueOnce("Context added");
			// embed
			mockExecFileSync.mockReturnValueOnce("Embedded 42 documents");

			const result = qmd.setup("/home/user/.pi/memory");
			expect(result.success).toBe(true);
			expect(result.message).toContain("Collection");
			expect(result.message).toContain("added");

			// Verify collection add was called with correct args
			expect(mockExecFileSync).toHaveBeenCalledWith(
				"qmd",
				["collection", "add", "/home/user/.pi/memory", "--name", QMD_COLLECTION_NAME, "--mask", "**/*.md"],
				expect.anything(),
			);
		});

		it("updates collection when already existing", () => {
			mockExecFileSync.mockReturnValueOnce("2.0.1");
			mockExecFileSync.mockReturnValueOnce(`Collections:\n  ${QMD_COLLECTION_NAME}  (42 docs)\n`);
			// update
			mockExecFileSync.mockReturnValueOnce("Updated");
			// context add
			mockExecFileSync.mockReturnValueOnce("Context added");
			// embed
			mockExecFileSync.mockReturnValueOnce("Done");

			const result = qmd.setup("/home/user/.pi/memory");
			expect(result.success).toBe(true);
			expect(result.message).toContain("updated");
		});

		it("returns error when collection add fails", () => {
			mockExecFileSync.mockReturnValueOnce("2.0.1");
			mockExecFileSync.mockReturnValueOnce("Collections:\n");
			// collection add fails
			mockExecFileSync.mockImplementationOnce(() => {
				throw new Error("failed");
			});

			const result = qmd.setup("/home/user/.pi/memory");
			expect(result.success).toBe(false);
			expect(result.message).toContain("Failed to add collection");
		});

		it("succeeds even if embed fails", () => {
			mockExecFileSync.mockReturnValueOnce("2.0.1");
			mockExecFileSync.mockReturnValueOnce(`${QMD_COLLECTION_NAME}`);
			mockExecFileSync.mockReturnValueOnce("Updated"); // update
			mockExecFileSync.mockReturnValueOnce("Context added"); // context
			// embed fails
			mockExecFileSync.mockImplementationOnce(() => {
				throw new Error("embed failed");
			});

			const result = qmd.setup("/home/user/.pi/memory");
			expect(result.success).toBe(true);
			expect(result.message).toContain("Warning: embedding generation failed");
		});

		it("resets availability cache after setup", () => {
			// Initial check: not available
			mockExecFileSync.mockImplementationOnce(() => {
				throw new Error("not found");
			});
			expect(qmd.available).toBe(false);

			// Setup succeeds
			mockExecFileSync.mockReturnValueOnce("2.0.1");
			mockExecFileSync.mockReturnValueOnce(`${QMD_COLLECTION_NAME}`);
			mockExecFileSync.mockReturnValueOnce("Updated");
			mockExecFileSync.mockReturnValueOnce("Context added");
			mockExecFileSync.mockReturnValueOnce("Embedded");
			qmd.setup("/memory");

			// Now available check should re-run (not use cached false)
			mockExecFileSync.mockReturnValueOnce(`${QMD_COLLECTION_NAME}`);
			expect(qmd.available).toBe(true);
		});
	describe("updateIndex", () => {
		it("calls qmd update when available", () => {
			mockExecFileSync.mockReturnValueOnce("pi-memory"); // status check
			expect(qmd.available).toBe(true);

			mockExecFileSync.mockReturnValueOnce("Updated 3 documents");
			qmd.updateIndex();

			expect(mockExecFileSync).toHaveBeenCalledWith(
				"qmd",
				["update", "-c", QMD_COLLECTION_NAME],
				expect.objectContaining({ timeout: 30_000 }),
			);
		});

		it("does nothing when qmd is not available", () => {
			mockExecFileSync.mockImplementationOnce(() => {
				throw new Error("not found");
			});
			expect(qmd.available).toBe(false);

			qmd.updateIndex();
			// Only 1 call (the status check), no update call
			expect(mockExecFileSync).toHaveBeenCalledTimes(1);
		});

		it("silently handles update failures", () => {
			mockExecFileSync.mockReturnValueOnce("pi-memory"); // available
			mockExecFileSync.mockImplementationOnce(() => {
				throw new Error("update failed");
			});

			// Should not throw
			expect(() => qmd.updateIndex()).not.toThrow();
		});
	});

		it("handles failed update in existing collection", () => {
			mockExecFileSync.mockReturnValueOnce("2.0.1");
			mockExecFileSync.mockReturnValueOnce(`${QMD_COLLECTION_NAME}`);
			// update fails
			mockExecFileSync.mockImplementationOnce(() => {
				throw new Error("update failed");
			});
			// context add
			mockExecFileSync.mockReturnValueOnce("Context added");
			// embed
			mockExecFileSync.mockReturnValueOnce("Done");

			const result = qmd.setup("/memory");
			expect(result.success).toBe(true);
			// Should not contain "updated" since update failed
			expect(result.message).not.toContain("updated");
		});

		it("handles failed context add gracefully", () => {
			mockExecFileSync.mockReturnValueOnce("2.0.1");
			mockExecFileSync.mockReturnValueOnce(`${QMD_COLLECTION_NAME}`);
			mockExecFileSync.mockReturnValueOnce("Updated"); // update
			// context add fails
			mockExecFileSync.mockImplementationOnce(() => {
				throw new Error("context failed");
			});
			// embed
			mockExecFileSync.mockReturnValueOnce("Done");

			const result = qmd.setup("/memory");
			expect(result.success).toBe(true);
			expect(result.message).not.toContain("Context annotation added");
		});
	});

	describe("searchForContext edge cases", () => {
		it("handles missing body and snippet", () => {
			mockExecFileSync.mockReturnValueOnce("pi-memory");
			mockExecFileSync.mockReturnValueOnce(
				JSON.stringify([
					{ docid: "#a", score: 0.9, file: "knowledge/a.md", title: "A" },
				]),
			);

			const results = qmd.searchForContext("test");
			expect(results[0].content).toBe("");
		});
	});

	describe("custom collection name", () => {
		it("uses custom collection name", () => {
			const custom = new QMDSearch("my-custom-collection");
			mockExecFileSync.mockReturnValueOnce("my-custom-collection (5 docs)");
			expect(custom.available).toBe(true);
		});

		it("defaults to pi-memory", () => {
			expect(QMD_COLLECTION_NAME).toBe("pi-memory");
		});
	});
});
