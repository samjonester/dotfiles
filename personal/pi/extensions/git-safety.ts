/**
 * Remote Mutations Guard
 *
 * Intercepts bash tool calls that would modify remote state and requires
 * explicit confirmation before proceeding. Pressing `n` to deny shows a
 * text input where you can type instructions for the agent (e.g. "use
 * gt submit --dry-run instead"). Instructions are included in the block
 * reason so the LLM can adjust its approach.
 *
 * Covers:
 *   - git push (any form)
 *   - gh pr edit / comment / create / merge / close / reopen / review / ready
 *   - gh issue create / close / reopen / edit / comment / delete
 *   - gh release create / delete / edit / upload
 *   - gh repo create / fork / delete / rename / transfer
 *   - gh api POST/PATCH/PUT/DELETE
 *   - gt submit (and gt stack submit)
 */

import { DynamicBorder, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Container, Input, matchesKey, Key, Spacer, Text } from "@mariozechner/pi-tui";

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

		const result = await ctx.ui.custom<{ allowed: boolean; instructions?: string }>((tui, theme, _kb, done) => {
			let mode: "decide" | "feedback" = "decide";
			let resolved = false;

			const b = () => new DynamicBorder((s: string) => theme.fg("borderAccent", s));

			const container = new Container();
			container.addChild(b());
			container.addChild(new Spacer(1));
			container.addChild(new Text("  " + theme.fg("accent", theme.bold(`🌐 Remote mutation (${matched.label})`)), 1, 0));
			container.addChild(new Spacer(1));

			// Show command lines
			for (const line of formatted.split("\n")) {
				container.addChild(new Text("  " + theme.fg("warning", line), 1, 0));
			}

			// Feedback input (created but not added to container until feedback mode)
			const feedbackInput = new Input();
			feedbackInput.onSubmit = (value: string) => {
				if (resolved) return;
				resolved = true;
				done({ allowed: false, instructions: value || undefined });
			};
			feedbackInput.onEscape = () => {
				if (resolved) return;
				resolved = true;
				done({ allowed: false });
			};

			// Footer components (stored for re-ordering when entering feedback mode)
			const footerSpacer = new Spacer(1);
			const hintsText = new Text(
				"  " + theme.fg("dim", "y") + theme.fg("muted", " allow  ") +
				theme.fg("dim", "n") + theme.fg("muted", " deny  ") +
				theme.fg("dim", "esc") + theme.fg("muted", " dismiss"),
				1, 0,
			);
			const bottomSpacer = new Spacer(1);
			const bottomBorder = b();

			container.addChild(footerSpacer);
			container.addChild(hintsText);
			container.addChild(bottomSpacer);
			container.addChild(bottomBorder);

			const repaint = () => { container.invalidate(); tui.requestRender(); };

			const enterFeedbackMode = () => {
				mode = "feedback";

				container.removeChild(footerSpacer);
				container.removeChild(hintsText);
				container.removeChild(bottomSpacer);
				container.removeChild(bottomBorder);

				container.addChild(new Text("  " + theme.fg("muted", "Tell the agent what to do instead:"), 1, 0));
				container.addChild(feedbackInput);
				container.addChild(new Spacer(1));

				hintsText.setText(
					"  " + theme.fg("dim", "enter") + theme.fg("muted", " submit  ") +
					theme.fg("dim", "esc") + theme.fg("muted", " skip"),
				);
				container.addChild(hintsText);
				container.addChild(bottomSpacer);
				container.addChild(bottomBorder);

				feedbackInput.focused = true;
				repaint();
			};

			return {
				render: (w: number) => container.render(w),
				invalidate: () => container.invalidate(),
				handleInput: (data: string) => {
					if (resolved) return;
					if (mode === "feedback") {
						feedbackInput.handleInput(data);
						repaint();
						return;
					}
					if (data === "y" || data === "Y") {
						resolved = true;
						done({ allowed: true });
					} else if (data === "n" || data === "N") {
						enterFeedbackMode();
					} else if (matchesKey(data, Key.escape)) {
						resolved = true;
						done({ allowed: false });
					}
				},
				// Focusable: propagate to Input for IME cursor positioning
				get focused() { return feedbackInput.focused; },
				set focused(v: boolean) { feedbackInput.focused = v; },
			};
		});

		if (!result.allowed) {
			const reason = result.instructions
				? `Remote mutation blocked by user (${matched.label}).\n\nUser instructions: ${result.instructions}`
				: `Remote mutation blocked by user (${matched.label})`;
			return { block: true, reason };
		}

		return undefined;
	});
}
