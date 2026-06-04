---
description: Task spawn — delegate ONE task. Auto-routes to a subagent (returns artifact) or teammate (long-running session) based on scope and preset needs.
argument-hint: "<single task description>"
---
Delegate one task off the lead. Auto-routes to **subagent** (small artifact) or **teammate** (long-running session) so the lead keeps a small context.

**Input**: `$@` — a single task description.

**Related**: For many items at once, use `/tq`. For an explicit teammate spawn (no auto-routing), use `/tm`.

### Step 1: Empty / multi-task guard

- If `$@` is empty, ask the user what to delegate and stop.
- If the input clearly describes >1 discrete task ("review X, do Y, fix Z"), suggest `/tq` instead and stop.

### Step 2: Route — subagent vs teammate

Auto-route based on these signals. Don't ask the user unless genuinely ambiguous.

**Choose teammate when ANY of:**
- Verb implies a long-running session: `review`, `investigate`, `implement`, `build`, `fix`, `refactor`, `validate`, `test`, `triage` (multi-step modes), `address feedback`
- Task references a known skill that runs in its own session (`review`, `slack-triage`, `mozart-validate`, `mozart-plan-and-implement`, `binks-review`, `pr-ci-autofix`, `autoresearch-create`, ...)
- Task needs a different working directory (worktree, separate repo)
- Task needs a non-default preset (`triage`, `investigate`, `workspace`, `code+`, `experiment`, `all`)
- User says "as a teammate", "spawn", "in cmux", "background", or similar

**Choose subagent when ANY of:**
- Verb implies a single-shot artifact: `draft`, `summarize`, `extract`, `format`, `translate`, `analyze`, `propose`, `compare`, `lookup`, `cite`
- Task is a focused research question with a clear, bounded answer
- User says "as a subagent", "without spawning a workspace", "just give me", "return"

**Override**: any explicit phrase ("as a subagent" / "as a teammate" / "with preset X") wins over heuristics.

If still ambiguous after these heuristics, ask once: "subagent (returns artifact) or teammate (own session)?" and proceed on the answer.

### Step 3: Spawn

**Subagent route:**

Pick an agent if one fits the task verbatim (e.g., `librarian` for code lookups, `plan-questioner` for refining problems, `task-runner` for drafting an artifact). Otherwise default to `task-runner`.

```
subagent({
  agent: "<chosen agent or task-runner>",
  task: "<task with all needed context inlined>"
})
```

After it returns, present the artifact (or the agent's full response if it's a reasoning artifact) to the user.

**Teammate route:**

```
team_spawn({
  name: "<snake_case short name>",
  task: "<self-contained task — inline file paths, PR numbers, working dirs>",
  preset: "<inferred preset, omit if 'code'>"  // optional
})
```

Don't pass `model` unless the user requested one.

After spawning, print one line:

> @<name> spawned. Monitor: `C-Space <n>` · `team_status` · `team_message <name> ...`

### Step 4: Don't pollute the lead

- For teammate route: do NOT poll the teammate's output. Treat its pane as the user's workspace per AGENTS.md.
- For subagent route: present the returned artifact as-is. Don't re-summarize a summary.

### Guardrails

- **Inline all needed context.** Whatever the user mentioned (file path, PR number, branch, plan doc) goes into the spawned task verbatim. Subagents and teammates have no access to the lead's conversation.
- **Don't fabricate context.** If something is unclear, ask the user once before spawning.
- **One task only.** Multi-task input → suggest `/tq`.
- **Trust the route.** If the heuristics pick subagent and you're 70%+ sure, go. Don't ask "is that ok?" unless truly torn.
