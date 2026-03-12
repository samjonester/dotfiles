/**
 * Remote Mutations Guard
 *
 * Intercepts bash tool calls that would modify remote state and requires
 * explicit confirmation before proceeding. Covers:
 *   - git push (any form)
 *   - gh pr edit / comment / create / merge / close / reopen / review / ready
 *   - gh issue create / close / reopen / edit / comment / delete
 *   - gh release create / delete / edit / upload
 *   - gh repo create / fork / delete / rename / transfer
 *   - gh api POST/PATCH/PUT/DELETE
 *   - gt submit (and gt stack submit)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

interface RemoteMutationPattern {
	pattern: RegExp;
	label: string;
}

const REMOTE_MUTATION_PATTERNS: RemoteMutationPattern[] = [
	// git
	{ pattern: /\bgit\s+push\b/, label: "git push" },

	// gh pr
	{
		pattern: /\bgh\s+pr\s+(edit|comment|create|merge|close|reopen|review|ready|convert-to-draft)\b/,
		label: "gh pr (mutating subcommand)",
	},

	// gh issue
	{ pattern: /\bgh\s+issue\s+(create|close|reopen|edit|comment|delete)\b/, label: "gh issue (mutating subcommand)" },

	// gh release
	{ pattern: /\bgh\s+release\s+(create|delete|edit|upload)\b/, label: "gh release (mutating subcommand)" },

	// gh repo
	{ pattern: /\bgh\s+repo\s+(create|fork|delete|rename|transfer)\b/, label: "gh repo (mutating subcommand)" },

	// gh api (mutating methods only — GET calls pass through)
	{ pattern: /\bgh\s+api\b.*(--method|-X)\s+(POST|PATCH|PUT|DELETE)\b/i, label: "gh api (mutating method)" },

	// Graphite
	{ pattern: /\bgt\s+submit\b/, label: "gt submit" },
	{ pattern: /\bgt\s+stack\s+submit\b/, label: "gt stack submit" },
];

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;

		const command = (event.input.command as string) ?? "";

		const matched = REMOTE_MUTATION_PATTERNS.find(({ pattern }) => pattern.test(command));
		if (!matched) return undefined;

		if (!ctx.hasUI) {
			return {
				block: true,
				reason: `Remote mutation blocked in non-interactive mode (${matched.label}). Re-run interactively to confirm.`,
			};
		}

		// Format multi-line commands with indentation for readability
		const formatted = command
			.trim()
			.split("\n")
			.map((line) => `  ${line}`)
			.join("\n");

		const choice = await ctx.ui.select(
			`🌐 Remote mutation detected (${matched.label})\n\n${formatted}\n\nProceed?`,
			["Yes", "No"],
		);

		if (choice !== "Yes") {
			return { block: true, reason: `Remote mutation blocked by user (${matched.label})` };
		}

		return undefined;
	});
}
