---
name: mozart-plan-and-implement
description: End-to-end workflow from idea to implemented PR(s). Plans via the multi-model planning pipeline, then implements — directly for 1 option, or with parallel agent-teams for N options. Handles WTP slots, Graphite branches, and a dedicated validator teammate with dev server. Triggers on requests like "plan and implement", "give me options and build them", "build this feature end to end", or when the user has an idea they want taken through planning to shipped PR(s).
---

# Mozart: Plan and Implement

End-to-end workflow: idea → planning → implementation → validation → PR(s).

Supports two modes:

- **N=1** (common): Lead plans and implements in the current worktree
- **N>1** (comparison): Lead plans, spawns parallel implementers in WTP slots, and a validator teammate with the dev server

## Phase 1: Plan

Use the existing multi-model planning workflow from AGENTS.md. This phase is identical regardless of N.

### Step 1.0: Question

```
subagent({ agent: "plan-questioner", task: "<raw problem statement>" })
```

Go back and forth with the user until the questioner produces a final refined problem statement. **Do not proceed until ambiguities are resolved.**

### Step 1.1: Diverge

Run both planners in parallel:

```
subagent({ tasks: [
  { agent: "planner-opus", task: "<refined problem statement>" },
  { agent: "planner-design", task: "<refined problem statement>" }
]})
```

Choose the planner pair per AGENTS.md:

- **New features/refactors**: `planner-opus` (minimal) + `planner-design` (clean-design)
- **Bugs/regressions**: `planner-local` (targeted) + `planner-systemic` (root-cause)

### Step 1.2: Judge

**This is the branch point.** The judge prompt changes depending on what the user asked for.

#### N=1 mode (default — "plan this", "build this", "implement this")

Use the standard judge prompt. The judge synthesizes one recommended plan:

```
subagent({ agent: "plan-judge", task: "## Original problem\n<problem>\n\n## Proposal A\n<A>\n\n## Proposal B\n<B>" })
```

#### N>1 mode ("give me options", "build multiple options", "implement A/B/C for comparison")

Use the judge with a **divergent specs** addendum appended to the task. The judge still evaluates both proposals, but instead of converging on one plan, it outputs N distinct implementable option specs:

```
subagent({ agent: "plan-judge", task: "## Original problem\n<problem>\n\n## Proposal A\n<A>\n\n## Proposal B\n<B>\n\n## Special instruction\nDo NOT converge on a single recommendation. Instead, produce N implementable option specs — one for each distinct approach worth building. Each spec must include:\n1. **Option label** (e.g., Option A, Option B)\n2. **One-line summary**\n3. **Approach** — what to build and why this variant is worth comparing\n4. **Files to change** — exact paths and what changes in each\n5. **Test requirements** — what tests to add/modify\n6. **Validation criteria** — how to verify this option works\n7. **PR title and description summary**\n\nYou may produce 2-4 specs. Drop any approach that the evidence shows is clearly inferior. Keep approaches that represent genuinely different tradeoffs worth a product/design decision." })
```

### Step 1.3: Present and confirm

Show the user the plan(s). Ask:

- **N=1**: "Ready to implement? I'll work in the current worktree."
- **N>1**: "Ready to implement N options in parallel? I'll claim WTP slots and spawn teammates."

Wait for user confirmation before proceeding.

---

## Phase 2: Implement (N=1)

When there's one plan, the lead implements directly. No teams, no extra WTP slots.

### Step 2.1: Ensure worktree

If not already in a Mozart WTP slot, claim one per [../\_shared/wtp-checkout.md](../_shared/wtp-checkout.md).

### Step 2.2: Create branch

```bash
gt create -m "<commit message from plan>" -a
```

### Step 2.3: Implement

Follow the plan. Edit files, write tests. Standard development flow.

### Step 2.4: Local validation

Run in sequence — all from the current worktree:

```bash
pnpm test run <test files from plan>
dev lint
dev typecheck javascript
```

### Step 2.5: Self-review

Load the `review` skill and review the uncommitted changes. Fix any CRITICAL or HIGH findings, re-run tests/lint, and re-stage.

### Step 2.6: FE validation (if UI changes)

Ensure dev server is running, then execute Playwright validation per [../mozart-fe-validation/SKILL.md](../mozart-fe-validation/SKILL.md).

### Step 2.7: Submit

```bash
gt modify -a -m "<final commit message>"
gt submit --no-edit --no-interactive
```

Update PR description with validation results.

---

## Phase 3: Implement (N>1) — Parallel with Agent Teams

### Step 3.0: Pre-flight

Verify preconditions before spawning anything:

