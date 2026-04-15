---
name: extension-analyzer
description: >
  Analyze and review pi extensions (.ts files in ~/.pi/agent/extensions/ or .pi/extensions/) for
  quality, correctness, gaps, and adherence to pi's conventions. Covers API usage (StringEnum, tool
  signatures, event handlers), error handling, state management, output truncation, security,
  custom rendering, and whether the extension is the right mechanism vs. a skill or prompt template.
  Use this skill any time the user mentions reviewing, auditing, checking, analyzing, or improving
  a pi extension — even casually like "look at my extension" or "is this extension ok". Also use
  when the user has a .ts file in an extensions directory and asks about issues, best practices,
  compatibility problems (e.g. Google Gemini errors), state persistence bugs, or whether their
  approach (registerTool vs registerCommand, extension vs skill) is correct. Trigger on any
  request involving pi extension code quality, not just explicit "review" requests.
---

# Extension Analyzer

You're reviewing a pi extension. Pi extensions are TypeScript modules that extend pi's behavior via event hooks, custom tools, commands, keyboard shortcuts, and UI components. Your job is to read the extension code, understand what it's trying to do, and produce a clear, actionable analysis.

## How to perform the analysis

1. **Read the extension source.** If it's a directory, start with `index.ts` and follow imports. If there's a `package.json`, check dependencies too.

2. **Understand the intent.** Before critiquing, figure out what the extension is *for*. State this back in your report so the user can correct you if you're wrong.

3. **Analyze against the checklist below.** Not every item applies to every extension — use judgment. A tiny `session_start` notification extension doesn't need output truncation guidance.

4. **Produce the report** using the structure in the Output Format section.

## Analysis checklist

### Structural correctness

- **Default export**: Extension must export a default function that receives `ExtensionAPI`
- **Import sources**: Should use `@mariozechner/pi-coding-agent` for types, `@sinclair/typebox` for schemas, `@mariozechner/pi-ai` for `StringEnum`, `@mariozechner/pi-tui` for UI components
- **TypeScript**: Extensions are loaded via jiti so they don't need compilation, but the code should still be well-typed
- **Directory structure**: Multi-file extensions need `index.ts` as entry point. Extensions with npm deps need a `package.json` with a `pi.extensions` field pointing to the entry

### API usage

- **StringEnum over Type.Union**: Tool parameters with string enums must use `StringEnum` from `@mariozechner/pi-ai`, not `Type.Union`/`Type.Literal` — the latter breaks Google's API
- **Tool parameter schemas**: Should use `Type.Object()` from typebox. Check that `Type.Optional()` wraps optional fields
- **Tool execute signature**: The correct signature is `execute(toolCallId, params, signal, onUpdate, ctx)` — check the parameter order
- **Event handler return types**: Different events expect different return shapes. For example, `tool_call` handlers can return `{ block: true, reason: "..." }`, while `context` handlers return `{ messages: [...] }`. Check these match what the docs specify
- **registerCommand handler**: Receives `(args, ctx)` where `ctx` is `ExtensionCommandContext` (has `waitForIdle()`, `newSession()`, `fork()`, `navigateTree()`, `reload()` — things event handlers can't access)
- **sendMessage vs sendUserMessage**: `sendMessage` injects custom messages; `sendUserMessage` sends as-if-typed-by-user. Check they're using the right one for their intent
- **deliverAs modes**: When sending messages during streaming, `deliverAs` is required. Check that `"steer"` (interrupts), `"followUp"` (waits), and `"nextTurn"` (queued) are used appropriately

### Error handling & robustness

- **Signal handling**: Tools that do async work should check `signal?.aborted` and pass `signal` to `pi.exec()` calls
- **Non-interactive mode**: If the extension uses `ctx.ui` dialogs (`select`, `confirm`, `input`, `editor`), it should check `ctx.hasUI` first — these are no-ops in print mode (`-p`) and JSON mode
- **Extension errors don't crash pi** (they're caught), but sloppy error handling still leads to confusing behavior. Flag unhandled promise rejections and missing try/catch around external calls
- **tool_call errors are fail-safe**: If a `tool_call` handler throws, the tool is blocked. This is intentional but the extension author should be aware

