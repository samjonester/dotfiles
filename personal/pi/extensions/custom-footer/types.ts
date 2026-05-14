/** Segment IDs — matches powerline-footer naming where applicable */
export type SegmentId =
  | "session"
  | "session_name"
  | "path"
  | "git"
  | "tokens"
  | "context"
  | "model"
  | "thinking";

/** A line is an ordered array of segment IDs and/or ext: references */
export type LineDef = string[];

/** Full config shape in settings.json under "customFooter" */
export interface CustomFooterConfig {
  lines: LineDef[];
}

/** What we read from settings — string true/false, object, or absent */
export type RawFooterSetting = boolean | CustomFooterConfig;

/** Default 4-line layout (used when customFooter is absent or true) */
export const DEFAULT_LINES: LineDef[] = [
  ["session", "session_name"],
  ["path", "git"],
  ["tokens", "context", "model", "thinking"],
  ["ext:*"],
];

/** All known built-in segment IDs */
export const BUILTIN_SEGMENTS = new Set<string>([
  "session",
  "session_name",
  "path",
  "git",
  "tokens",
  "context",
  "model",
  "thinking",
]);
