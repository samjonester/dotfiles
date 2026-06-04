/**
 * Pure segment renderers + ext: resolver.
 * Each built-in segment returns a themed string or empty string if nothing to show.
 * Extension segments pass through pre-colored text from the owning extension.
 */

import type { Theme } from "@mariozechner/pi-coding-agent";
import { BUILTIN_SEGMENTS } from "./types.js";
import type { LineDef } from "./types.js";

// ─── Helpers ──────────────────────────────────────────────────────────

function sanitize(text: string): string {
  return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

export function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

// ─── Segment context (passed to each renderer) ───────────────────────

export interface SegmentCtx {
  theme: Theme;
  sessionId: string;
  sessionName: string;
  cwd: string;
  gitBranch: string | null;
  totalInput: number;
  totalOutput: number;
  totalCost: number;
  usingSubscription: boolean;
  contextPercent: number | null;
  contextWindow: number;
  modelId: string;
  isReasoning: boolean;
  thinkingLevel: string;
}

// ─── Built-in segment renderers ──────────────────────────────────────

type SegmentRenderer = (ctx: SegmentCtx) => string;

const renderers: Record<string, SegmentRenderer> = {
  session(ctx) {
    const short = ctx.sessionId.split("-").pop() || ctx.sessionId;
    return ctx.theme.fg("muted", short);
  },

  session_name(ctx) {
    return ctx.sessionName ? ctx.theme.fg("accent", ctx.sessionName) : "";
  },

  path(ctx) {
    let pwd = ctx.cwd;
    const home = process.env.HOME || process.env.USERPROFILE;
    if (home && pwd.startsWith(home)) {
      pwd = `~${pwd.slice(home.length)}`;
    }
    return ctx.theme.fg("dim", pwd);
  },

  git(ctx) {
    if (!ctx.gitBranch) return "";
    return ctx.theme.fg("muted", "\ue0a0 " + ctx.gitBranch);
  },

  tokens(ctx) {
    const parts: string[] = [];
    if (ctx.totalInput) parts.push("\u2191" + formatTokens(ctx.totalInput));
    if (ctx.totalOutput) parts.push("\u2193" + formatTokens(ctx.totalOutput));
    if (ctx.totalCost || ctx.usingSubscription) {
      const costStr = "$" + ctx.totalCost.toFixed(3) + (ctx.usingSubscription ? " (sub)" : "");
      parts.push(costStr);
    }
    return parts.length > 0 ? ctx.theme.fg("dim", parts.join(" ")) : "";
  },

  context(ctx) {
    const pct = ctx.contextPercent;
    const display =
      pct === null
        ? "?/" + formatTokens(ctx.contextWindow)
        : pct.toFixed(1) + "%/" + formatTokens(ctx.contextWindow);

    if (pct === null) return ctx.theme.fg("dim", display);
    if (pct > 75) return ctx.theme.fg("error", display);
    if (pct >= 50) return ctx.theme.fg("warning", display);
    return ctx.theme.fg("success", display);
  },

  model(ctx) {
    return ctx.theme.fg("dim", "\uD83E\uDD16 " + ctx.modelId);
  },

  thinking(ctx) {
    if (!ctx.isReasoning) return "";
    return ctx.theme.fg("dim", "\uD83E\uDDE0 " + (ctx.thinkingLevel || "off"));
  },
};

// ─── Extension status resolver ───────────────────────────────────────

/**
 * Resolve a single line definition into rendered strings.
 *
 * - Built-in segments call their renderer
 * - `ext:<key>` looks up that key in extensionStatuses (pass-through, pre-colored)
 * - `ext:*` renders all statuses not pinned anywhere in allLines
 */
export function resolveLine(
  lineDef: LineDef,
  ctx: SegmentCtx,
  extensionStatuses: ReadonlyMap<string, string>,
  allLines: LineDef[],
): string[] {
  const parts: string[] = [];

  for (const seg of lineDef) {
    if (BUILTIN_SEGMENTS.has(seg)) {
      const rendered = renderers[seg]?.(ctx) ?? "";
      if (rendered) parts.push(rendered);
    } else if (seg === "ext:*") {
      // Collect all pinned extension keys across ALL lines
      const pinned = new Set<string>();
      for (const line of allLines) {
        for (const s of line) {
          if (s.startsWith("ext:") && s !== "ext:*") {
            pinned.add(s.slice(4));
          }
        }
      }
      // Render remaining statuses
      for (const [key, text] of extensionStatuses) {
        if (!pinned.has(key)) {
          const clean = sanitize(text);
          if (clean) parts.push(clean);
        }
      }
    } else if (seg.startsWith("ext:")) {
      const key = seg.slice(4);
      const text = extensionStatuses.get(key);
      if (text) {
        parts.push(sanitize(text));
      }
    }
    // Unknown segments silently ignored
  }

  return parts;
}
