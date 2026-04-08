/**
 * Tool Result Guard — hotfix for pi v0.65.0 crash
 *
 * Monkey-patches ToolExecutionComponent.prototype.updateResult to normalize
 * `result.content` to `[]` when it's undefined/null. This prevents the
 * TypeError crash in updateDisplay() and maybeConvertImagesForKitty() which
 * both call `.filter()` on `this.result.content` without a null guard.
 *
 * Bug: tool-execution.js lines 129 and 235 assume `result.content` is always
 * an array, but some tools (likely MCP servers) return results where content
 * is undefined.
 *
 * Remove this extension once pi is updated past v0.65.0 with the fix.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { ToolExecutionComponent } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const proto = ToolExecutionComponent.prototype as any;
  const original = proto.updateResult;

  proto.updateResult = function (result: any, isPartial = false) {
    // Normalize: ensure result.content is always an array
    if (result && !Array.isArray(result.content)) {
      result.content = result.content ?? [];
    }
    return original.call(this, result, isPartial);
  };

  // Show status indicator via event context UI (pi.setStatus doesn't exist)
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setStatus("tool-result-guard", "🛡️");
  });
}
