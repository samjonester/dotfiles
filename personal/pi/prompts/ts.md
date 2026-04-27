---
description: Spawn teammates for multiple parallel activities — parses free-form prose into discrete tasks
argument-hint: "<free-form description of parallel work>"
---
Spawn pi teammates for parallel work described in free-form prose. No delimiters required — an LLM parses the input into discrete tasks first.

**Input**: `$@` — a free-form description of multiple things the user wants done in parallel.

### Steps

#### 1. Parse via subagent

If `$@` is empty, ask the user what to dispatch. Otherwise, call:

```
subagent({
  agent: "task-splitter",
  task: "<the raw $@ verbatim — do not rephrase>"
})
```

The subagent returns strict JSON: `{ tasks: [{ name, summary, task }, ...], notes? }`.

#### 2. Validate

- **0 tasks** → tell the user the input couldn't be parsed and ask for clarification.
- **1 task** → don't spawn. Tell the user "this looks like a single task — want me to just do it inline?" and stop.
- **>5 tasks** → tell the user there are too many for one batch (cap is 5 per AGENTS.md). Ask which to prioritize.
- **Duplicate names** → defensively append `_2`, `_3`, etc.
- **`notes` field present** → surface it to the user verbatim before spawning. If it flags file-scope overlap or a dependency, ask for confirmation before proceeding.

#### 3. Spawn

For each task in the validated list, call `team_spawn({ name, task })`. Spawn them in a single tool-call block when possible — they're independent.

Teammates inherit the lead's model and default tools. Don't pass `model` unless the user asked for a specific one.

#### 4. Report

Print a compact summary table:

```
@name           summary
─────────────── ────────────────────────────────────────
pr_review       Review PR #524035
slack_triage    Mid-day Slack triage
figma_actuators Wire dominanceIssue actuator
```

Then a one-line monitoring hint:

> Monitor: `C-Space <n>` to switch tmux windows · `team_status` · `team_message <name> ...`

Do NOT poll teammate output. Do NOT pull results back into the lead's context. Per AGENTS.md, treat each teammate's pane as the user's workspace for that task.

### Guardrails

- **Don't dispatch trivial work.** If the splitter returns 1 task, refuse to spawn — the user should just run it inline.
- **Don't fabricate context.** The splitter is responsible for inlining file paths, PR numbers, etc. into each task. If a task prompt looks under-specified, surface that and ask before spawning.
- **Independence is non-negotiable.** Two teammates editing the same file = silent corruption. If the splitter's `notes` flags overlap, stop and ask.

Ideal: ~3 tool calls total — one subagent (parse), one batch of `team_spawn` calls (1-5), one report.
