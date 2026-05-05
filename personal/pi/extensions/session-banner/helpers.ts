/** Pure helper functions for session-banner extension. */

// ─── Emoji & Color pools ────────────────────────────────────────────────────

export const SESSION_EMOJI = [
	"🔮", "🎯", "⚡", "🧩", "🛠️", "🚀", "🌀", "🔥", "💎", "🧪",
	"🎨", "🏗️", "📡", "🔬", "⚙️", "🌊", "🪐", "🎪", "🧲", "🦾",
	"🍀", "🌵", "🐙", "🦊", "🐋", "🪸", "🍄", "🌸", "🪻", "🫧",
];

export const TITLE_COLORS = [
	"#FF6B6B", "#6BCB77", "#4D96FF", "#FFD93D", "#C77DFF",
	"#FF9671", "#00C9A7", "#FFC75F", "#F9F871", "#845EC2",
	"#FF6F91", "#00D2FC", "#D65DB1", "#FF9F1C", "#2EC4B6",
];

export function randomEmoji(): string {
	return SESSION_EMOJI[Math.floor(Math.random() * SESSION_EMOJI.length)]!;
}

export function randomTitleColor(): string {
	return TITLE_COLORS[Math.floor(Math.random() * TITLE_COLORS.length)]!;
}

// ─── ANSI helpers ───────────────────────────────────────────────────────────

export function fgHex(hex: string, text: string): string {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

// ─── World context detection ────────────────────────────────────────────────

export interface WorldContext {
	treeName: string | null;
	zone: string | null;
}

export function detectWorldContext(cwd: string): WorldContext {
	const match = cwd.match(/\/world\/trees\/([^/]+)\/src(?:\/(.+))?/);
	if (!match) return { treeName: null, zone: null };

	const treeName = match[1]!;
	const rawZone = match[2] as string | undefined;

	let zone: string | null = null;
	if (rawZone) {
		const parts = rawZone.split("/");
		zone = parts.slice(0, Math.min(parts.length, 3)).join("/");
	}

	return { treeName, zone };
}

// ─── Session name parsing ───────────────────────────────────────────────────

export interface ParsedSessionName {
	emoji: string;
	label: string;
	titleColor: string;
}

/**
 * Parse a session name like "🔮 fix checkout bug" into emoji + label.
 * Assigns a random titleColor if restoring an existing name.
 */
export function parseSessionName(name: string): ParsedSessionName {
	if (!name) return { emoji: "", label: "", titleColor: "" };

	const emojiMatch = name.match(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F?)\s+(.+)$/u);
	if (emojiMatch) {
		return {
			emoji: emojiMatch[1]!,
			label: emojiMatch[2]!,
			titleColor: randomTitleColor(),
		};
	}

	// Plain name without emoji prefix
	return {
		emoji: randomEmoji(),
		label: name,
		titleColor: randomTitleColor(),
	};
}

// ─── Terminal title ─────────────────────────────────────────────────────────

export function buildTerminalTitle(
	treeName: string | null,
	zone: string | null,
	emoji: string,
	label: string,
): string {
	const parts: string[] = ["π"];
	if (treeName) parts.push(treeName);
	if (zone) parts.push(`//${zone}`);
	if (label) parts.push(`— ${emoji} ${label}`);
	return parts.join(" ");
}