```bash
# Verify WTP is available and has enough free slots
WTP_BIN="$HOME/src/github.com/shopify-playground/wtp/bin/_wtp"
$WTP_BIN status
```

Need **N+1 slots**: N for implementers + 1 for the validator (which also runs the dev server). If insufficient, tell the user to `wtp grow <count>`.

Verify we're in the Mozart area:

```bash
pwd  # must be under .../areas/platforms/mozart
```

### Step 3.1: Create base branch (if needed)

If the options stack on a base PR that doesn't exist yet, create it first:

```bash
gt create -m "<base commit message>" -a
gt submit --no-edit --no-interactive --draft
```

Record the base branch name for use in step 3.2.

### Step 3.2: Pre-create all sibling branches

**The lead creates ALL branches sequentially** to avoid Graphite stack races. Do this BEFORE spawning any teammates.

For each option (e.g., Option A, Option B, Option C):

```bash
# Switch to base branch
gt checkout <base-branch>

# Create the option branch as a child of base
gt create -m "<Option X: one-line summary>" -a --no-interactive

# Record the branch name
# e.g., MM-DD-option-a-short-description
```

After creating all branches, restack once:

```bash
gt restack
```

Then return to the base branch:

```bash
gt checkout <base-branch>
```

### Step 3.3: Claim WTP slots

Claim N+1 WTP slots. Do this sequentially from the lead to avoid contention:

```bash
WTP_BIN="$HOME/src/github.com/shopify-playground/wtp/bin/_wtp"

# For each implementer (1..N):
SLOT_N_DIR="$($WTP_BIN "<option-N-branch>")"

# For the validator:
VALIDATOR_DIR="$($WTP_BIN "validator-tmp")"
```

Record each slot path. Sync each implementer slot to its option branch:

```bash
cd "$SLOT_DIR"
git checkout "<option-branch>"
```

The validator slot stays on `main` initially — it will switch branches on demand.

