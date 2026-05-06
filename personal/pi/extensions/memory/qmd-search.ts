/**
 * QMD Search — Optional qmd-powered search for the memory bank.
 *
 * When `qmd` CLI is installed and the memory bank is registered as a collection,
 * this provides semantic + BM25 hybrid search as an upgrade over MiniSearch.
 *
 * Falls back gracefully: if qmd is not installed or the collection isn't set up,
 * callers should use the MiniSearch-based MemoryIndex instead.
 */

import { execFileSync } from "node:child_process";

// ── Types ────────────────────────────────────────────────────────

/** A single result from qmd's --json output */
export interface QMDJsonResult {
	docid: string;
	score: number;
	file: string;
	title: string;
	context?: string;
	snippet?: string;
	body?: string;
}

export interface QMDSearchResult {
	path: string;
	title: string;
	score: number;
	snippet: string;
	category: string;
}

export interface QMDContextResult {
	path: string;
	title: string;
	content: string;
	score: number;
}

// ── Helpers ──────────────────────────────────────────────────────

/** Determine category from a qmd file path (collection-relative) */
function categorizeQMD(filePath: string): string {
	if (filePath.startsWith("core/")) return "core";
	if (filePath.startsWith("knowledge/")) return "knowledge";
	if (filePath.startsWith("history/")) return "history";
	return "other";
}

/**
 * Execute a qmd CLI command and return stdout.
 * Returns null if the command fails (qmd not installed, collection missing, etc.)
 */
export function execQMD(args: string[], timeoutMs = 30_000): string | null {
	try {
		const result = execFileSync("qmd", args, {
			encoding: "utf-8",
			timeout: timeoutMs,
			env: { ...process.env, NO_COLOR: "1" },
			stdio: ["pipe", "pipe", "pipe"],
		});
		return result;
	} catch {
		return null;
	}
}

/**
 * Parse qmd --json output into an array of results.
 * Returns empty array on parse failure.
 */
export function parseQMDJson(output: string): QMDJsonResult[] {
	try {
		const parsed = JSON.parse(output);
		if (!Array.isArray(parsed)) return [];
		return parsed;
	} catch {
		return [];
	}
}

// ── QMD Search Class ─────────────────────────────────────────────

export const QMD_COLLECTION_NAME = "pi-memory";

export class QMDSearch {
	private _available: boolean | null = null;
	private collectionName: string;

	constructor(collectionName = QMD_COLLECTION_NAME) {
		this.collectionName = collectionName;
	}

	/**
	 * Check if qmd is installed and the pi-memory collection exists.
	 * Caches the result — call resetAvailability() to re-check.
	 */
	get available(): boolean {
		if (this._available === null) {
			this._available = this.checkAvailability();
		}
		return this._available;
	}

	/** Force re-check availability (e.g. after setup-qmd) */
	resetAvailability(): void {
		this._available = null;
	}

	/**
	 * Check if qmd CLI is installed and the collection is registered.
	 */
	private checkAvailability(): boolean {
		const output = execQMD(["status"]);
		if (output === null) return false;
		// Check if our collection exists in the status output
		return output.includes(this.collectionName);
	}

	/**
	 * Search via qmd — uses `qmd search` (BM25 keyword search, fast).
	 * For best quality, use queryHybrid() instead.
	 */
	search(query: string, limit = 5): QMDSearchResult[] {
		if (!query.trim() || !this.available) return [];

		const output = execQMD([
			"search", query,
			"--json",
			"-n", String(limit),
			"-c", this.collectionName,
		]);
		if (!output) return [];

		return parseQMDJson(output).map((r) => ({
			path: r.file,
			title: r.title,
			score: r.score,
			snippet: r.snippet ?? "",
			category: categorizeQMD(r.file),
		}));
	}

	/**
	 * Hybrid search via `qmd query` — BM25 + vector + re-ranking.
	 * Slower but significantly better quality for semantic queries.
	 */
	queryHybrid(query: string, limit = 5, minScore = 0): QMDSearchResult[] {
		if (!query.trim() || !this.available) return [];

		const args = [
			"query", query,
			"--json",
			"-n", String(limit),
			"-c", this.collectionName,
		];
		if (minScore > 0) {
			args.push("--min-score", String(minScore));
		}

		const output = execQMD(args, 60_000); // query can be slower due to LLM re-ranking
		if (!output) return [];

		return parseQMDJson(output).map((r) => ({
			path: r.file,
			title: r.title,
			score: r.score,
			snippet: r.snippet ?? "",
			category: categorizeQMD(r.file),
		}));
	}

