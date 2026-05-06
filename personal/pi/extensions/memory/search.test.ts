import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
	extractTitle,
	categorize,
	extractSnippet,
	walkMarkdownFiles,
	MemoryIndex,
} from "./search.js";

// ── extractTitle ─────────────────────────────────────────────────

describe("extractTitle", () => {
	it("extracts h1 heading", () => {
		expect(extractTitle("# My Title\n\nSome content", "file.md")).toBe("My Title");
	});

	it("extracts h2 heading", () => {
		expect(extractTitle("## Second Level\n\nContent", "file.md")).toBe("Second Level");
	});

	it("extracts h3 heading", () => {
		expect(extractTitle("### Third Level", "file.md")).toBe("Third Level");
	});

	it("falls back to filename without .md", () => {
		expect(extractTitle("No heading here, just text.", "my-notes.md")).toBe("my-notes");
	});

	it("uses first heading even if not on line 1", () => {
		expect(extractTitle("Some preamble\n\n# The Heading\n\nMore text", "f.md")).toBe("The Heading");
	});

	it("trims whitespace from heading", () => {
		expect(extractTitle("#   Spaced Title   \n", "f.md")).toBe("Spaced Title");
	});
});

// ── categorize ───────────────────────────────────────────────────

describe("categorize", () => {
	it("returns 'core' for core/ paths", () => {
		expect(categorize("core/activeProjects.md")).toBe("core");
	});

	it("returns 'knowledge' for knowledge/ paths", () => {
		expect(categorize("knowledge/git-rules.md")).toBe("knowledge");
	});

	it("returns 'history' for history/ paths", () => {
		expect(categorize("history/daily/2025-03/file.md")).toBe("history");
	});

	it("returns 'other' for unknown paths", () => {
		expect(categorize("random/file.md")).toBe("other");
	});
});

// ── extractSnippet ───────────────────────────────────────────────

describe("extractSnippet", () => {
	it("returns snippet around matching line", () => {
		const content = "Line one\nLine two\nThe answer is 42\nLine four\nLine five";
		const snippet = extractSnippet(content, "answer");
		expect(snippet).toContain("The answer is 42");
	});

	it("returns beginning of content when no match found", () => {
		const content = "Some long content that goes on and on";
		const snippet = extractSnippet(content, "nonexistent");
		expect(snippet).toContain("Some long content");
	});

	it("truncates long snippets with ellipsis", () => {
		const longLine = "x".repeat(300);
		const content = `${longLine}\nThe match is here`;
		const snippet = extractSnippet(content, "nonexistent", 50);
		expect(snippet.length).toBeLessThanOrEqual(51); // 50 + "…"
		expect(snippet).toContain("…");
	});

	it("includes context lines around the match", () => {
		const content = "Before line\nThe match line\nAfter line";
		const snippet = extractSnippet(content, "match");
		expect(snippet).toContain("Before line");
		expect(snippet).toContain("The match line");
		expect(snippet).toContain("After line");
	});

	it("handles empty query gracefully", () => {
		const content = "Some content here";
		const snippet = extractSnippet(content, "");
		expect(snippet).toContain("Some content");
	});

	it("does not add ellipsis when content fits", () => {
		const content = "Short";
		const snippet = extractSnippet(content, "nonexistent", 200);
		expect(snippet).toBe("Short");
	});

	it("adds ellipsis when matching snippet is truncated", () => {
		const lines = Array.from({ length: 10 }, (_, i) => `Line ${i} with keyword`);
		const content = lines.join("\n");
		const snippet = extractSnippet(content, "keyword", 50);
		expect(snippet).toContain("…");
	});
});

// ── walkMarkdownFiles + MemoryIndex ──────────────────────────────

