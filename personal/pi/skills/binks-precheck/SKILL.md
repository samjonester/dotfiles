---
name: binks-precheck
description: "Run Binks code review locally before pushing, then auto-address findings. Runs `devx binks-pr-review` against the current diff, parses JSON output, assesses each finding, fixes valid issues, and optionally re-runs to verify. Triggers on: 'binks precheck', 'run binks locally', 'pre-push binks', 'local binks review', or when user wants to catch Binks findings before CI."
---

# Binks Pre-Push Review

Run the Binks code review engine locally against the current diff, then systematically address findings before pushing. This catches issues that would otherwise surface as bot comments in CI — shifting the review feedback loop left.

## When to use

- Before `gt submit` on a new branch — catch findings before CI
- After fixing Binks bot comments — verify fixes don't introduce new findings
- Before marking a PR ready for review — clean up the diff proactively

## Prerequisites

- `devx binks-pr-review` must be installed (`tec tools fetch --activate`)
- Must be in a git repo with a diff against the base branch
- Shopify AI Proxy must be reachable (standard dev environment)

## Inputs

- **Title** (optional) — PR title for context. Auto-detected from Graphite/git if omitted.
- **Description** (optional) — PR description for context. Reduces false positives significantly.
- **Output directory** (optional) — defaults to temp dir. Use `--output-dir` to persist results.

## Workflow

### Step 1: Gather context

Before running binks, collect the PR title and description to reduce false positives:

```bash
# Try Graphite first (preferred in world repo)
TITLE=$(gt branch info --json 2>/dev/null | jq -r '.title // empty')
DESCRIPTION=$(gt branch info --json 2>/dev/null | jq -r '.description // empty')

# Fallback to gh if Graphite doesn't have it
if [ -z "$TITLE" ]; then
  TITLE=$(gh pr view --json title -q '.title' 2>/dev/null)
  DESCRIPTION=$(gh pr view --json body -q '.body' 2>/dev/null)
fi
```

If neither source has a title, ask the user for a one-line summary of the changes. The `--title` and `--description` flags are critical for reducing false positives — Binks uses them to understand intent.

### Step 2: Run local Binks review

```bash
OUTPUT_DIR=$(mktemp -d /tmp/binks-precheck-XXXXXX)

devx binks-pr-review \
  --title "$TITLE" \
  --description "$DESCRIPTION" \
  --output-dir "$OUTPUT_DIR" \
  --force
```

This runs the full Binks LangGraph pipeline locally: diff extraction → multi-agent review → critic filtering → output. Takes 30–90 seconds depending on diff size.

**If the command fails**, check:
- AI proxy connectivity: `curl -s https://proxy.shopify.io/health`
- Tool installation: `which binks-pr-review`
- If not installed: `tec tools fetch --activate && dev setup`

### Step 3: Parse results

Read the JSON output file:

```bash
RESULT_FILE="$OUTPUT_DIR/output/code_review_result.json"
```

Parse the `comments` array. Each comment has:
- `severity`: `critical` | `medium` | `minor`
- `type`: `bug` | `security` | `performance` | `style` | etc.
- `title`: Short heading
- `description`: Full explanation with evidence
- `suggestion`: Suggested fix (may include code)
- `file_path`: File from repo root
- `line_start` / `line_end`: Line range
- `uuid`: Unique ID for dedup
- `agent_ids`: Which agents found this (indicates confidence when multiple agents agree)

Also check `metadata.critics` for the critic filter pass rate — high filter rates suggest the diff context was ambiguous.

### Step 4: Triage findings

Present a summary table to the user:

```
| # | Severity | Type | File | Lines | Title | Agents |
|---|----------|------|------|-------|-------|--------|
| 1 | 🔴 critical | bug | app/models/foo.rb | 42-58 | Race condition in... | 2 |
| 2 | 🟡 medium | perf | app/graphql/types/bar.rb | 45 | N+1 query in... | 1 |
| 3 | 🟢 minor | style | app/services/baz.rb | 12 | Unused variable | 1 |
```

For each finding, assess:

1. **Validity**: Read the file and relevant context. Is the claim correct?
2. **Importance**: Real bug vs. stylistic nitpick vs. overstated severity.
3. **Multi-agent confidence**: Findings detected by multiple agents (`agent_ids` length > 1) have higher signal.
4. **Recommendation**: Fix, skip, or note for later.

**Always present the triage assessment to the user before making changes.** Wait for approval on which findings to address.

### Step 5: Fix approved findings

For each finding the user approves:

1. Read the file and surrounding context
2. Implement the fix (follow the suggestion if it's good, or apply your own judgment)
3. If the finding involves a testable behavior, add or update tests
4. Run relevant checks:
   ```bash
   # Type check (if TypeScript/Ruby)
   dev typecheck 2>/dev/null
   # Run specific test file if one exists for the changed file
   dev test <test_file> 2>/dev/null
   ```

Do NOT commit yet — batch all fixes first.

### Step 6: Verify (optional re-run)

After fixing all approved findings, optionally re-run Binks to verify:

```bash
VERIFY_DIR=$(mktemp -d /tmp/binks-verify-XXXXXX)

devx binks-pr-review \
  --title "$TITLE" \
  --description "$DESCRIPTION" \
  --output-dir "$VERIFY_DIR" \
  --force
```

Compare results:
- New findings introduced by fixes? Address them.
- Original findings gone? Good.
- Same findings persist? The fix didn't work or Binks disagrees — flag for user.

Only re-run if the user requests it or if the original findings were complex (critical severity, multi-agent consensus). Skip for minor/style findings.

### Step 7: Summary

Produce a final summary:

```
## Binks Pre-Check Results

**Run**: <timestamp> | **Duration**: <seconds>s | **Model**: <model>
**Diff**: <N files changed> against <base branch>

### Findings: <total> found, <fixed> fixed, <skipped> skipped

| # | Severity | Title | Verdict | Action |
|---|----------|-------|---------|--------|
| 1 | 🔴 critical | Race condition in... | ✅ Valid | Fixed — added transaction block |
| 2 | 🟡 medium | N+1 query in... | ✅ Valid | Fixed — added .includes() |
| 3 | 🟢 minor | Unused variable | ❌ False positive | Skipped — variable used in template |

### Verification
<re-run results if performed, or "Skipped">
```

### Step 8: Commit (if changes were made)

If fixes were applied, stage and commit:

```bash
git add -A
gt modify --no-edit
```

Do NOT auto-submit or auto-push. The user decides when to `gt submit` and `devx ci run`. This skill is about catching issues early, not automating the push workflow.

## Cleanup

Remove temp directories after the summary is presented:

```bash
rm -rf "$OUTPUT_DIR" "$VERIFY_DIR" 2>/dev/null
```

## Relationship to binks-review skill

This skill is **proactive** (run before push) while `binks-review` is **reactive** (respond to bot comments after push). They complement each other:

1. Run `binks-precheck` before pushing → catches most findings locally
2. If Binks bot still leaves comments after CI (e.g., from production pipeline differences), use `binks-review` to respond with calibration feedback

The proactive skill does NOT reply to GitHub threads or post reactions — there are no threads yet. It operates entirely on local JSON output.
