/**
 * lfg — Launch a fresh Pi session from inside Pi via tmux.
 *
 * Usage:
 *   /lfg [prompt]         New window → window picker → dir → preset → pi
 *   /lfg-pane [prompt]    New pane → dir → preset → pi (no name step)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execSync } from "node:child_process";

function isInTmux(): boolean {
  return !!process.env.TMUX;
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("lfg", {
    description:
      "Launch a new Pi workspace in a tmux window (window picker → dir → preset → pi)",
    handler: async (args, ctx) => {
      if (!isInTmux()) {
        ctx.ui.notify("Not inside tmux — cannot create a new window.", "error");
        return;
      }

      const prompt = args?.trim() || undefined;
      const cmd = prompt ? `lfg ${shellEscape(prompt)}` : "lfg";

      try {
        execSync(`tmux new-window ${shellEscape(cmd)}`, { encoding: "utf-8" });
        ctx.ui.notify("Launched lfg in new window.", "info");
      } catch (e: any) {
        ctx.ui.notify(`Failed to create tmux window: ${e.message}`, "error");
      }
    },
  });

  pi.registerCommand("lfg-pane", {
    description: "Launch a new Pi workspace in a tmux pane (dir → preset → pi)",
    handler: async (args, ctx) => {
      if (!isInTmux()) {
        ctx.ui.notify("Not inside tmux — cannot create a new pane.", "error");
        return;
      }

      const prompt = args?.trim() || undefined;
      const cmd = prompt ? `lfg --pane ${shellEscape(prompt)}` : "lfg --pane";

      try {
        execSync(
          `tmux split-window -h -P -F '#{pane_id}' ${shellEscape(cmd)}`,
          { encoding: "utf-8" },
        );
        ctx.ui.notify("Launched lfg in new pane.", "info");
      } catch (e: any) {
        ctx.ui.notify(`Failed to create tmux pane: ${e.message}`, "error");
      }
    },
  });
}