describe("walkMarkdownFiles", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-test-"));

		// Create a mini memory bank structure
		fs.mkdirSync(path.join(tmpDir, "core"), { recursive: true });
		fs.mkdirSync(path.join(tmpDir, "knowledge"), { recursive: true });
		fs.mkdirSync(path.join(tmpDir, "history", "daily", "2025-03"), { recursive: true });

		fs.writeFileSync(path.join(tmpDir, "core", "activeProjects.md"), "# Active Projects\n\n- Project A\n");
		fs.writeFileSync(path.join(tmpDir, "core", "dailyContext.md"), "## 2025-03-24\n\n### In Progress\n- Task 1\n");
		fs.writeFileSync(
			path.join(tmpDir, "knowledge", "git-rules.md"),
			"# Git Rules\n\nAlways use conventional commits.\nSquash before merging.\n",
		);
		fs.writeFileSync(
			path.join(tmpDir, "knowledge", "tone-guide.md"),
			"# Tone Guide\n\nWrite proposals with confidence.\nAvoid hedging language.\nBe direct and specific.\n",
		);
		fs.writeFileSync(
			path.join(tmpDir, "history", "daily", "2025-03", "2025-03-20-dailyContext.md"),
			"## 2025-03-20\n\n### Completed\n- Decided on webhook topic naming\n",
		);

		// Non-md file should be ignored
		fs.writeFileSync(path.join(tmpDir, "knowledge", "index.csv"), "filename,description,triggers\n");
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("finds all .md files recursively", () => {
		const docs = walkMarkdownFiles(tmpDir, tmpDir);
		expect(docs.length).toBe(5);
		expect(docs.map((d) => d.id).sort()).toEqual([
			"core/activeProjects.md",
			"core/dailyContext.md",
			"history/daily/2025-03/2025-03-20-dailyContext.md",
			"knowledge/git-rules.md",
			"knowledge/tone-guide.md",
		]);
	});

	it("skips non-.md files", () => {
		const docs = walkMarkdownFiles(tmpDir, tmpDir);
		expect(docs.find((d) => d.id.endsWith(".csv"))).toBeUndefined();
	});

	it("extracts titles from headings", () => {
		const docs = walkMarkdownFiles(tmpDir, tmpDir);
		const gitRules = docs.find((d) => d.id === "knowledge/git-rules.md");
		expect(gitRules?.title).toBe("Git Rules");
	});

	it("assigns correct categories", () => {
		const docs = walkMarkdownFiles(tmpDir, tmpDir);
		const categories = Object.fromEntries(docs.map((d) => [d.id, d.category]));
		expect(categories["core/activeProjects.md"]).toBe("core");
		expect(categories["knowledge/git-rules.md"]).toBe("knowledge");
		expect(categories["history/daily/2025-03/2025-03-20-dailyContext.md"]).toBe("history");
	});

	it("respects maxDepth", () => {
		const docs = walkMarkdownFiles(tmpDir, tmpDir, 1);
		// Should find core/ and knowledge/ files but NOT history/daily/2025-03/
		expect(docs.every((d) => !d.id.startsWith("history/daily/2025-03/"))).toBe(true);
	});

	it("returns empty array for nonexistent directory", () => {
		const docs = walkMarkdownFiles(path.join(tmpDir, "nonexistent"), tmpDir);
		expect(docs).toEqual([]);
	});
});

// ── MemoryIndex ──────────────────────────────────────────────────

