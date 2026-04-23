# Code Review Calibration

## Review Philosophy

- Reviews protect the codebase, not display expertise. Only flag things that matter.
- Every finding must justify its existence: what breaks, what degrades, what confuses the next person?
- If you can't articulate the concrete impact, don't raise it.

## Severity Guide

### REQUEST_CHANGES — must be fixed before merge

- Correctness bugs (wrong behavior, data loss, race conditions)
- Security issues (auth bypass, injection, SSRF, secret leakage)
- Contract violations (API breaking changes without migration, schema mismatches)
- Missing error handling on critical paths (user-facing failures, data corruption)

### Non-blocking nit — mention but don't block

- Style preferences that don't affect correctness
- Minor naming improvements
- Small code organization suggestions
- Missing docs that aren't on critical paths

### Drop / don't raise — these are noise

- **Premature optimization**: Don't flag performance on secondary views, small datasets (< 1K rows), or low-traffic paths. "The CSVs are short (max 200-300 lines) so processing time is minimal."
- **Scaling concerns for current scope**: If the data is small and bounded, don't speculate about future scale.
- **useMemo/useCallback suggestions**: Check platform conventions first — many codebases explicitly avoid these unless profiling shows a bottleneck.
- **N+1 queries that are pre-existing**: If the PR didn't introduce the N+1, don't block on it. File an issue instead.
- **Style-only changes in refactor PRs**: The PR is restructuring code, not polishing style.
- **Test coverage nits on non-critical paths**: Trust CI thresholds.
- **"Consider extracting" on PRs that are already extractions**: The author is mid-refactor. More extraction is follow-up work.

## Review Comment Formatting

### Structure

- **Top-level comment**: Executive summary, validation results, numbered one-line finding list for orientation. NO full finding details here — they go inline.
- **Inline comments**: Self-contained full findings (problem → impact → suggested fix). Each must stand alone — the reader may see it without the top-level context.
- **Never duplicate content between top-level and inline.** They're visible together on the review page.

### Line-level comment API

Line-level comments require the Reviews API, not `gh pr review --comment`:

```bash
# CORRECT — posts inline comments
gh api repos/{owner}/{repo}/pulls/{number}/reviews --input - <<'EOF'
{
  "event": "COMMENT",
  "body": "## Review Summary\n\n1. Finding one (nit)\n2. Finding two (nit)",
  "comments": [
    {
      "path": "path/to/file.ts",
      "line": 42,
      "side": "RIGHT",
      "body": "**Nit**: description of the issue.\n\n**Impact**: ...\n\n**Suggestion**: ..."
    }
  ]
}
EOF

# WRONG — posts top-level only, NOT inline
gh pr review --comment --body "..."
```

For approval with inline comments, use `"event": "APPROVE"`. For request changes, use `"event": "REQUEST_CHANGES"`.

### Combined payload

Top-level + inline in one API call:

```json
{
  "event": "REQUEST_CHANGES",
  "body": "## Summary\n\n1. Critical: missing error handling on X\n\n**Validation**: confirmed via local testing.",
  "comments": [{ "path": "...", "line": 15, "side": "RIGHT", "body": "..." }]
}
```

## Calibrating AI-generated Reviews

When the review skill produces findings, expect to calibrate:

1. **Read the full finding list** before posting anything
2. **Drop findings** that fall in the "don't raise" category above
3. **Downgrade** findings from REQUEST_CHANGES to nit if the impact is cosmetic or follow-up quality
4. **Merge** findings that describe the same root issue in different locations
5. **Verify claims** — the review skill sometimes flags things that are actually correct. Check the code before posting.

## Responding to Bot-generated Reviews

When review comments are from a bot (Binks, automated tools) but posted by a human:

- Draft responses as you would to a human reviewer — professional tone
- The bot findings still need validity assessment (the `binks-review` skill handles this)
- React with 👍/👎 on each finding based on validity
- Fix valid findings, explain invalid ones politely
