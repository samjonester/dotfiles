---
summary: Lets the agent reload extensions and skills after editing them, enabling continuous iteration without manual intervention.
commands: [/auto-reload]
category: extension-development
keywords: [reload, extensions, skills, development, iteration]
---

# Auto-Reload Extension

Gives the agent a `reload_extensions` tool so it can reload extensions and skills after editing them — no manual intervention needed after the initial enable.

## The problem

When an agent is iterating on a pi extension, every edit requires a reload. Without this extension, the user has to manually run a command after each change, breaking the agent's flow.

## How it works

Pi's `ctx.reload()` and `ctx.waitForIdle()` are only available inside command handler contexts — not in tool contexts. This extension works around that:

1. `/auto-reload` captures `reload()` and `waitForIdle()` from the command context
2. `globalThis` stores the captured functions so they survive across reloads
3. The `reload_extensions` tool fires `waitForIdle()` → `reload()` after the turn ends, then sends a follow-up message to resume the conversation

```
Agent edits extension file
        │
Agent calls reload_extensions
        │
Agent stops (tool instructs it to end the turn)
        │
waitForIdle() resolves
        │
reload() fires — extensions re-initialize
        │
sendUserMessage() kicks off a new turn
        │
Agent continues where it left off
```

## Setup

Install the `shop-pi-fy` package. Then run `/auto-reload` once per session to enable.

## Usage

### Enable

```
/auto-reload
```

You'll see: **Auto-reload: on**. The agent can now reload itself after editing extension or skill files, repeatedly, without further user interaction.

### Disable

```
/auto-reload
```

Toggles back to off.

### Agent guidelines

The extension injects `promptGuidelines` so the agent automatically knows when to call the tool. You can also add these to your `AGENTS.md`:

```markdown
- After editing any file in ~/.pi/agent/extensions/, ~/.pi/agent/skills/,
  .pi/extensions/, or .pi/skills/, call reload_extensions so changes take effect.
- If reload_extensions says it needs bootstrapping, ask the user to run /auto-reload once.
```

## Limitations

- **One-time bootstrap per session.** `/auto-reload` must be run once because `ctx.reload()` only exists on command handler contexts — there's no way to access it from tool or event contexts. Once captured, subsequent reloads work automatically via `globalThis` persistence.
- **Follow-up message.** After each reload, "Reload complete. Continue where you left off." appears as a user message to resume the agent. This is cosmetic — `sendUserMessage` is the only way to trigger a new turn after reload.
