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

### Nit — approve, but ask for it before merge

- Style preferences that don't affect correctness
- Minor naming improvements
- Small code organization suggestions
- Missing docs that aren't on critical paths

These are worth fixing in this PR.

**Never write "non-blocking" (or "optional", "take it or leave it", "nice to have") in a posted review.** Approving already signals you aren't holding the PR — restating it in prose just tells the author it's safe to skip. Say **"please consider the nits below before merging"** in the top-level, and give each inline nit one sentence on why it matters:

| ❌ Pre-excused | ✅ Reason to act |
|---|---|
| "Non-blocking — dev-only seeds." | "A comment that states the opposite of the code will mislead the next person to touch this seeder." |
| "Optional / take it or leave it." | "The `titleAccess` difference is the easy one to lose in a future edit." |
| "Nice to have, no need to change." | "The drift is invisible until someone extends the test." |

For a genuine judgment call, state the tradeoff and ask a direct question: *"Is the current wording clear enough at the call site? If so, this can stay."* No first-person preference (`I'd like`, `I won't push`), no pre-concession. The question keeps the author's agency; the framing doesn't tell them to ignore you.

Blocking vs. not is still a real internal distinction — it decides `APPROVE` vs `REQUEST_CHANGES`. It just doesn't belong in the comment text.

### Drop / don't raise — these are noise

- **Premature optimization**: Don't flag performance on secondary views, small datasets (< 1K rows), or low-traffic paths. "The CSVs are short (max 200-300 lines) so processing time is minimal."
- **Scaling concerns for current scope**: If the data is small and bounded, don't speculate about future scale.
- **useMemo/useCallback suggestions**: Check platform conventions first — many codebases explicitly avoid these unless profiling shows a bottleneck.
- **N+1 queries that are pre-existing**: If the PR didn't introduce the N+1, don't block on it. Fix it in this PR if the code is already being touched.
- **Style-only changes in refactor PRs**: The PR is restructuring code, not polishing style.
- **Test coverage nits on non-critical paths**: Trust CI thresholds.
- **"Consider extracting" on PRs that are already extractions**: The author is mid-refactor. More extraction is follow-up work.

## Review Comment Formatting

### Structure

- **Top-level comment**: open with the blocker count and the blockers themselves, then one line per remaining finding pointing at its `file:line`. NO full finding details here — they go inline. No account of how the review was produced: agent counts, finding arithmetic, and what the judge rejected are for the chat report, not the author. See the author-facing filter in the `review` skill's Step 7a.
- **Inline comments**: Self-contained full findings (problem → impact → suggested fix). Each must stand alone — the reader may see it without the top-level context.
- **Never duplicate content between top-level and inline.** They're visible together on the review page.
- **Voice**: AGENTS.md Response Discipline governs the comment body. Named constructions to avoid are in `skills/review/references/reviewer-persona.md` under Finding Voice.

### Line-level comment API

Line-level comments require the Reviews API, not `gh pr review --comment` (or `gs pr review`, which has no inline flag). On a Meteorite PR, swap `gh api` → `gs api` — identical payload. Resolve the system first per `skills/_shared/pr-system.md`.

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
gs pr review <N> --comment --body "..."
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

## No Deferrals

A finding is either fixed in this PR or dropped. Do not post "defer to a follow-up issue," and do not ask the author to agree that something was deferred — they never saw the finding. If it is worth the author's attention, it is worth fixing here; if it is not, it never reaches the comment.

## Calibrating AI-generated Reviews

When the review skill produces findings, expect to calibrate:

1. **Read the full finding list** before posting anything
2. **Drop findings** that fall in the "don't raise" category above
3. **Downgrade** findings from REQUEST_CHANGES to nit if the impact is cosmetic or follow-up quality
4. **Merge** findings that describe the same root issue in different locations
5. **Verify claims** — the review skill sometimes flags things that are actually correct. Check the code before posting.

### Present findings as a list, not a pipeline narrative

Sam sees only the lead's message and no subagent output. The lead therefore does not compose that message — it prints the judge's `RESULT_SET` block verbatim (review skill Step 6). Counts, reviewer names, severity movement, and filtered findings are physically absent from that block; they live in `~/.pi/tmp/review-<N>-audit.md`, which exists for tuning this file and is not read by default.

### Verify the linchpin claim yourself

If one finding would change the verdict (a CRITICAL, a claimed build break), spend the 30 seconds to check it directly before routing the whole review around it. On #977400 a CRITICAL "generated file not regenerated" collapsed to a false positive with two commands — the file was gitignored and `typecheck` runs `codegen` first.

## Responding to Bot-generated Reviews

When review comments are from a bot (Binks, automated tools) but posted by a human:

- Draft responses as you would to a human reviewer — professional tone
- The bot findings still need validity assessment (the `binks-review` skill handles this)
- React with 👍/👎 on each finding based on validity — **this is bot-only**; never react to a human reviewer's comments (reply in prose and resolve instead — see `pr-review-posting.md`)
- Fix valid findings, explain invalid ones politely

## Source

- "Non-blocking" language ban, and the findings-list-not-narrative reporting shape: Sam, 2026-08-06, during the PR #977400 review (shop/world). He rejected a draft that pre-excused every nit, including one documenting a comment that stated the opposite of its code.
- Rejections and reclassification arithmetic dropped from chat output, deferrals removed as a postable concept, and the output shape moved into `review-judge.md` as two delimited blocks: Sam, 2026-09-03. Five prior prose guards at the lead layer — `100235e0e`'s zero-context rule, `8afc645f0`'s author-facing filter, this file's lines 53 and 112, and `reviewer-persona.md`'s deferral flag — all failed to hold.