**Important**: All WTP slots share the same `.git` directory (they're git worktrees). Local commits made in one slot's branch are visible to other slots via `git checkout`. No `git push` or `origin/` references needed for cross-slot branch access.

### Step 3.4: Spawn implementer teammates

For each option, spawn a teammate with a precise, self-contained task prompt:

```
team_spawn({
  name: "impl-option-a",
  task: `You are implementing Option A for the Mozart ad set dropdown.

## Your worktree
Path: <SLOT_A_DIR>/src/areas/platforms/mozart
Branch: <option-a-branch> (already checked out)

## What to implement
<paste the full option spec from the judge output>

## What to do
1. cd to your worktree path above
2. Run: /opt/dev/bin/dev up -P -S (ensure runtime dependencies are ready)
3. Implement the changes described in the spec
4. Run local validation:
   - pnpm test run <test files>
   - pnpm exec eslint <changed files> --quiet
   - (typecheck if touching types: dev typecheck javascript)
5. Stage your changes: git add -A
6. Run a self-review on your changes — load the review skill and review your uncommitted changes.
   This dispatches specialized reviewers (correctness, testing, design, etc.) in parallel
   and consolidates findings through a judge. Fix any CRITICAL or HIGH issues found,
   re-run tests/lint, and re-stage.
7. DO NOT run gt modify, gt submit, or any Graphite commands — the lead handles all git operations
8. DO NOT start a dev server — the validator handles that
9. When done, send a summary to @team_lead with:
   - Files changed
   - Tests added/modified
   - Test results (pass/fail + count)
   - Lint results
   - Review results: list any findings (with severity) that were fixed, and any
     MEDIUM/LOW findings you chose not to address (with rationale)
   - Any issues or deviations from the spec`,
  model: "claude-sonnet-4-6"  // Implementation is mechanical given a detailed spec
})
```

### Step 3.5: Spawn validator teammate

Spawn one validator that owns the dev server:

```
team_spawn({
  name: "validator",
  task: `You are the validation agent for a parallel Mozart implementation.

## Your worktree
Path: <VALIDATOR_DIR>/src/areas/platforms/mozart
Branch: starts on main (you'll switch branches as needed)

## Setup (do this first, before any validation requests)
1. cd to your worktree path
2. Run: /opt/dev/bin/dev up -P -S (ensure runtime dependencies are ready)
3. Message @team_lead that you're ready for validation requests

## Your role
You own the dev server. When an implementer finishes, the lead will message you with:
- The branch name to validate
- The Playwright validation script path (or instructions to write one)
- Validation criteria

## For each validation request:
1. Stop any running dev server: kill any background dev server process
2. Switch to the target branch:
   git checkout <branch>
   (No need for fetch/reset — implementer commits are local and visible across worktrees via shared .git)
3. Start a fresh dev server:
   /opt/dev/bin/dev server (run as background job via bg_run)
   Wait for it to be ready (curl -sk https://mozart.shop.dev/ returns 200/302)
4. Run the Playwright validation:
   shadowenv exec -- npx playwright install chromium  (first time only)
   shadowenv exec -- BASE_URL=https://mozart.shop.dev npx tsx <script-path>
5. Collect artifacts from tmp/validation-artifacts/
6. Report results to @team_lead:
   - Pass/fail
   - Artifact paths
   - Any errors or unexpected behavior

## Important
- Only ONE dev server can run at a time
- Always stop the old server before starting a new one
- Wait for the server to be fully ready before running validation
- If validation fails, report the failure — do not attempt to fix the code`,
  model: "claude-sonnet-4-6"
})
```

### Step 3.6: Monitor and coordinate

The lead monitors progress via `team_status` and incoming messages.

**When an implementer finishes** (sends completion summary):

1. Verify the implementer's summary looks correct (tests passed, lint clean, self-review completed with no unresolved CRITICAL/HIGH findings)
2. From the lead's session, commit the implementer's staged changes. Run from the **implementer's worktree** (the branch is checked out there):

```bash
cd <SLOT_N_DIR>/src/areas/platforms/mozart
# The implementer already ran `git add -A` — verify:
git status
gt modify -a -m "<Option N: descriptive commit message>"
```

Note: `gt modify` works from any worktree that has the branch checked out. The commit is stored in the shared `.git` and visible to all worktrees.

3. If the option needs FE validation, message the validator:

```
team_message({
  to: "validator",
  content: "Please validate Option N.\nBranch: <option-N-branch>\nValidation script: <path or instructions>\nCriteria: <what to check>"
})
```

4. If no FE validation needed, proceed directly to step 3.7 for this option.

**When the validator finishes** a validation run:

1. Record the results (pass/fail, artifacts)
2. If failed: message the implementer with the failure details for a fix cycle, then re-validate
3. If passed: proceed to step 3.7 for this option

### Step 3.7: Submit PRs

After all options are implemented and validated, submit ALL PRs sequentially from the lead. Use any worktree that has access to the branches (they share `.git`):

```bash
# From the lead's worktree or any implementer slot
# First, restack to ensure all branches are up to date with base
gt restack

# Then submit each option branch individually
for each option branch:
  gt checkout <option-branch>
  gt submit --no-edit --no-interactive
```

Update each PR description with:

- Option framing (Option A/B/C label and summary)
- Validation results and artifact references
- Comparison context linking sibling PRs
- Cross-links to the other option PRs for easy comparison

### Step 3.8: Cleanup

```bash
# Shut down all teammates
team_cleanup

# Release WTP slots
for each slot:
  cd <SLOT_DIR>
  _wtp free <slot>
```

Stop any running dev server.

---

## Decision: N=1 or N>1?

Use these signals to decide:

**N=1** (default):

- User says "plan this", "build this", "implement this"
- Judge converges on a clear winner with no meaningful tradeoff
- The problem has one obvious solution

**N>1** (explicit or inferred):

- User says "give me options", "build multiple approaches", "I want to compare"
- The planner proposals represent genuinely different UX/product tradeoffs (not just different code paths to the same outcome)
- The judge identifies that the choice depends on product/design input, not engineering judgment

When in doubt, **ask the user** after presenting the judge output: "The judge recommends X, but Proposal B offers a meaningfully different tradeoff. Want me to build both for comparison, or just go with the recommendation?"

---

## Error handling

### Implementer teammate fails or hangs

1. Check `team_status` — is the pane alive?
2. If dead: `team_force_shutdown`, re-claim the WTP slot, re-spawn with the same task
3. If alive but stuck: `team_message` to check status, then `team_request_shutdown` if unresponsive

### Validator teammate can't start server

1. Check `dev ps` output — is another server already running somewhere?
2. Kill competing servers: `pkill -f "dev server"` or `pkill -f puma`
3. Re-try server start

### Insufficient WTP slots

Tell the user: "Need N+1 WTP slots but only M are free. Run `wtp grow <count>` to add more."

### Graphite restack conflicts

If `gt restack` fails with conflicts:

1. Resolve conflicts in the affected branch
2. `git add -A && gt restack --continue`
3. If the conflict is between sibling options (they modify the same file in the base), this is expected — resolve per-branch

### One option's tests fail

Don't block other options. Report the failure, let the implementer fix it, re-validate. Submit all options that pass; note the failing one in its PR description.
