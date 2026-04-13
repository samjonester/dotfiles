---
name: batch-review
description: "Review multiple PRs in batches with hard gating between batches for user action (approve, request changes, post comments). Classifies PRs, gathers diffs via bg_run, dispatches reviewers from the lead via subagent, and manages WTP worktree lifecycle. Triggers on: 'review these PRs', 'batch review', 'review PRs #1 #2 #3', or any request to review multiple PRs."
---

# Batch PR Review Orchestrator

You orchestrate multi-PR review sessions. You classify PRs, gather diffs in parallel via `bg_run`, dispatch reviewers from the lead (never from teammates), and gate between batches so the user can act on findings before moving on.

**This skill builds on the `review` skill.** It uses the same reviewer agents, judge, classification matrix, and output templates — but manages the multi-PR lifecycle: batching, WTP worktree management, parallel diff gathering, and iterative user interaction.

## Principles

1. **No nested parallelism** — reviewers are dispatched from the lead via `subagent`, never from teammates. This prevents the instability of nested subagent spawning.
2. **Hard batch gating** — after presenting findings for a batch, wait for the user to act on each PR before starting the next batch. No automatic advancement.
3. **Event-driven, not polling** — use `bg_wait` for diff gathering (blocking) and `subagent` for reviewer dispatch (blocking). No cron polling loops.
4. **`bg_run` for mechanical work** — diff gathering and branch checkout are mechanical tasks. Use `bg_run` (no tmux pane, no context overhead) instead of `team_spawn`.
5. **WTP worktrees for every PR** — check out each PR into its own WTP slot so reviewers can read the full codebase.

## Step 1: Accept and Classify PRs

### 1a. Parse the PR list

Accept PRs in any format:
- PR numbers: `#595413 #597454 #596728`
- Graphite/GitHub URLs
- From memory bank (if user says "review the PRs from my queue")

For each PR, fetch metadata:

```bash
gh pr view <number> --repo shop/world --json number,title,url,baseRefName,headRefName,body,additions,deletions,changedFiles
```

### 1b. Classify each PR

Read [../review/references/reviewer-matrix.md](../review/references/reviewer-matrix.md) for classification rules.

For each PR, determine:
- **Language** — from the changed file extensions (use `gh pr diff <number> --name-only` for the file list)
- **Change type** — from file patterns and PR metadata
- **Size** — from additions + deletions (reviewable lines)
- **Risk signals** — from file paths

Map each to core and optional reviewer sets per the matrix.

### 1c. Present classification to user

Show a table before proceeding:

```
## PR Review Plan

| # | PR | Author | Size | Type | Core reviewers | Optional | Batch |
|---|-----|--------|------|------|---------------|----------|-------|
| 1 | #595413 | Connor | tiny | config-ci | scope, operations, security | intent | 1 |
| 2 | #597454 | River | tiny | bug-fix | correctness, scope, testing | design, nullsafety | 1 |
| 3 | #596728 | Tim | medium | test-only | scope, testing | simplify | 1 |
| 4 | #529997 | Tim | medium | bug-fix | correctness, scope, testing | design, nullsafety | 2 |
| 5 | #578490 | Tim | large | service-extraction | architecture, design, correctness, scope | naming, consistency, simplify | 3 |
```

Wait for user confirmation or adjustments ("skip #3", "add security to #4", "move #5 to batch 2").

## Step 2: Batch PRs

Group PRs into batches by size (from the reviewer matrix):

| Size | Max PRs per batch |
|------|-------------------|
| tiny (<50 lines) | 5 |
| small (<200 lines) | 3 |
| medium (<500 lines) | 2 |
| large (500+ lines) | 1 |

