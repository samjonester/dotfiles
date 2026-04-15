---
summary: Auto-names sessions using a fast LLM so /resume shows descriptive titles.
commands: [/retitle, /retitle-all]
category: productivity
keywords: [session, naming, llm, productivity]
---

# Retitle

Automatically names your pi sessions using a fast LLM so `/resume` shows descriptive titles instead of raw first messages.

## How it works

After each of the first 3 agent turns, the extension sends conversation context to Claude Haiku and calls `pi.setSessionName()` with the result. The name refines as more context becomes available. After turn 3, it stops — no ongoing token spend.

Resumed sessions that already have a name are left alone.

## Commands

| Command | Description |
|---------|-------------|
| `/retitle` | Re-generate the session name from conversation context. Uses compressed context (first 2 + last 3 user messages + compaction summary) so it works well on long conversations. |
| `/retitle-all` | Backfill names for all unnamed sessions across all projects. Shows a confirmation prompt before starting. |

## Manual rename safety

If you manually name a session with `/name` during the first 3 turns, the extension detects this and stops auto-naming — your manual name always takes precedence.

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `PI_RETITLE_PROVIDER` | `anthropic` | Model provider |
| `PI_RETITLE_MODEL` | `claude-haiku-4-5` | Model ID |

Example — use GPT-4o mini instead:

```bash
export PI_RETITLE_PROVIDER=openai
export PI_RETITLE_MODEL=gpt-4o-mini
```

## Events

| Event | Action |
|-------|--------|
| `agent_end` | Generate/refine session name (turns 1-3 only) |
| `session_start` | Reset state; skip auto-naming if session already has a name |
| `session_switch` | Reset state on `/new` or `/resume` |
| `session_fork` | Reset state and auto-name the new fork |

## Requirements

- A fast model available in your model registry (Claude Haiku via Shopify AI proxy by default)

## Credits

Inspired by [pascal-de-ladurantaye/pi-agent/session-namer](https://github.com/pascal-de-ladurantaye/pi-agent/tree/main/extensions/session-namer), extended with manual rename detection, `/retitle` for long conversations, `/retitle-all` for backfilling, and configurable model.
