---
name: implement
description: "Execute a plan document step-by-step using isolated subagents. Each step gets a fresh context with only the files it needs, preventing context explosion. Triggers on: 'implement <plan>', 'implement step N from <plan>', 'execute plan', or any request to implement from a plan document."
---

# Step-Isolated Plan Implementer

You implement plan documents by running each step as an isolated subagent, preventing context accumulation across steps. This is the primary way to turn a plan into code.

## When to Use

- User says "implement `docs/PLAN-*.md`" or "execute the plan"
- User has a plan document with `## Implementation Steps` (produced by plan-judge)
- User wants to implement a specific step range

## Step 0: Parse the Plan

Read the plan document. Look for the `## Implementation Steps` section. If it doesn't exist, the plan wasn't produced by the updated judge — fall back to Step 0b.

### Step 0a: Plan has implementation steps

Extract each step's:

- **Read list** — files (with optional line ranges) the implementer needs
- **Create/Modify list** — files to write
- **Instructions** — what to do
- **Verify commands** — how to check the step worked
- **Dependencies** — which steps must complete first

Present the step overview to the user:

```
Found N implementation steps:
  1. [title] — creates: file1.ts, file2.ts | modifies: types.ts
  2. [title] — creates: file3.ts | modifies: file1.ts (from step 1)
  ...
  N. [title] — modifies: pipeline.ts (integration)

Ready to implement all steps, or specify a range (e.g., "steps 1-3")?
```

### Step 0b: Plan lacks implementation steps (legacy format)

If the plan doesn't have structured steps, run a **decomposer subagent** to create them:

```
subagent({
  agent: "implementer-plan",
  task: "<plan document contents>\n\n<file tree of the project (ls -R, directories only)>"
})
```

Present the generated steps to the user for approval before proceeding.

## Step 1: Pre-flight

Before executing any steps:

1. **Verify the project builds cleanly:**

   ```bash
   # Use whatever build/typecheck command the project uses
   npx tsc --noEmit 2>&1 | tail -5
   ```

   If the project doesn't build clean, stop and tell the user.

2. **Read the project's AGENTS.md** (if it exists) — pass relevant sections to each implementer.

3. **Determine the verification strategy:**
   - If each step has `Verify` commands, use those
   - Otherwise, default to `npx tsc --noEmit` after each step (catches type errors early)

## Step 2: Execute Steps

For each step (in dependency order):

### 2a: Compose the implementer task

Build the task by **pre-loading file contents** into the prompt. This eliminates tool-call round-trips in the subagent — the biggest source of latency and token waste.

````python
task = ""

# Include project conventions if available
if project_agents_md:
    task += f"## Project Conventions\n{relevant_sections}\n\n"

# Include the step instructions
task += f"## Task: {step.title}\n{step.instructions}\n\n"

# Include output from previous steps (summary only, not full files)
if previous_step_summaries:
    task += f"## Context from Previous Steps\n"
    for s in previous_step_summaries:
        task += f"- Step {s.number}: {s.summary}\n"
    task += "\n"

# Pre-load all files from the Read list
task += "## Reference Files\n\n"
for file_spec in step.read_list:
    content = read_file(file_spec)  # respects line ranges
    task += f"### `{file_spec.path}`\n```\n{content}\n```\n\n"

# List what to create/modify
task += f"## Files to Create/Modify\n"
for file_spec in step.create_modify_list:
    task += f"- `{file_spec.path}` — {file_spec.description}\n"

# Key design decisions from the plan (if any)
if step.design_decisions:
    task += f"\n## Key Design Decisions\n{step.design_decisions}\n"
````

### 2b: Dispatch the implementer

```
subagent({
  agent: "implementer-step",
  task: <composed task from 2a>
})
```

The implementer has `write`, `edit`, `bash`, `read`, `grep`, `find`, `ls` tools — it can write files and run verification commands but its context starts clean with just the pre-loaded files.

### 2c: Capture the result

The implementer returns:

- Files created/modified (paths)
- Verification result (pass/fail + output)
- A **one-line summary** of what was done

Store the summary for passing to subsequent steps (via the "Context from Previous Steps" section).

### 2d: Handle failures

**Verification fails:**

1. Show the user the error output
2. Offer options:
   - **Retry this step** — re-run the subagent (it gets a fresh context)
   - **Fix manually** — user fixes the issue, then resume from next step
   - **Abort** — stop implementation

**Subagent crashes or times out:**

1. Check what files were written (they persist on disk even if the subagent died)
2. Run the verification command
3. If verification passes, the step completed despite the crash — proceed
4. If verification fails, retry the step

## Step 3: Final Verification

After all steps complete:

```bash
# Full build check
npx tsc --noEmit

# Run all tests
npx vitest run

# Run any project-specific checks (lint, etc.)
```

Report the final status:

```
Implementation complete:
  ✅ Steps 1-N all passed verification
  ✅ Full typecheck passes
  ✅ All tests pass (X total, Y new)

Files created: [list]
Files modified: [list]
```

## Token Budget Awareness

The entire point of this skill is context isolation. Key invariants:

1. **Each subagent starts fresh** — no accumulated conversation history
2. **File contents are pre-loaded in the prompt** — no tool-call round-trips to read files
3. **Previous steps are summarized, not replayed** — one line per step, not the full conversation
4. **The orchestrator (you) carries minimal context** — step summaries + plan metadata only

If a single step's read list exceeds ~50KB of file content, warn the user that the step may be too large and suggest splitting it.

## Resumability

Track progress by noting which steps have completed. If the session is interrupted:

```
Implementation progress: 4/8 steps complete
  ✅ Step 1: AI types and shared interfaces
  ✅ Step 2: AI client with Result<T> wrapper
  ✅ Step 3: Classify module with prompt
  ✅ Step 4: Plan module with few-shot examples
  ⬜ Step 5: Judge module (next)
  ⬜ Step 6: Apply module
  ⬜ Step 7: Strategy orchestrator
  ⬜ Step 8: Integration and UI

Resume with: "implement steps 5-8 from docs/PLAN-PHASE2.md"
```

## Constraints

- NEVER skip the verification step — catching errors per-step is far cheaper than debugging at the end
- NEVER pass full file contents between steps — summaries only
- NEVER let the orchestrator's context grow beyond the plan + step summaries
- If a step requires reading files not in its Read list, that's a planning error — note it and add the file, but flag it for plan improvement
