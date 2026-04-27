/**
 * tm — Spawn a teammate with a task in one step.
 *
 * Usage:
 *   /tm review my recent sessions for optimizations
 *   /tm investigate why the build is slow
 *   /tm plan a refactor of the auth module
 *
 * Sends a user message instructing the model to spawn a teammate with the
 * given task. The model picks the right preset based on task keywords.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("tm", {
    description: "Spawn a teammate with the given task",
    handler: async (args, ctx) => {
      const task = args.trim();
      if (!task) {
        ctx.ui.notify("Usage: /tm <task description>", "warning");
        return;
      }

      const message = `Spawn a teammate to: ${task}`;

      if (ctx.isIdle()) {
        pi.sendUserMessage(message);
      } else {
        // Agent is mid-turn — queue as follow-up rather than throwing.
        pi.sendUserMessage(message, { deliverAs: "followUp" });
      }

      ctx.ui.notify(`Spawning teammate: ${task}`, "info");
    },
  });
}
