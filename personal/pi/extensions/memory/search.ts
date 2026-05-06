/**
 * Memory Search — MiniSearch-powered full-text search over the memory bank.
 *
 * Builds an in-memory index of all .md files in the memory bank on session start.
 * Provides fuzzy BM25 search for:
 *   1. Automatic knowledge injection in before_agent_start (replaces trigger words)
 *   2. Explicit memory_search tool for agent-driven recall
 *
 * The index is rebuilt from disk on session start and updated incrementally
 * when memory_update or memory_append write files.
 */

import MiniSearch from "minisearch";
import * as fs from "node:fs";
import * as path from "node:path";

export interface MemoryDocument {
	id: string;       // relative path from memory root (e.g. "knowledge/git-rules.md")
	title: string;    // extracted from first heading or filename
	content: string;  // full file content
	category: string; // "core" | "knowledge" | "history"
}

export interface SearchResult {
	path: string;
	title: string;
	score: number;
	snippet: string;
	category: string;
}

/** Extract title from markdown content — first heading or fallback to filename */
export function extractTitle(content: string, filename: string): string {
	const match = content.match(/^#{1,3}\s+(.+)/m);
	return match?.[1]?.trim() ?? filename.replace(/\.md$/, "");
}

/** Determine category from relative path */
export function categorize(relPath: string): string {
	if (relPath.startsWith("core/")) return "core";
	if (relPath.startsWith("knowledge/")) return "knowledge";
	if (relPath.startsWith("history/")) return "history";
	return "other";
}

/** Extract a snippet around the best matching terms */
export function extractSnippet(content: string, query: string, maxLen = 200): string {
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
	const lines = content.split("\n");

	// Find the first line containing any query term
	let bestLine = -1;
	for (let i = 0; i < lines.length; i++) {
		const lower = lines[i].toLowerCase();
		if (terms.some((t) => lower.includes(t))) {
			bestLine = i;
			break;
		}
	}

	if (bestLine === -1) {
		// No direct match — return beginning of content
		return content.slice(0, maxLen).trim() + (content.length > maxLen ? "…" : "");
	}

	// Grab a window around the matching line
	const start = Math.max(0, bestLine - 1);
	const snippet = lines.slice(start, start + 4).join("\n");
	return snippet.slice(0, maxLen).trim() + (snippet.length > maxLen ? "…" : "");
}

/** Walk a directory recursively and collect all .md files */
export function walkMarkdownFiles(
	dir: string,
	root: string,
	maxDepth = 5,
	depth = 0,
): MemoryDocument[] {
	if (depth >= maxDepth) return [];

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}

	const docs: MemoryDocument[] = [];
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			docs.push(...walkMarkdownFiles(full, root, maxDepth, depth + 1));
		} else if (entry.name.endsWith(".md")) {
			const content = fs.readFileSync(full, "utf-8");
			const relPath = path.relative(root, full);
			docs.push({
				id: relPath,
				title: extractTitle(content, entry.name),
				content,
				category: categorize(relPath),
			});
		}
	}
	return docs;
}

export class MemoryIndex {
	private index: MiniSearch<MemoryDocument>;
	private root: string;

	constructor(root: string) {
		this.root = root;
		this.index = this.makeIndex();
	}

	private makeIndex(): MiniSearch<MemoryDocument> {
		return new MiniSearch<MemoryDocument>({
			fields: ["title", "content"],
			storeFields: ["title", "category"],
			searchOptions: {
				boost: { title: 3 },
				fuzzy: 0.2,
				prefix: true,
			},
			// Disable auto-vacuum. discard() followed by add() (our updateDocument
			// pattern) schedules async batched vacuuming that walks the radix tree
			// while subsequent writes mutate it, crashing TreeIterator:
			//   TypeError: Cannot read properties of undefined (reading 'keys')
			//     at TreeIterator.dive (minisearch/dist/es/index.js:34:63)
			//     at MiniSearch.performVacuuming
			// Discarded IDs are cleaned up on search instead. For a ~15-file memory
			// bank the un-vacuumed memory overhead is negligible; whole-index
			// rebuilds happen on build().
			autoVacuum: false,
		});
	}

	/** Build the full index by scanning all .md files in the memory bank */
	build(): number {
		// Reset — create a fresh index
		this.index = this.makeIndex();

		const docs = walkMarkdownFiles(this.root, this.root);
		if (docs.length > 0) {
			this.index.addAll(docs);
		}
		return docs.length;
	}

	/** Update a single document in the index (after a write) */
	updateDocument(relPath: string): void {
		if (!relPath.endsWith(".md")) return;

		const fullPath = path.resolve(this.root, relPath);
		try {
			this.index.discard(relPath);
		} catch {
			// Not in index yet — that's fine
		}

		// Re-add if file still exists
		let content: string;
		try {
			content = fs.readFileSync(fullPath, "utf-8");
		} catch {
			return; // file deleted — just discard
		}

		const doc: MemoryDocument = {
			id: relPath,
			title: extractTitle(content, path.basename(relPath)),
			content,
			category: categorize(relPath),
		};
		this.index.add(doc);
	}

	/** Search the memory bank. Returns ranked results with snippets. */
	search(query: string, limit = 5): SearchResult[] {
		if (!query.trim()) return [];

		const results = this.index.search(query).slice(0, limit);
		return results.map((r) => {
			const stored = r as typeof r & { title: string; category: string };
			const fullPath = path.resolve(this.root, r.id);
			let content: string;
			try {
				content = fs.readFileSync(fullPath, "utf-8");
			} catch {
				content = "";
			}

			return {
				path: r.id,
				title: stored.title,
				score: r.score,
				snippet: extractSnippet(content, query),
				category: stored.category,
			};
		});
	}

	/** Search and return full file contents for knowledge injection */
	searchForContext(
		query: string,
		limit = 3,
		minScore?: number,
		options?: { includeKnowledge?: boolean; includeHistory?: boolean },
	): Array<{ path: string; title: string; content: string; score: number }> {
		if (!query.trim()) return [];

		const includeKnowledge = options?.includeKnowledge ?? true;
		const includeHistory = options?.includeHistory ?? true;

		const results = this.index.search(query).slice(0, limit * 2);

		// Compute topScore from included categories only, so excluded
		// high-scoring results don't inflate the history threshold.
		let topScore = 0;
		for (const r of results) {
			const cat = (r as typeof r & { category: string }).category;
			if ((cat === "knowledge" && includeKnowledge) || (cat === "history" && includeHistory)) {
				topScore = r.score; // first match is highest scored
				break;
			}
		}

		// Filter by category based on caller options
		const relevant = results.filter((r) => {
			const cat = (r as typeof r & { category: string }).category;
			if (cat === "knowledge") return includeKnowledge;
			if (cat === "history") return includeHistory && r.score > topScore * 0.5;
			return false;
		});

		// Apply minimum score threshold if provided
		const threshold = minScore ?? 0;
		const filtered = relevant.filter((r) => r.score >= threshold);

		return filtered.slice(0, limit).map((r) => {
			const stored = r as typeof r & { title: string };
			const fullPath = path.resolve(this.root, r.id);
			let content: string;
			try {
				content = fs.readFileSync(fullPath, "utf-8");
			} catch {
				content = "";
			}
			return {
				path: r.id,
				title: stored.title,
				content,
				score: r.score,
			};
		});
	}

	/** Get the number of indexed documents */
	get documentCount(): number {
		return this.index.documentCount;
	}
}
