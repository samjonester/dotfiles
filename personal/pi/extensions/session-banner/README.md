---
summary: Display-only banner widget + custom footer that mirrors retitle's session naming.
commands: []
tools: []
category: productivity
keywords: [session, banner, identity, emoji, retitle]
---

# Session Banner (display-only fork)

> **Personal fork.** Source: shop-pi-fy `extensions/session-banner`. Diverged in 2026-05 to delegate naming to the `retitle` extension and avoid the duplicate name display caused by pi-core's footer also showing `• sessionName`.

## What it does

Shows a colored banner widget above the input editor:

```
──────────────────────────────────────────────────
  🔮  │  fix checkout tax bug
──────────────────────────────────────────────────
```

Plus replaces pi-core's footer with one that **omits** the `• sessionName` suffix on the pwd line — without that override, the same name would render twice (once in the banner, once in the footer).

| Layer | Where visible | What it shows |
|-------|--------------|---------------|
| **Banner widget** | Above the editor (always visible) | emoji │ name |
| **Terminal title** | Ghostty tab bar + Cmd+Tab | `π root //areas/core — 🔮 fix bug` |
| **Session name** | `/resume` session list | `🔮 fix checkout tax bug` |
| **Custom footer** | Bottom of screen | pwd `(branch)` + stats + model — **no name suffix** |

## Naming

This fork **does not** name sessions. Naming is handled by the `retitle` extension (in dotfiles too), which calls Claude Haiku in the background to generate the `🐛 short label` and refines it across the first 3 turns. The banner reads the result via `parseSessionName(pi.getSessionName())`.

The fork removes:
- `set_session_label` tool registration (was in-band token cost on the main agent)
- `/title` command (replaced by retitle's `/retitle` and `/retitle-all`)

## Custom footer

`footer.ts` is a port of pi-core's `modes/interactive/components/footer.js` minus the four lines that append `• sessionName` to the pwd line. Uses fully-typed public APIs:

- `ctx.model`, `ctx.modelRegistry.isUsingOAuth(...)`, `ctx.getContextUsage()`
- `session.getEntries()` (cumulative usage + `ThinkingLevelChangeEntry` scan)
- `ReadonlyFooterDataProvider` methods (git branch, extension statuses, provider count)

One documented compromise: `autoCompactEnabled` has no public `ExtensionContext` API, so it's hardcoded `true`. Users who toggle auto-compact off won't see the indicator change without a session restart. Upstream PR opportunity: add `getAutoCompactionEnabled` to `ExtensionContextActions`.

## Sync with upstream

When pi-core changes its footer renderer (new stat fields, new context indicators, layout changes), `footer.ts` needs a manual sync. The file header tracks pi-core's `footer.js` as the source of truth.

## World Monorepo Support

Auto-detects the worktree name (`root`, `t1`, `t2`, ...) and zone path from the cwd for the terminal title. Each session reads its emoji + a random title color from the parsed session name.