	/**
	 * Search and return full file contents for knowledge injection.
	 * Uses qmd query with --full for best quality context retrieval.
	 * Filters out core files (they're already injected directly).
	 */
	searchForContext(
		query: string,
		limit = 3,
		minScore = 0,
		options?: { includeKnowledge?: boolean; includeHistory?: boolean },
	): QMDContextResult[] {
		if (!query.trim() || !this.available) return [];

		const includeKnowledge = options?.includeKnowledge ?? true;
		const includeHistory = options?.includeHistory ?? true;

		const args = [
			"query", query,
			"--json",
			"--full",
			"-n", String(limit * 2), // fetch extra, then filter
			"-c", this.collectionName,
		];
		if (minScore > 0) {
			args.push("--min-score", String(minScore));
		}

		const output = execQMD(args, 60_000);
		if (!output) return [];

		const results = parseQMDJson(output);

		// Compute topScore from included categories only, so excluded
		// high-scoring results don't inflate the history threshold.
		let topScore = 0;
		for (const r of results) {
			const cat = categorizeQMD(r.file);
			if ((cat === "knowledge" && includeKnowledge) || (cat === "history" && includeHistory)) {
				topScore = r.score;
				break;
			}
		}

		const filtered = results.filter((r) => {
			const cat = categorizeQMD(r.file);
			if (cat === "core") return false;
			if (cat === "knowledge") return includeKnowledge;
			if (cat === "history") return includeHistory && r.score > topScore * 0.5;
			return false;
		});

		return filtered.slice(0, limit).map((r) => ({
			path: r.file,
			title: r.title,
			content: r.body ?? r.snippet ?? "",
			score: r.score,
		}));
	}

	/**
	 * Trigger a qmd index update for the pi-memory collection.
	 * Call after writing files so qmd picks up changes.
	 * Runs synchronously but is fast (~100ms for incremental updates).
	 */
	updateIndex(): void {
		if (!this.available) return;
		execQMD(["update", "-c", this.collectionName], 30_000);
	}

	/**
	 * Set up the qmd collection for the memory bank.
	 * Returns a status message describing what was done.
	 */
	setup(memoryRoot: string): { success: boolean; message: string } {
		const steps: string[] = [];

		// Check if qmd is installed
		const version = execQMD(["--version"]);
		if (version === null) {
			return {
				success: false,
				message: "qmd CLI is not installed. Install with: npm install -g @tobilu/qmd",
			};
		}
		steps.push(`qmd ${version.trim()} detected`);

		// Check if collection already exists
		const status = execQMD(["status"]);
		if (status && status.includes(this.collectionName)) {
			// Update the collection
			const updateResult = execQMD(["update", "-c", this.collectionName], 60_000);
			if (updateResult !== null) {
				steps.push(`Collection "${this.collectionName}" updated`);
			}
		} else {
			// Add the collection
			const addResult = execQMD([
				"collection", "add", memoryRoot,
				"--name", this.collectionName,
				"--mask", "**/*.md",
			]);
			if (addResult === null) {
				return {
					success: false,
					message: `Failed to add collection. Try manually: qmd collection add ${memoryRoot} --name ${this.collectionName}`,
				};
			}
			steps.push(`Collection "${this.collectionName}" added from ${memoryRoot}`);
		}

		// Add context
		const ctxResult = execQMD([
			"context", "add",
			`qmd://${this.collectionName}`,
			"Pi agent memory bank — active projects, daily context, knowledge files, and session history",
		]);
		if (ctxResult !== null) {
			steps.push("Context annotation added");
		}

		// Generate embeddings
		steps.push("Generating embeddings (this may take a moment on first run)...");
		const embedResult = execQMD(["embed"], 120_000);
		if (embedResult !== null) {
			steps.push("Embeddings generated");
		} else {
			steps.push("Warning: embedding generation failed — vector search won't work, but keyword search will");
		}

		this.resetAvailability();

		return {
			success: true,
			message: steps.join("\n"),
		};
	}
}
