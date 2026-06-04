/**
 * lfg — Launch a fresh Pi session from inside Pi via cmux.
 *
 * Usage:
 *   /lfg [prompt]         New workspace → workspace picker → dir → preset → pi
 *   /lfg-pane [prompt]    New split pane → dir → preset → pi (no name step)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execSync } from "node:child_process";

function isInCmux(): boolean {
  return !!process.env.CMUX_WORKSPACE_ID;
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("lfg", {
    description:
      "Launch a new Pi workspace in a cmux workspace (workspace picker → dir → preset → pi)",
    handler: async (args, ctx) => {
      if (!isInCmux()) {
        ctx.ui.notify("Not inside cmux — cannot create a new workspace.", "error");
        return;
      }

      const prompt = args?.trim() || undefined;
      const cmd = prompt ? `lfg ${shellEscape(prompt)}` : "lfg";

      try {
        // New workspace runs `lfg`, which drives the workspace/worktree/dir picker.
        execSync(
          `cmux new-workspace --command ${shellEscape(cmd)} --focus true`,
          { encoding: "utf-8" },
        );
        ctx.ui.notify("Launched lfg in new workspace.", "info");
      } catch (e: any) {
        ctx.ui.notify(`Failed to create cmux workspace: ${e.message}`, "error");
      }
    },
  });

  pi.registerCommand("lfg-pane", {
    description: "Launch a new Pi workspace in a cmux split pane (dir → preset → pi)",
    handler: async (args, ctx) => {
      if (!isInCmux()) {
        ctx.ui.notify("Not inside cmux — cannot create a new pane.", "error");
        return;
      }

      const prompt = args?.trim() || undefined;
      const cmd = prompt ? `lfg --pane ${shellEscape(prompt)}` : "lfg --pane";

      try {
        // Split the current workspace to the right, then run `lfg --pane` in the
        // new surface. new-split has no --command flag, so we send the command
        // afterward. It prints e.g. "OK surface:64 workspace:19" — parse the new
        // surface ref and target it explicitly (otherwise `cmux send` defaults to
        // $CMUX_SURFACE_ID, i.e. this Pi session).
        const out = execSync(`cmux new-split right --focus true`, {
          encoding: "utf-8",
        });
        const surface = out.match(/surface:\d+/)?.[0];
        if (!surface) {
          ctx.ui.notify(
            `Created split but couldn't parse its surface ref from: ${out.trim()}`,
            "error",
          );
          return;
        }
        // `cmux send` treats literal \n as Enter.
        execSync(
          `cmux send --surface ${shellEscape(surface)} ${shellEscape(cmd + "\\n")}`,
          { encoding: "utf-8" },
        );
        ctx.ui.notify("Launched lfg in new pane.", "info");
      } catch (e: any) {
        ctx.ui.notify(`Failed to create cmux pane: ${e.message}`, "error");
      }
    },
  });
}
