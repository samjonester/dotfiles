---
summary: Auto-names sessions using a fast LLM so /resume shows descriptive titles.
commands: [/retitle, /retitle-all]
category: productivity
keywords: [session, naming, llm, productivity]
---

# Retitle

Automatically names your pi sessions using a fast LLM so `/resume` shows descriptive titles instead of raw first messages.

## How it works

On each of the first 3 prompts, the extension sends conversation context to Claude Haiku and calls `pi.setSessionName()` with the result. After the third, it stops — no ongoing token spend.

Each prompt gets two passes, so 6 Haiku calls per session at most:

| Pass | Event | Context | Why |
|------|-------|---------|-----|
| Submit | `before_agent_start` | user messages + the prompt just submitted, which is not in the session branch yet | A title appears within about a second, rather than after the turn's tool calls finish |
| Refine | `agent_end` | the same, plus the first 800 characters of the latest assistant message | A vague prompt ("yes", "continue", "fix it") names nothing; the turn that followed usually names the PR, file, or failure |

Both calls are fire-and-forget and never block the agent. Because either can be the slow one, each carries a ticket and only applies if no later pass already set a name — a slow submit pass cannot walk back a refine pass that already landed.

pi can run the agent more than once per prompt (auto-retry, compact-and-retry, queued follow-ups), so the refine pass is capped at once per prompt rather than once per run.

Resumed sessions that already have a name are left alone.

## Repo-qualified identifiers

A bare `#2031382` does not say which repo it belongs to, which is useless when several sessions are open at once. Titles use `repo#N` instead — `world#2031382`, `shop-pi-fy#878`, `issues-marketing-efficiency#1764`.

The repo is resolved per number, in this order:

1. A source that carries both, so the binding is exact — `github.com/org/repo/pull/N`, `github.com/org/repo/issues/N`, `meteorite.shopify.io/repos/org/repo/pulls/N`, `org/repo#N`, `repo#N`.
2. For a bare `#N`, `PR N`, or `gs pr checks N`: the repo mentioned most often anywhere in the text, including repo-only signals such as `gh --repo org/repo` and `cicd-control-center.shopifysvc.com/ci/org/repo/...`.
3. The repo of pi's own checkout, from `git remote get-url origin`. This is last so a stray number in a dotfiles session is not mislabeled once the text names a real repo. The remote is parsed rather than `git rev-parse --show-toplevel` because every shop/world worktree bottoms out at `.../trees/pool-N/src`.

Known false positive, inherited from the original `#N` rule: an all-digit 6-character hex color such as `#445566` is read as an identifier. `#1a2b3c` is not, because it contains letters.

## Commands

| Command | Description |
|---------|-------------|
| `/retitle` | Re-generate the session name from conversation context. Uses compressed context (first 2 + last 3 user messages + compaction summary) so it works well on long conversations. |
| `/retitle-all` | Backfill names for all unnamed sessions across all projects. Shows a confirmation prompt before starting. |

## Manual rename safety

If you manually name a session with `/name` during the first 3 prompts, the extension detects this and stops auto-naming — your manual name always takes precedence.

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
| `before_agent_start` | Submit pass — name from the prompt alone (prompts 1-3 only), fire-and-forget |
| `agent_end` | Refine pass — re-name with the turn's output in context, once per prompt, fire-and-forget |
| `session_start` | Reset state; skip auto-naming if session already has a name |
| `session_switch` | Reset state on `/new` or `/resume` |
| `session_fork` | Reset state and auto-name the new fork |

## Requirements

- A fast model available in your model registry (Claude Haiku via Shopify AI proxy by default)

## Credits

Inspired by [pascal-de-ladurantaye/pi-agent/session-namer](https://github.com/pascal-de-ladurantaye/pi-agent/tree/main/extensions/session-namer), extended with manual rename detection, `/retitle` for long conversations, `/retitle-all` for backfilling, configurable model, repo-qualified identifiers, and a two-pass submit/refine naming cycle.
