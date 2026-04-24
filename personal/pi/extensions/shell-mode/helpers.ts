/**
 * Pure helper functions for the shell-mode extension.
 * Extracted here so they can be unit-tested without loading the extension.
 */

// Commands that need interactive terminal but NOT fullscreen
// (they prompt for input, show menus, etc. but don't use alternate screen)
export const DEFAULT_INTERACTIVE_COMMANDS = [
	// Git interactive (only when truly interactive, not when non-interactive flags are used)
	"git rebase -i",
	"git rebase --interactive",
	"git add -p",
	"git add --patch",
	"git add -i",
	"git add --interactive",
	"git stash -p",
	"git stash --patch",
	"git reset -p",
	"git reset --patch",
	"git checkout -p",
	"git checkout --patch",
	"git difftool",
	"git mergetool",
	// Graphite
	"gt create",
	"gt submit",
	"gt modify",
	"gt sync",
	"gt checkout",
	"gt config",
	"gt auth",
	"gt demo",
	"gt init",
	// GitHub CLI
	"gh pr create",
	"gh pr checkout",
	"gh pr view",
	"gh issue create",
	"gh issue view",
	"gh auth login",
	"gh auth refresh",
	"gh auth switch",
	"gh codespace ssh",
	"gh codespace create",
	"gh copilot",
	"gh repo fork",
	// Remote sessions
	"ssh",
	"telnet",
	"mosh",
	// Database clients
	"psql",
	"mysql",
	"sqlite3",
	"mongosh",
	"redis-cli",
	// Kubernetes/Docker
	"kubectl exec -it",
	"docker exec -it",
	"docker run -it",
	// Shopify dev
	"dev init",
	// CLI tools with interactive prompts
	"pi config",
];

// Commands that use alternate screen buffer / need full terminal takeover
export const DEFAULT_FULLSCREEN_COMMANDS = [
	// Editors
	"vim",
	"nvim",
	"vi",
	"nano",
	"emacs",
	"pico",
	"micro",
	"helix",
	"hx",
	"kak",
	// Pagers
	"less",
	"more",
	"most",
	// System monitors
	"htop",
	"top",
	"btop",
	"glances",
	// File managers
	"ranger",
	"nnn",
	"lf",
	"mc",
	"vifm",
	// Git TUIs
	"tig",
	"lazygit",
	"gitui",
	// Fuzzy finders
	"fzf",
	"sk",
	// Kubernetes
	"kubectl edit",
	// Multiplexers
	"tmux",
	"screen",
	// Other TUIs
	"ncdu",
	"zellij",
	// Shopify devx
	"devx rig up",
];

// Commands that should always run in the background (empty by default — use env vars to populate)
export const DEFAULT_BACKGROUND_COMMANDS: string[] = [];

/**
 * Build a command list from defaults + env additions - env exclusions.
 */
export function buildList(defaults: string[], addEnv?: string, excludeEnv?: string): string[] {
	const additional =
		(addEnv ? process.env[addEnv] : undefined)
			?.split(",")
			.map((s) => s.trim())
			.filter(Boolean) ?? [];
	const excluded = new Set(
		(excludeEnv ? process.env[excludeEnv] : undefined)
			?.split(",")
			.map((s) => s.trim().toLowerCase()) ?? [],
	);
	return [...defaults, ...additional].filter((cmd) => !excluded.has(cmd.toLowerCase()));
}

/**
 * Check if a command matches any entry in a command list.
 * Matches at the start of the command, or after the last pipe.
 */
export function matchesCommandList(command: string, list: string[]): boolean {
	const trimmed = command.trim().toLowerCase();

	for (const cmd of list) {
		const cmdLower = cmd.toLowerCase();
		if (trimmed === cmdLower || trimmed.startsWith(`${cmdLower} `) || trimmed.startsWith(`${cmdLower}\t`)) {
			return true;
		}
		// Match after pipe: "cat file | less"
		const pipeIdx = trimmed.lastIndexOf("|");
		if (pipeIdx !== -1) {
			const afterPipe = trimmed.slice(pipeIdx + 1).trim();
			if (afterPipe === cmdLower || afterPipe.startsWith(`${cmdLower} `)) {
				return true;
			}
		}
	}
	return false;
}

export type Mode = "normal" | "interactive" | "fullscreen" | "background";

/**
 * Parse prefix flags from a user `!` command.
 *
 * Supported prefixes:
 *   !i <cmd>   — force interactive (inline)
 *   !f <cmd>   — force fullscreen
 *   !if / !fi  — force fullscreen (f wins)
 *   !& <cmd>   — background mode
 *   !bg <cmd>  — background mode (alias)
 *
 * Returns the parsed mode override and the remaining command.
 */
export function parsePrefix(raw: string): { mode: Mode | null; command: string } {
	// Check trailing & (like shell backgrounding: "dev up &")
	const trailingBg = raw.match(/^(.+?)\s+&\s*$/);
	if (trailingBg) {
		return { mode: "background", command: trailingBg[1].trim() };
	}

	// Check !& prefix (single char, special)
	if (raw.startsWith("& ") || raw.startsWith("&\t")) {
		return { mode: "background", command: raw.slice(2).trim() };
	}

	// Check word prefixes
	const prefixMatch = raw.match(/^(bg|fi|i|f)\s+/);
	if (prefixMatch) {
		const prefix = prefixMatch[1];
		const command = raw.slice(prefixMatch[0].length).trim();

		switch (prefix) {
			case "bg":
				return { mode: "background", command };
			case "f":
			case "fi":
				return { mode: "fullscreen", command };
			case "i":
				return { mode: "interactive", command };
		}
	}

	return { mode: null, command: raw };
}

// Cached command lists (built once on first call)
let cachedBackgroundList: string[] | null = null;
let cachedFullscreenList: string[] | null = null;
let cachedInteractiveList: string[] | null = null;

/** Clear cached lists (for testing or when env vars change). */
export function invalidateListCache(): void {
	cachedBackgroundList = null;
	cachedFullscreenList = null;
	cachedInteractiveList = null;
}

function getBackgroundList(): string[] {
	return (cachedBackgroundList ??= buildList(DEFAULT_BACKGROUND_COMMANDS, "BACKGROUND_COMMANDS", "BACKGROUND_EXCLUDE"));
}
function getFullscreenList(): string[] {
	return (cachedFullscreenList ??= buildList(DEFAULT_FULLSCREEN_COMMANDS, "FULLSCREEN_COMMANDS", "FULLSCREEN_EXCLUDE"));
}
function getInteractiveList(): string[] {
	return (cachedInteractiveList ??= buildList(DEFAULT_INTERACTIVE_COMMANDS, "INTERACTIVE_COMMANDS", "INTERACTIVE_EXCLUDE"));
}

/**
 * Classify a command by matching against the interactive and fullscreen lists.
 */
export function classifyCommand(command: string): Mode {
	if (matchesCommandList(command, getBackgroundList())) return "background";
	if (matchesCommandList(command, getFullscreenList())) return "fullscreen";
	if (matchesCommandList(command, getInteractiveList())) return "interactive";
	return "normal";
}
