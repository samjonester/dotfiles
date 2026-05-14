/**
 * Custom Footer — configurable multi-line status bar.
 *
 * Reads layout from settings.json `customFooter` key:
 *   - absent or true  → default 4-line layout
 *   - false           → disabled (yields to powerline-footer or no footer)
 *   - { lines: [...] } → custom layout
 *
 * `/footer` command toggles on/off.
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

import { DEFAULT_LINES } from "./types.js";
import type { CustomFooterConfig, LineDef, RawFooterSetting } from "./types.js";
import { resolveLine } from "./segments.js";
import type { SegmentCtx } from "./segments.js";

// ─── Settings I/O ────────────────────────────────────────────────────

function getSettingsPath(): string {
  return join(homedir(), ".pi", "agent", "settings.json");
}

function readSettings(): Record<string, unknown> {
  const p = getSettingsPath();
  if (!existsSync(p)) return {};
  try {
    const parsed = JSON.parse(readFileSync(p, "utf-8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeSettings(settings: Record<string, unknown>): void {
  const p = getSettingsPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(settings, null, 2) + "\n");
}

function parseConfig(raw: unknown): { enabled: boolean; lines: LineDef[] } {
  if (raw === false) return { enabled: false, lines: DEFAULT_LINES };
  if (raw === true || raw === undefined || raw === null) return { enabled: true, lines: DEFAULT_LINES };
  if (typeof raw === "object" && raw !== null && "lines" in raw) {
    const cfg = raw as CustomFooterConfig;
    if (Array.isArray(cfg.lines) && cfg.lines.length > 0) {
      return { enabled: true, lines: cfg.lines };
    }
  }
  return { enabled: true, lines: DEFAULT_LINES };
}

// ─── Token accumulation cache ────────────────────────────────────────

let cachedInput = 0;
let cachedOutput = 0;
let cachedCost = 0;

function initTokenCache(ctx: ExtensionContext): void {
  cachedInput = 0;
  cachedOutput = 0;
  cachedCost = 0;
  for (const e of ctx.sessionManager.getBranch()) {
    if (e.type === "message" && e.message.role === "assistant") {
      const m = e.message as AssistantMessage;
      cachedInput += m.usage.input;
      cachedOutput += m.usage.output;
      cachedCost += m.usage.cost.total;
    }
  }
}

function accumulateFromBranch(ctx: ExtensionContext): void {
  // Re-walk. Called once per agent_end — cheap enough.
  initTokenCache(ctx);
}

// ─── Footer installation ─────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  function installFooter(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;

    const settings = readSettings();
    const { enabled, lines } = parseConfig(settings.customFooter);
    if (!enabled) return;

    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsub = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsub,
        invalidate() {},
        render(width: number): string[] {
          const extensionStatuses = footerData.getExtensionStatuses();

          const segCtx: SegmentCtx = {
            theme,
            sessionId: ctx.sessionManager.getSessionId(),
            sessionName: ctx.sessionManager.getSessionName(),
            cwd: ctx.sessionManager.getCwd(),
            gitBranch: footerData.getGitBranch(),
            totalInput: cachedInput,
            totalOutput: cachedOutput,
            totalCost: cachedCost,
            usingSubscription: ctx.model
              ? ctx.modelRegistry.isUsingOAuth(ctx.model)
              : false,
            contextPercent: ctx.getContextUsage()?.percent ?? null,
            contextWindow:
              ctx.getContextUsage()?.contextWindow ??
              ctx.model?.contextWindow ??
              0,
            modelId: ctx.model?.id || "no-model",
            isReasoning: !!ctx.model?.reasoning,
            thinkingLevel: pi.getThinkingLevel() || "off",
          };

          const rendered: string[] = [];
          for (const lineDef of lines) {
            const parts = resolveLine(lineDef, segCtx, extensionStatuses, lines);
            const joined = parts.join("  ");
            rendered.push(
              truncateToWidth(joined, width, theme.fg("dim", "...")),
            );
          }

          return rendered;
        },
      };
    });
  }

  // ── /footer toggle ──────────────────────────────────────────────────

  pi.registerCommand("footer", {
    description: "Toggle the custom footer on/off",
    handler: async (_args, ctx) => {
      const settings = readSettings();
      const { enabled } = parseConfig(settings.customFooter);

      if (enabled) {
        settings.customFooter = false;
        writeSettings(settings);
        // Can't remove footer via API — next session will pick it up
        ctx.ui.setStatus("custom-footer", "Footer disabled (restart to apply)");
      } else {
        // Re-enable: if there was a previous object config, restore it; otherwise set true
        if (
          typeof settings.customFooter === "object" &&
          settings.customFooter !== null
        ) {
          // Was disabled with a custom config stored — just re-enable by removing the false
          // But we stored false, so there's no object to restore. Set true.
        }
        settings.customFooter = true;
        writeSettings(settings);
        installFooter(ctx);
        ctx.ui.setStatus("custom-footer", undefined);
      }
    },
  });

  // ── Lifecycle ───────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    initTokenCache(ctx);
    installFooter(ctx);
  });

  pi.on("session_switch", async (_event, ctx) => {
    initTokenCache(ctx);
    installFooter(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    accumulateFromBranch(ctx);
  });
}