**Mixed-size batches:** When PRs vary in size, use the smallest max from any PR in the batch. E.g., if a batch has 1 tiny and 1 medium PR, the batch limit is 2 (medium's limit).

**Ordering:** Process batches in this order:
1. Tiny/small PRs first — fast wins, clear the queue
2. Medium PRs next
3. Large PRs last — they take the longest and benefit from full attention

## Step 3: Execute Batches

For each batch, run this sequence:

### 3a. Claim WTP worktrees and gather diffs

For each PR in the batch, launch a `bg_run` job that:
1. Claims a WTP slot
2. Checks out the PR branch
3. Writes the diff to a temp file

```bash
bg_run({
  command: "bash -c '\
    WTP_BIN=$HOME/src/github.com/shopify-playground/wtp/bin/_wtp; \
    BRANCH=<headRefName>; \
    TARGET_DIR=$($WTP_BIN \"$BRANCH\"); \
    cd \"$TARGET_DIR\"; \
    git fetch origin \"$BRANCH\"; \
    git checkout \"$BRANCH\" 2>/dev/null || git checkout -b \"$BRANCH\" \"origin/$BRANCH\"; \
    git reset --hard \"origin/$BRANCH\"; \
    echo \"WORKTREE=$TARGET_DIR\"; \
    gh pr diff <number> > /tmp/review-<number>.diff; \
    echo \"DIFF_READY=/tmp/review-<number>.diff\"; \
    echo \"DONE\"'"
})
```

Launch all jobs for the batch simultaneously, then `bg_wait` for each.

Parse the output to extract `WORKTREE` path and `DIFF_READY` path for each PR.

**If WTP fails** (no free slots): inform the user and offer to either free slots or fall back to diff-only review for that PR.

### 3b. Review each PR

For each PR in the batch, sequentially:

1. **Read the diff** from `/tmp/review-<number>.diff`
2. **Sanitize** per the review skill's Step 2a rules (strip binaries, summarize autogenerated files)
3. **Compose the reviewer task** per the review skill's Step 4a (include review standards, PR metadata, diff)
4. **Dispatch core reviewers** via `subagent`:

```json
{
  "tasks": [
    { "agent": "review-scope", "task": "<composed>", "cwd": "<worktree path>" },
    { "agent": "review-correctness", "task": "<composed>", "cwd": "<worktree path>" },
    ...
  ]
}
```

5. **Evaluate early exit** — per the review skill's Step 4b rules (tiny + 0 findings → skip optional + judge)
6. **Dispatch optional reviewers** if needed (same pattern, `cwd` set)
7. **Compress findings** per the review skill's Step 5a
8. **Dispatch judge** via `subagent`:

```json
{
  "agent": "review-judge",
  "task": "<composed judge task with compressed findings + diff>",
  "cwd": "<worktree path>"
}
```

9. **Store the review output** — save the full formatted review for presentation

**Parallelism note:** Review PRs within a batch sequentially (one at a time), not in parallel. Each PR's reviewer dispatch is already parallel (3-5 subagents). Running multiple PRs' reviewers simultaneously would be 10-15+ concurrent subagents — the same instability that caused crashes in session e38c4798.

### 3c. Present batch findings

After all PRs in the batch are reviewed, present findings using the review skill's Step 6 template. For each PR, show:

```
---

## PR #595413 — [title] (by [author])

Classification: **config-ci** (yaml, tiny)
Reviewers: scope, operations, security (core) | intent (optional, skipped — tiny + clean)

### Verdict: ✅ APPROVE

[Executive summary from judge]

### Findings

[Any validated findings, or "No issues found"]

---
```

### 3d. GATE: User action

After presenting the batch, enter an interactive loop. Process user commands:

- **`approve #1234`** — Draft and post an approval comment for that PR
- **`request changes #1234`** — Draft and post a request-changes comment
- **`comment #1234`** — Draft a top-level review comment (present for review before posting)
- **`comment #1234 file:line "text"`** — Draft a line-level comment
- **`skip #1234`** — Move on without action
- **`next batch`** or **`next`** — Proceed to the next batch
- **`stop`** — End the review session, clean up all worktrees

**Do not proceed to the next batch until the user explicitly says `next batch`, `next`, or `stop`.**

If the user asks for details about a specific PR's review ("show me the full review for #1234", "what did the security reviewer say?"), present the stored review output.

### 3e. Clean up batch worktrees

After the user is done with a batch, free the WTP slots for PRs in that batch:

```bash
WTP_BIN="$HOME/src/github.com/shopify-playground/wtp/bin/_wtp"
"$WTP_BIN" free <slot>
```

Also clean up temp diff files:

```bash
rm -f /tmp/review-<number>.diff
```

Free slots before starting the next batch to keep the WTP pool available.

## Step 4: Summary

After all batches are complete (or the user says `stop`), present a final summary:

```
## Batch Review Complete

| # | PR | Author | Verdict | Action taken |
|---|-----|--------|---------|-------------|
| 1 | #595413 | Connor | ✅ APPROVE | Approved |
| 2 | #597454 | River | ✅ APPROVE | Approved |
| 3 | #596728 | Tim | ✅ APPROVE | Approved with 1 suggestion |
| 4 | #529997 | Tim | ❌ REQUEST CHANGES | Posted inline comments |
| 5 | #578490 | Tim | ⚠️ DISCUSS | Skipped — needs product input |

Worktrees freed: pool-1, pool-6, pool-7
Remaining in queue: none
```

Clean up any remaining WTP slots and temp files.

## Step 5: Monitor teammate (optional, for large batches)

For batches with 3+ PRs being reviewed, optionally spawn a lightweight monitor:

```bash
bg_run({
  command: "bash -c 'while true; do echo \"[$(date +%H:%M:%S)] Checking...\"; sleep 120; done'"
})
```

The monitor is NOT for polling subagent status (subagents block and return results directly). It's available as a heartbeat the lead can check if a reviewer subagent is taking unusually long (>5 minutes for a single PR).

In practice, the sequential subagent dispatch in Step 3b makes monitoring unnecessary for most sessions. Only use this if the user explicitly asks for status updates during long reviews.

## Constraints

- NEVER dispatch the review skill from a teammate — always from the lead via `subagent`
- NEVER use `team_spawn` for diff gathering — use `bg_run`
- NEVER auto-advance between batches — always wait for user input
- NEVER submit reviews without user approval — present drafts first
- NEVER use cron polling — the sequential `subagent` calls are inherently blocking
- Handle WTP slot exhaustion gracefully — inform the user, offer alternatives
- Clean up temp files and WTP slots after each batch, not at the end
