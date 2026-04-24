---
summary: Graphical context window breakdown by category with donut chart overlay.
commands: [/context]
category: productivity
keywords: [context, tokens, usage, visualization, window]
status: stable
---

# context-viz

Pi extension that mirrors Claude Code's `/context`: shows the current context
window broken down by category, with a donut chart + per-category legend.

![A screenshot showing the `/context` window](image.png)

## Usage

- `/context` — open a graphical overlay with a donut chart (percent-used in
  the center), a legend (tokens + % of window per category), and both the
  per-category sum and the authoritative number from `ctx.getContextUsage()`.
- `/context print` (or any non-interactive mode) — render a plain-text
  summary via `ctx.ui.notify()`.

## Categories

| category           | source                                              |
| ------------------ | --------------------------------------------------- |
| system prompt      | `ctx.getSystemPrompt()` (includes per-turn mods)    |
| user messages      | `role: user` text blocks                            |
| assistant text     | `role: assistant` text blocks                       |
| thinking           | `role: assistant` thinking blocks                   |
| tool calls         | `role: assistant` toolCall blocks (name + args JSON)|
| tool results       | `role: toolResult` text + images (images ≈ 1200 tok)|
| bash executions    | `role: bashExecution` command + output              |
| custom / summaries | `role: custom`, branchSummary, compactionSummary    |
| free               | `contextWindow - sum`                               |

Per-category numbers use pi's internal `chars / 4` heuristic. The overlay
also prints the "reported" number from `ctx.getContextUsage()` (last
assistant usage + trailing estimate) so you can compare the two.

## Controls

`Enter` / `Esc` / `q` to close.
