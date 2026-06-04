---
name: atc-spinoff
description: "Spin off an open ATC task into a dedicated troubleshooting session in a new cmux workspace with a reserved WTP pool"
arguments:
  - name: task_id
    description: "ATC task ID (e.g. ATC-20260518-092800) — omit to pick interactively from open tasks"
    required: false
  - name: context
    description: "Additional context for the subagent — e.g. what you already know, what to focus on, skip the Slack fetch, etc."
    required: false
---

Spin off an ATC task for troubleshooting. Follow these steps exactly:

## Step 1: Identify the task

Read `~/.pi/tmp/atc-tasks.md`.

Determine the task ID from these sources (first match wins):
1. Template argument: `{{task_id}}`
2. The user's message text — look for an `ATC-YYYYMMDD-HHMMSS` pattern
3. If neither provides a valid ID, show all open tasks and ask the user to pick one

Find the matching open task. Extract the task title, source link, priority, and notes.

## Step 2: Initial investigation (subagent)

Dispatch a subagent to do initial research. The subagent should:

1. Read the ATC knowledge wiki page: `wiki_read path: "methods/atc-triage.md"`
2. If the task has a Slack source link, fetch the full thread for latest context
3. If the task references a GitHub issue, read it
4. Search relevant Mozart/Brochure codebase docs using `grokt_search` based on the issue domain (paid ads vs LPG vs other)
5. Determine what type of work is needed:
   - **investigate**: docs research, log analysis, Observe queries, Slack context gathering
   - **code**: code changes needed in Mozart or Brochure (bug fix, config change, re-dispatch workflow)

{{context}}

The subagent MUST output a structured result with these exact fields:

```
PRESET: code OR investigate
TITLE: short-title-for-cmux-workspace (kebab-case, max 30 chars)
SUMMARY: 2-3 sentence summary of what was found
PROMPT: A complete, self-contained prompt (50-150 words) for the new pi session that includes:
  - What the issue is
  - What was already tried
  - Specific files/paths/URLs to start with
  - What the next concrete step should be
```

## Step 3: Reserve a WTP pool slot

Run:
```bash
$HOME/src/github.com/shopify-playground/wtp/bin/_wtp main
```

This claims a free pool slot on `main`. Parse the output to get the slot name (e.g. `pool-2`).

The pool contains both `areas/platforms/mozart` and `areas/platforms/brochure` in the same worktree at `~/world/trees/<slot>/src`.

## Step 4: Open cmux workspace and start pi

Run a single bash command:
```bash
POOL_DIR=~/world/trees/<slot>/src
cmux new-workspace --name '<TITLE>' --cwd "$POOL_DIR" --command "pi --preset <PRESET> '<PROMPT>'" --focus true
```

The cmux workspace opens in `$POOL_DIR` via `--cwd`, so pi inherits the cwd — do NOT pass pi `--cwd` (pi doesn't support it). Where `<TITLE>`, `<PRESET>`, and `<PROMPT>` come from the subagent output. Shell-escape the prompt properly (single quotes around the prompt, escape any internal single quotes with `'\''`).

## Step 5: Confirm

Tell the user:
- Which task was spun off (ID + title)
- Which pool slot was claimed
- Which cmux workspace was opened
- What preset was used
- Remind them to `_wtp free <slot>` when done
