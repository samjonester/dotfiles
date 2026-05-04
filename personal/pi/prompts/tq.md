---
description: Task queue — orchestrate a multi-item request. Resolves selections from prior numbered lists, classifies each item, runs inline-trivial work via subagents, spawns teammates for heavy work. Designed to keep the lead's context small.
argument-hint: "<free-form prose | selection like 1,2,4 | multi-list anchored selection>"
---
Orchestrate multiple items off the lead. A `tq-planner` subagent decomposes and classifies; the lead walks the plan, invoking `task-runner` subagents for inline-trivial actions and `team_spawn` for teammate-worthy work. The lead's context only ever sees: the plan, artifacts (for approval), and short status lines.

**Input**: `$@` — a free-form description, OR a selection against prior numbered lists, OR a mix (e.g., `#PR_NUM only 1 & 2`).

**Related**: For ONE task, use `/ts`. For an explicit teammate, `/tm`.

### Step 1: Empty guard

If `$@` is empty, ask the user what to dispatch and stop.

### Step 2: Extract recent numbered lists from your context

Before invoking the planner, scan back through the conversation for **numbered lists in the last ~5 assistant messages**. For each list, capture:

- A short tag (e.g. `668312-findings`, `morning-research`)
- A one-line context (the section heading or surrounding sentence)
- The full list verbatim

If no numbered lists are present and the user input contains numeric selections, tell the user "no recent numbered list to resolve against" and stop.

If multiple lists exist and the user input doesn't anchor selections (e.g., just `/tq 1, 2, 4`), pick the most recent list and note it in the planner input.

### Step 3: Plan via subagent

Format the planner prompt:

```
USER_INPUT:
<verbatim $@>

RECENT_LISTS:
[<tag-1> from <one-line context>]
1. ...
2. ...

[<tag-2> from <one-line context>]
1. ...
2. ...
```

Call:

```
subagent({
  agent: "tq-planner",
  task: "<the formatted prompt above>"
})
```

The planner returns JSON: `{ items, teammate_waves, notes? }`.

### Step 4: Validate

- **0 items** → tell the user the input couldn't be parsed and ask for clarification. Surface `notes` if present.
- **1 item** and it's `inline_trivial` → suggest `/ts` instead and stop. (Single-item orchestration is overkill.)
- **>10 items** → tell the user there are too many for one batch. Ask which to prioritize.
- **Duplicate IDs** → defensively suffix `_2`, `_3`.
- **`notes` field** → surface verbatim before walking the plan.

### Step 5: Persist plan state (silent)

Write the plan + per-item status (`pending` initially) to `~/.pi/tmp/tq-<session_id>.json`. Never mention this file in user-facing output. Used for resume on re-invocation.

### Step 6: Print the plan

Show a compact preview before executing anything:

```
Plan (5 items):

Inline:
  • pr668312_review   Draft REQUEST_CHANGES for #668312 (findings 1+2)
  • pr44522_review    Draft APPROVE+comment for #44522
  • pr668492_review   Draft REQUEST_CHANGES for #668492 (findings 1-4)

Teammates:
  Wave 1 (parallel)
    @flaky_test       Investigate flaky CI test
  Wave 2 (sequential — consumes flaky_test output)
    @flaky_fix        Apply fix from investigation

Notes: <surface planner notes here>
```

### Step 7: Walk the plan

**Inline-trivial items** (in declaration order):

For each item:

1. Print: `→ <id>: drafting…`
2. Invoke the runner:
   ```
   subagent({
     agent: "task-runner",
     task: "<item.runner_task>"
   })
   ```
3. Display the runner's `Summary` and `Artifact` to the user. Format the artifact appropriately (JSON in a code fence, message body verbatim, etc.).
4. If `requires_approval: true`: ask the user to approve. Wait for explicit "yes" / "post" / "go" / "approved". On any change request, re-invoke the runner with the user's tweak.
5. On approval: execute per `execute_hint` (gh api call, file write, etc.) — usually one tool call. Print: `✓ <id> done`.
6. Mark `done` in the queue file. Move to next item.

**Teammate waves** (after all inline items, or interleaved if planner ordered them that way):

For each wave:

- **Parallel wave**: spawn all items in a single tool-call block via `team_spawn`. Use `teammate_preset` if provided. Print:
  ```
  Wave N (parallel) spawned:
    @id1  summary
    @id2  summary
  ```
- **Sequential wave**: spawn the single item. Wait for completion or input request via `team_status` polling. Surface input requests immediately and pause until user responds. On completion: `✓ <id> done`.

### Step 8: Final report

After the last item / wave:

> Monitor: `C-Space <n>` · `team_status` · `team_message <name> ...`

Summarize completed inline items briefly (`✓ pr668312_review · ✓ pr44522_review · ...`).

### Guardrails

- **Lead does NOT do reasoning.** All classification, drafting, and tool work happens inside subagents/teammates. The lead only routes, displays artifacts, and executes confirmed actions.
- **Don't poll teammate output for parallel waves.** Per AGENTS.md, treat teammate panes as the user's workspace. Polling only happens for sequential waves to know when to advance.
- **Always preview before executing.** The plan output (Step 6) is a hard checkpoint — don't skip it even for small batches.
- **Approval is per-item.** Even when batch-drafting, post each artifact one at a time after individual approval, unless the user says "approve all" / "post them all" / similar.
- **Pause is fine.** If the user re-runs `/tq <selection>` later with items still pending, resume from `~/.pi/tmp/tq-<session_id>.json` — skip already-done items, queue the rest.
- **Don't fabricate context.** The planner is responsible for inlining file paths, PR numbers, etc. into runner/teammate tasks. If a task prompt looks under-specified, surface that and ask before executing.
