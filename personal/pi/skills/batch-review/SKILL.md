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
4. **`bg_run` for mechanical work** — diff gathering and branch checkout are mechanical tasks. Use `bg_run` (no cmux pane, no context overhead) instead of `team_spawn`.
5. **WTP worktrees for every PR** — check out each PR into its own WTP slot so reviewers can read the full codebase.

## Step 1: Accept and Classify PRs

### 1a. Parse the PR list

Accept PRs in any format:
- PR numbers: `#595413 #597454 #596728`
- GitHub URLs
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

> **⚠️ Two footguns this block MUST guard against — both bit a real session (2026-06-22):**
>
> 1. **Empty `TARGET_DIR` → destructive git in the wrong checkout.** When `_wtp` fails to return a path (race, branch already exists locally, no free slot), `TARGET_DIR` comes back empty. `cd ""` then **silently stays in the current directory** (the main checkout), and the following `git reset --hard` / `git checkout` run *there* — clobbering the root checkout's branch. ALWAYS abort the script if `TARGET_DIR` is empty or not a directory, and capture `_wtp`'s status output (it prints to **stderr**, the path to **stdout**).
> 2. **Parallel-claim race.** Launching multiple `_wtp` claims simultaneously makes two jobs grab the **same** slot (`_wtp` is not atomic — `index.lock` collision). **Claim slots SEQUENTIALLY**, then gather diffs in parallel.

**Step 1 — claim each slot sequentially** (one `bg_run` per PR, `bg_wait` each before launching the next):

```bash
bg_run({
  command: "bash -c '\
    set -euo pipefail; \
    WTP_BIN=$HOME/src/github.com/shopify-playground/wtp/bin/_wtp; \
    BRANCH=<headRefName>; \
    TARGET_DIR=$(\"$WTP_BIN\" \"$BRANCH\" 2>/tmp/wtp-<number>.err); \
    cat /tmp/wtp-<number>.err; \
    if [ -z \"$TARGET_DIR\" ] || [ ! -d \"$TARGET_DIR\" ]; then echo \"ABORT: no valid worktree dir for <number>\"; exit 1; fi; \
    cd \"$TARGET_DIR\"; \
    echo \"PWD=$(pwd)\"; \
    git fetch origin \"$BRANCH\" 2>&1 | tail -1; \
    git checkout \"$BRANCH\" 2>/dev/null || git checkout -b \"$BRANCH\" \"origin/$BRANCH\"; \
    git reset --hard \"origin/$BRANCH\" 2>&1 | tail -1; \
    echo \"WORKTREE=$TARGET_DIR\"; \
    gh pr diff <number> > /tmp/review-<number>.diff; \
    echo \"DIFF_READY=/tmp/review-<number>.diff\"; \
    echo \"DONE\"'"
})
```

`set -euo pipefail` + the explicit `TARGET_DIR` guard mean the script can never run git against the wrong checkout — it exits non-zero instead. `bg_wait` each job and confirm it printed `WORKTREE=<path>` and `DONE` before launching the next claim.

Parse the output to extract `WORKTREE` path and `DIFF_READY` path for each PR. Treat a job that exited non-zero, printed `ABORT:`, or has an empty `WORKTREE=` as a **failed claim** (see below) — do NOT proceed to review that PR until it has a real worktree.

**Step 2 — `gh pr diff` does not need a worktree.** If a claim fails but you still want to review, the diff was likely already written (or can be fetched standalone with `gh pr diff <number> > /tmp/review-<number>.diff`); fall back to diff-only review for that PR (a degraded mode — warn the user).

**If WTP fails** (no free slots, or a claim aborts): inform the user and offer to either free slots (`_wtp status` then `_wtp free <slot>`) or fall back to diff-only review for that PR. If you accidentally clobbered the main checkout, restore it: `git -C <root>/src checkout <original-branch>` (find it via `git -C <root>/src reflog`).

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

5. **Detect silent batch failures** — per the review skill's Step 4c. After every parallel `subagent` batch returns, check for `Parallel: M/N succeeded` where `M < N`, `(failed)`/`(no output)` agent blocks, or `Agent error:` strings. The reviewer never ran — do NOT pass empty output to the judge. Re-dispatch each failed agent as a **single** `subagent` call (singles surface the real error and almost always succeed when a wide batch silently failed). This bit a real session (2026-06-22): a 5-wide parallel batch returned `0/5 succeeded` with empty bodies; re-dispatching as one batch of 1 + one batch of 4 both worked.
6. **Evaluate early exit** — per the review skill's Step 4b rules (tiny + 0 findings → skip optional + judge)
7. **Dispatch optional reviewers** if needed (same pattern, `cwd` set)
8. **Compress findings** per the review skill's Step 5a
9. **Dispatch judge** via `subagent`:

```json
{
  "agent": "review-judge",
  "task": "<composed judge task with compressed findings + diff>",
  "cwd": "<worktree path>"
}
```

10. **Store the review output** — save the full formatted review for presentation

**Parallelism note:** Review PRs within a batch sequentially (one at a time), not in parallel. Each PR's reviewer dispatch is already parallel (3-5 subagents). Running multiple PRs' reviewers simultaneously would be 10-15+ concurrent subagents — the same instability that caused crashes in session e38c4798.

**Keep each parallel `subagent` dispatch ≤4 agents.** Batches of 5+ have failed silently (`0/N succeeded`, empty bodies) — see session 2026-06-22 where a 5-wide batch died and a 4-wide retry succeeded. If a change type maps to 5+ core reviewers, split into two dispatches (e.g. 4 + 1) rather than one wide batch. The judge always runs as its own single dispatch.

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
- NEVER do a single-pass ad-hoc review for any PR in the batch — every PR gets the full review pipeline
- NEVER `cd "$TARGET_DIR"` without first asserting it's non-empty and a real directory — an empty value silently runs destructive git in the main checkout
- NEVER launch WTP claims in parallel — claim slots sequentially (`_wtp` is not atomic), then gather diffs in parallel
- NEVER dispatch more than 4 subagents in a single parallel batch — split 5+ into multiple dispatches
- Handle WTP slot exhaustion gracefully — inform the user, offer alternatives
- Clean up temp files and WTP slots after each batch, not at the end

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "This PR in the batch is tiny, I'll review it inline" | Every PR gets the full multi-agent review pipeline. Batch doesn't mean some get shortcuts. The pipeline catches things you miss regardless of PR size. |
| "I'll combine the findings from multiple PRs into one review" | Each PR gets its own review cycle and its own user-action gate. Cross-PR findings get separate threads. Combining loses the per-PR decision point. |
| "The first batch had no issues, I'll speed through the rest" | Each batch is independent. Prior batch results don't predict current batch quality. Maintain the same rigor throughout. |
| "A WTP slot failed, I'll review this PR from diff only" | Diff-only review is explicitly a degraded mode (Step 1a of review skill). Warn the user, don't silently downgrade. |