describe("MemoryIndex", () => {
	let tmpDir: string;
	let index: MemoryIndex;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-idx-"));

		fs.mkdirSync(path.join(tmpDir, "core"), { recursive: true });
		fs.mkdirSync(path.join(tmpDir, "knowledge"), { recursive: true });
		fs.mkdirSync(path.join(tmpDir, "history", "daily", "2025-03"), { recursive: true });

		fs.writeFileSync(path.join(tmpDir, "core", "activeProjects.md"), "# Active Projects\n\n- Project Alpha P1\n");
		fs.writeFileSync(path.join(tmpDir, "core", "dailyContext.md"), "## 2025-03-24\n\n### Completed\n- Fixed auth bug\n");
		fs.writeFileSync(
			path.join(tmpDir, "knowledge", "git-rules.md"),
			"# Git Conventions\n\nUse conventional commits.\nAlways squash merge.\nPrefix with feat/fix/chore.\n",
		);
		fs.writeFileSync(
			path.join(tmpDir, "knowledge", "tone-guide.md"),
			"# Proposal Tone\n\nWrite with confidence and clarity.\nAvoid hedging words like maybe or perhaps.\nBe direct, specific, and assertive.\n",
		);
		fs.writeFileSync(
			path.join(tmpDir, "history", "daily", "2025-03", "2025-03-20-dailyContext.md"),
			"## 2025-03-20\n\n### Key Decisions\n- Decided on webhook naming convention\n- Auth refactor approach finalized\n",
		);

		index = new MemoryIndex(tmpDir);
		index.build();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("builds index with correct document count", () => {
		expect(index.documentCount).toBe(5);
	});

	it("searches by keyword", () => {
		const results = index.search("conventional commits");
		expect(results.length).toBeGreaterThan(0);
		expect(results[0].path).toBe("knowledge/git-rules.md");
	});

	it("finds knowledge files with fuzzy matching", () => {
		// "proposal" should match "Proposal Tone" title
		const results = index.search("proposal");
		expect(results.some((r) => r.path === "knowledge/tone-guide.md")).toBe(true);
	});

	it("searches across history files", () => {
		const results = index.search("webhook naming");
		expect(results.some((r) => r.path.includes("history/"))).toBe(true);
	});

	it("returns empty for empty query", () => {
		expect(index.search("")).toEqual([]);
		expect(index.search("   ")).toEqual([]);
	});

	it("returns empty for no matches", () => {
		const results = index.search("xyzzyplugh");
		expect(results).toEqual([]);
	});

	it("respects limit parameter", () => {
		const results = index.search("the", 2);
		expect(results.length).toBeLessThanOrEqual(2);
	});

	it("includes scores and snippets in results", () => {
		const results = index.search("git");
		expect(results[0].score).toBeGreaterThan(0);
		expect(results[0].snippet.length).toBeGreaterThan(0);
		expect(results[0].category).toBe("knowledge");
	});

	describe("updateDocument", () => {
		it("adds new documents to the index", () => {
			fs.writeFileSync(
				path.join(tmpDir, "knowledge", "new-rules.md"),
				"# New Rules\n\nSome brand new rules about deployment.\n",
			);
			index.updateDocument("knowledge/new-rules.md");
			expect(index.documentCount).toBe(6);

			const results = index.search("deployment");
			expect(results.some((r) => r.path === "knowledge/new-rules.md")).toBe(true);
		});

		it("updates existing documents in the index", () => {
			fs.writeFileSync(
				path.join(tmpDir, "knowledge", "git-rules.md"),
				"# Git Conventions\n\nNever force push to main.\n",
			);
			index.updateDocument("knowledge/git-rules.md");
			expect(index.documentCount).toBe(5); // same count

			const results = index.search("force push");
			expect(results.some((r) => r.path === "knowledge/git-rules.md")).toBe(true);
		});

		it("handles deleted files gracefully", () => {
			fs.unlinkSync(path.join(tmpDir, "knowledge", "git-rules.md"));
			index.updateDocument("knowledge/git-rules.md");
			expect(index.documentCount).toBe(4);
		});

		it("ignores non-.md files", () => {
			index.updateDocument("knowledge/index.csv");
			expect(index.documentCount).toBe(5); // unchanged
		});

		// Regression: with minisearch's default autoVacuum enabled, repeated
		// discard() + add() from many updateDocument() calls would schedule
		// async vacuum passes that mutated the radix tree while the iterator
		// was walking it, crashing with:
		//   TypeError: Cannot read properties of undefined (reading 'keys')
		//     at TreeIterator.dive
		//     at MiniSearch.performVacuuming
		it("survives many updates without crashing the minisearch iterator", async () => {
			// Seed the knowledge dir with enough docs and unique terms to push
			// minisearch past its internal vacuum thresholds (minDirtCount: 20,
			// minDirtFactor: 0.1).
			for (let i = 0; i < 40; i++) {
				const content = Array.from(
					{ length: 40 },
					(_, j) => `term${i}_${j}_${Math.random().toString(36).slice(2, 8)}`,
				).join(" ");
				fs.writeFileSync(
					path.join(tmpDir, "knowledge", `doc-${i}.md`),
					`# Doc ${i}\n\n${content}\n`,
				);
			}
			index.build();

			// Simulate many rounds of memory_update writes overwriting the files.
			expect(() => {
				for (let round = 0; round < 10; round++) {
					for (let i = 0; i < 40; i++) {
						const content = Array.from(
							{ length: 40 },
							(_, j) => `update${round}_${i}_${j}_${Math.random().toString(36).slice(2, 8)}`,
						).join(" ");
						fs.writeFileSync(
							path.join(tmpDir, "knowledge", `doc-${i}.md`),
							`# Doc ${i} r${round}\n\n${content}\n`,
						);
						index.updateDocument(`knowledge/doc-${i}.md`);
					}
				}
			}).not.toThrow();

			// Give any scheduled async vacuum a chance to run and potentially throw.
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Index is still usable.
			expect(index.documentCount).toBe(45); // 5 seeded + 40 generated
			expect(index.search("update9").length).toBeGreaterThan(0);
		});
	});

	describe("searchForContext", () => {
		it("returns knowledge files matching the prompt", () => {
			const hits = index.searchForContext("how to write proposals with good tone");
			expect(hits.some((h) => h.path === "knowledge/tone-guide.md")).toBe(true);
			expect(hits[0].content.length).toBeGreaterThan(0);
		});

		it("includes content in results", () => {
			const hits = index.searchForContext("git conventions");
			const gitHit = hits.find((h) => h.path === "knowledge/git-rules.md");
			expect(gitHit).toBeDefined();
			expect(gitHit!.content).toContain("conventional commits");
		});

		it("returns empty for empty query", () => {
			expect(index.searchForContext("")).toEqual([]);
			expect(index.searchForContext("   ")).toEqual([]);
		});

		it("filters out core files — they're already injected", () => {
			const hits = index.searchForContext("active projects");
			expect(hits.every((h) => h.path.startsWith("knowledge/") || h.path.startsWith("history/"))).toBe(true);
		});

		it("respects limit parameter", () => {
			const hits = index.searchForContext("the", 1);
			expect(hits.length).toBeLessThanOrEqual(1);
		});

		it("respects minScore parameter", () => {
			const hits = index.searchForContext("git", 10, 999999);
			expect(hits).toEqual([]);
		});

		it("includes high-scoring history files", () => {
			const hits = index.searchForContext("webhook naming convention");
			expect(hits.some((h) => h.path.includes("history/"))).toBe(true);
		});

		it("excludes knowledge when includeKnowledge is false", () => {
			const hits = index.searchForContext("git conventions", 3, undefined, { includeKnowledge: false });
			expect(hits.every((h) => !h.path.startsWith("knowledge/"))).toBe(true);
		});

		it("excludes history when includeHistory is false", () => {
			const hits = index.searchForContext("webhook naming convention", 3, undefined, { includeHistory: false });
			expect(hits.every((h) => !h.path.startsWith("history/"))).toBe(true);
		});

		it("returns empty when both categories excluded", () => {
			const hits = index.searchForContext("git", 3, undefined, { includeKnowledge: false, includeHistory: false });
			expect(hits).toEqual([]);
		});

		it("defaults to including both categories when options not provided", () => {
			const withOpts = index.searchForContext("webhook naming", 3, undefined, { includeKnowledge: true, includeHistory: true });
			const withoutOpts = index.searchForContext("webhook naming", 3);
			expect(withOpts.length).toBe(withoutOpts.length);
			expect(withOpts.map((h) => h.path)).toEqual(withoutOpts.map((h) => h.path));
		});
	});

	describe("search with deleted files", () => {
		it("handles files deleted after indexing in search()", () => {
			// Index includes the file, then delete it
			const results1 = index.search("git conventions");
			expect(results1.length).toBeGreaterThan(0);

			// Delete the file but keep it in the index
			fs.unlinkSync(path.join(tmpDir, "knowledge", "git-rules.md"));
			const results2 = index.search("git conventions");
			// Should still return results but with empty snippet
			expect(results2.length).toBeGreaterThan(0);
			expect(results2[0].snippet).toBe("");
		});

		it("handles files deleted after indexing in searchForContext()", () => {
			const hits1 = index.searchForContext("git conventions");
			expect(hits1.length).toBeGreaterThan(0);

			fs.unlinkSync(path.join(tmpDir, "knowledge", "git-rules.md"));
			const hits2 = index.searchForContext("git conventions");
			expect(hits2.length).toBeGreaterThan(0);
			expect(hits2[0].content).toBe("");
		});
	});

	describe("rebuild", () => {
		it("rebuilds cleanly without duplicates", () => {
			index.build();
			index.build();
			expect(index.documentCount).toBe(5);
		});

		it("picks up new files on rebuild", () => {
			fs.writeFileSync(path.join(tmpDir, "knowledge", "extra.md"), "# Extra\n\nExtra content.\n");
			const count = index.build();
			expect(count).toBe(6);
			expect(index.documentCount).toBe(6);
		});
	});

	describe("empty memory bank", () => {
		it("builds with zero documents when no .md files exist", () => {
			const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-empty-"));
			try {
				const emptyIndex = new MemoryIndex(emptyDir);
				const count = emptyIndex.build();
				expect(count).toBe(0);
				expect(emptyIndex.documentCount).toBe(0);
				expect(emptyIndex.search("anything")).toEqual([]);
				expect(emptyIndex.searchForContext("anything")).toEqual([]);
			} finally {
				fs.rmSync(emptyDir, { recursive: true, force: true });
			}
		});
	});
});