### Output & performance

- **Output truncation**: Tools that return potentially large output (file contents, command results, search results) must truncate. Pi provides `truncateHead`, `truncateTail`, `DEFAULT_MAX_BYTES` (50KB), and `DEFAULT_MAX_LINES` (2000). Large outputs can overflow context, break compaction, and degrade model performance
- **Streaming updates**: Long-running tools should call `onUpdate?.()` to show progress rather than going silent
- **Path normalization**: Some models prefix paths with `@`. Built-in tools strip this automatically. Custom tools that accept paths should do the same: `const cleanPath = path.startsWith("@") ? path.slice(1) : path`

### State management

- **Session persistence**: If the extension maintains state (counters, lists, settings), it should store snapshots in tool result `details` so state survives session branching and restarts. Reconstruct state in `session_start` by walking `ctx.sessionManager.getBranch()`
- **appendEntry for non-LLM state**: `pi.appendEntry()` persists data that the LLM doesn't need to see. Good for bookmarks, metadata, config — not for tool state that affects branching

### Security

- **Dangerous command patterns**: Flag if the extension runs shell commands without user confirmation for destructive operations
- **Credential handling**: API keys and tokens should come from environment variables or secure storage, not hardcoded
- **Path traversal**: If the extension accepts file paths from tool parameters, check for directory traversal concerns

### Custom rendering

- **renderCall / renderResult**: These are optional but significantly improve UX. If the tool produces structured output, custom rendering helps. Use `Text` from `@mariozechner/pi-tui` with `(0, 0)` padding (the wrapping Box handles padding)
- **Theme usage**: Renderers should use the `theme` parameter for colors (`theme.fg("accent", ...)`, `theme.fg("error", ...)`, etc.) rather than hardcoded ANSI codes, so they work with any theme
- **expanded support**: `renderResult` receives `options.expanded` — the collapsed view should be compact, with details on expand (Ctrl+O)
- **isPartial**: `renderResult` should handle `isPartial: true` for streaming state

### Purpose alignment

This is the "should this even be an extension?" check:

- **Extension vs. skill**: If the code is purely instructions for the LLM with no custom tools, events, or UI, it's probably better as a skill (a SKILL.md file). Extensions are for when you need to *run code* — intercept events, register tools, customize UI.
- **Extension vs. prompt template**: If it just modifies the system prompt with static text, a prompt template or `AGENTS.md` entry might be simpler.
- **Extension vs. CLI tool**: If it's a standalone utility that doesn't need pi integration (events, tools, session), it might be better as a regular CLI tool that the model calls via bash.
- **Scope creep**: Flag if the extension is trying to do too many unrelated things. Smaller, focused extensions are easier to maintain and compose.

## Output format

Structure your report like this:

```
# Extension Analysis: [name]

## What it does
[1-2 sentence summary of the extension's purpose]

## Purpose alignment
[Is this the right mechanism (extension vs skill vs prompt template)? Does the scope make sense?]

## Findings

### Critical
[Things that are broken or will cause real problems — wrong API usage, missing exports, etc.]

### Improvements
[Things that work but could be better — missing error handling, no truncation, etc.]

### Nice to have
[Polish items — custom rendering, streaming updates, theme usage, etc.]

## Summary
[Brief overall assessment and top 1-3 recommendations]
```

If a section is empty (e.g., no critical issues), say so briefly rather than omitting it — it's reassuring to know you checked.

Keep findings specific and actionable. Instead of "error handling could be improved", say "the `execute` function in the `deploy` tool calls `pi.exec('git push')` without try/catch — if the command fails, the error propagates as an unhandled rejection." Include line references or code snippets when helpful.

## Reference

If you need to look up pi extension API details during your analysis, read the extension docs at:
- `/nix/store/3q010y20inrndxjfqvydd6nhn66drfdr-pi-coding-agent-0.55.3/lib/node_modules/pi-monorepo/docs/extensions.md`

For examples of well-written extensions:
- `/nix/store/3q010y20inrndxjfqvydd6nhn66drfdr-pi-coding-agent-0.55.3/lib/node_modules/pi-monorepo/examples/extensions/`
