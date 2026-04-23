# Advanced Pi Workflows

A reference for advanced [pi](https://github.com/mariozechner/pi) workflows — subagents, teammates, branching, autoresearch, crew orchestration, and background jobs. Based on community patterns and 2026 multi-agent best practices.

## 1. Subagents (`subagent` tool)

**What:** Delegate tasks to specialized agents with isolated context. Each subagent gets a fresh context window, preventing the parent session from being overwhelmed. Supports single, parallel, and chain modes.

**Key patterns:**

- **Parallel research** — spawn 2-4 subagents to investigate different angles simultaneously. Each returns a concise summary instead of polluting the parent with 50 file reads.
- **Diverge-judge** — two subagents propose competing solutions, a third judges them. (Core of the multi-model planning pipeline.)
- **Chain mode** — sequential execution where each step's output feeds the next via `{previous}` placeholder. Good for research → implement → validate pipelines.
- **Agent definitions** — `.md` files in `~/.pi/agent/agents/` with frontmatter specifying model, temperature, system prompt. Route cheap tasks to Sonnet, expensive reasoning to Opus.

**Best practices (2026 consensus):**

- Keep subagent tasks **genuinely independent**. If task B needs task A's output, use chain mode, not parallel.
- Provide **narrow, well-defined objectives**. "Review auth module for SQL injection" beats "review this codebase".
- **Pre-load files** in the task prompt when the parent already has them. Eliminates multi-turn tool-use latency (the biggest wall-time contributor).
- Cap at **2-4 parallel subagents**. Over-spawning degrades quality and can exhaust rate limits.
- Subagents consume ~3-4x tokens of a single-session approach. Budget accordingly.
- **Never nest subagents from teammates** — known instability. Run subagents from the lead session.

## 2. Teammates (`team_spawn` / `team_message` / `team_broadcast`)

**What:** tmux-based multi-agent coordination. Multiple Pi sessions running in parallel panes, communicating via file-based mailboxes. One session acts as lead/coordinator.

**Key patterns:**

- **Specialist teams** — spawn teammates with preset-specific toolsets (e.g. triage, investigate, workspace, code+).
- **Parallel implementation** — each teammate owns a disjoint set of files. Critical: **strict file ownership prevents silent corruption**. Two agents editing the same file without isolation = data loss, not merge conflicts.
- **Research delegation** — spawn a teammate for deep research that reports back without filling the lead's context.
- **File reservation** — `pi_messenger({ action: "reserve", paths: ["src/auth/"] })` prevents conflicts.

**Best practices:**

- Use `preset` parameter explicitly based on the task domain. Default preset may lack required tools.
- Keep teams to **3-5 agents max**. Token cost scales ~7x vs single session.
- Create **explicit handoff documents** before context fills up. Auto-compaction can cause the lead to "forget" about teammates (known issue).
- `team_request_shutdown` for graceful cleanup; `team_cleanup` tears everything down.
- Teammates are heavier than subagents — use when tasks need **sustained parallel work** or **inter-agent communication**, not one-shot delegations.

**When to use teammates vs subagents:**
| Dimension | Subagents | Teammates |
|-----------|-----------|-----------|
| Lifecycle | Single shot, returns result | Long-running, persistent |
| Communication | Parent-child only | Peer-to-peer messaging |
| Context | Shares parent's tools | Independent session |
| Cost | 3-4x single session | ~7x single session |
| Best for | Focused research, parallel review | Cross-layer features, competing hypothesis debugging |

## 3. Session Branching & Forking

**What:** Pi stores sessions as tree structures in JSONL files. Every point in conversation history is a potential branch point.

**Key commands:**

- **`/tree`** — Navigate the session tree. Jump to any previous point and continue from there. All branches preserved in a single file. Filter modes: default → no-tools → user-only → labeled-only.
- **`/fork`** (or `Ctrl+Shift+F`) — Create a **new session file** from the current branch. Copies history up to the selected point, places that message in the editor for modification.
- **`/back`** — Return to the parent session after a fork. Reads the parent link from the session header or a persisted custom entry. (Third-party extension: `fork-back`.)
- **`--fork <path|id>`** — Fork from CLI. Copy full source session into new session file.
- **`Shift+L`** — Label entries as bookmarks (visible in `/tree`).
- **`Shift+T`** — Toggle label timestamps.

**Fork → Back workflow:**

1. You're working in session A and a tangent arises
2. `/fork` — select a message, edit the prompt for the new direction
3. Work in the forked session B (new session file, fresh context from the fork point)
4. `/back` — switch directly to session A. No searching through `/resume`.

**Fork point selection (critical):**

- **Always pick a message after the first assistant response.** There's a known pi issue where `createBranchedSession` defers writing the session file when the branch has no assistant messages. The parent link is lost, and `/back` won't work.
- Pick a point that includes the context you need but excludes the tangent work.
- Label important fork points with `Shift+L` before forking — makes `/tree` navigation faster if you need to find them later.

**Key patterns:**

- **Exploratory branching** — try approach A, `/tree` back to the decision point, try approach B. Compare results without starting over.
- **Fork for isolation** — when a thread becomes a separate task, `/fork` it into its own session so the original stays clean. `/back` to return.
- **Session resumption** — `pi -c` continues most recent, `pi -r` browses all. Great for picking up where you left off across terminal restarts.
- **tmux-fork** — `/tmux-fork [name]` forks into a new tmux window. `/tmux-fork-pane [name]` forks into a split pane. Both run `pi --fork` in the new window/pane.

**Best practices:**

- **Label decision points** with `Shift+L` before branching. Makes `/tree` navigation much faster.
- Prefer `/fork` over `/clear` — fork preserves history and creates a clean context without cache-miss penalties.
- Use `--fork` from CLI when spawning tmux windows for separate tasks.
- Fork proactively when switching between unrelated codebases or when a quick question turns into substantial investigation.

## 4. Autoresearch

**What:** Autonomous optimization loop (inspired by Andrej Karpathy's pattern), adapted for pi. Give the agent an optimization target with a measurable metric. It experiments autonomously: edit code → run benchmark → measure → keep improvements, discard regressions → commit/revert → repeat.

**Key tools:**

- **[pi-autoresearch](https://github.com/davebcn87/pi-autoresearch)** — the loop engine. `run_experiment`, `log_experiment`, confidence scoring, git commit/revert, built-in status widget (`Ctrl+X`).
- **[pi-autoresearch-studio](https://github.com/jhochenbaum/pi-autoresearch-studio)** — control plane with TUI + web dashboard, selective PR creation, experiment explanation, plan/ideas editing.

**How it works:**

1. Define an optimization target (test speed, bundle size, build time, any measurable metric)
2. Agent loops: edit → benchmark → measure → compare
3. Improvements are committed, regressions are reverted
4. Results logged to `autoresearch.jsonl` and `autoresearch.md`
5. Use studio to cherry-pick winning experiments into PRs

**Example use cases:**

- Reducing CI test suite runtime (baseline benchmark → iterative optimization)
- Shrinking bundle size
- Speeding up build time
- Reducing memory usage
- Anything with a reproducible benchmark

**Best practices:**

- Set a clear **optimization target** with a **baseline measurement**
- Use `autoresearch-studio` to review experiments before promoting to PRs
- Add a githook to reject pushes to main that include `autoresearch*` files
- Works in worktrees for isolation
- The agent can self-heal when the context window fills up

## 5. `/btw` (pitw — Ephemeral Side Questions)

**What:** Ask quick questions without polluting your main conversation. Zero trace in session history.

**Install:** `pi install https://github.com/shopify-playground/pitw`

**Key features:**

- **Ephemeral** — question + answer leave zero trace in conversation history
- **Context-biased** — session context included as background, but answers aren't limited to it
- **Multi-turn** — press `c` to ask follow-ups within the panel
- **Promote** — press `p` to synthesize the btw conversation into a task + context prompt for the main session
- **Breakout** — press `n` to spawn a new pi session with the full Q&A
- **Dismiss** — `Enter`/`Esc` to return to your session

**Key patterns:**

- Quick API/syntax lookups mid-implementation without derailing context
- "Is there a simpler way to write this?" checks during coding
- Getting summaries of active autoresearch sessions
- Checking GraphQL schema or conventions without filling context

## 6. Crew Orchestration (`pi_messenger`)

**What:** Multi-agent coordination with structured task management. Plan from PRDs, work through tasks, reserve files, review implementations.

**Key actions:**

- `plan` — auto-discover PRD or use inline prompt, generates task breakdown
- `work` — run ready tasks; `autonomous: true` runs until done/blocked
- `task.split` — decompose large tasks into subtasks
- `reserve` — claim file paths to prevent conflicts
- `review` — review task implementation

**Typical pattern (from community skill `l3wi/agents-workflow`):**

1. `/skill:plan <feature>` — PRD interview → technical spec → task files
2. `/skill:swarm <feature>` — spawn parallel worker agents in worktrees per phase
3. Batched execution with dependency ordering and merge coordination
4. `/skill:validate-plan <feature>` — verify spec compliance

## 7. Background Jobs (`bg_run` / `bg_list` / `bg_log`)

**What:** Run long-lived processes in the background. Essential for dev servers, CI monitoring, file watchers.

**Key patterns:**

- **Dev server + implementation** — `bg_run` starts the server, work continues in foreground
- **Parallel diff gathering** — `bg_run` for each PR diff, collect results without blocking
- **CI polling** — `bg_run` with periodic checks; `bg_wait` for completion
- **Log tailing** — `bg_log` with offset for incremental reads

## 8. Additional Community Patterns

### pi-squared

Headless pi agent spawning. Spin up background agents that research topics and report back without filling your context window. Extension + CLI.

### pi /config

Portable, shareable pi configurations. `/config publish` shares your setup, `/config import <name>` installs someone's config, `/config vanilla` gets a clean slate.

### Model routing for cost control

Route cheap tasks to cheaper models (e.g. Sonnet for straightforward delegations) and reserve expensive reasoning models (Opus) for planning and judging. Agent definitions with model frontmatter enable this cleanly.

### Recap extension

After N minutes of inactivity, auto-generates a short recap of what you're working on and displays it passively above the input box. Doesn't clutter the context window.

### Token-reduction extensions

Strip noise from tool outputs before they hit the context (e.g. verbose CLI outputs, repetitive headers). Customizable per-command.
