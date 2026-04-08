---
name: binks-review
description: "Address Binks automated code review comments on a PR. Fetches comments, assesses validity, fixes valid issues, replies with feedback, reacts with thumbs up/down, and resolves threads. Triggers on: 'address binks review', 'handle binks comments', 'binks reviewed PR #N', or when user asks to respond to binks-code-reviewer feedback."
---

# Binks Review Handler

Handles the full lifecycle of responding to binks-code-reviewer automated review comments on a PR.

## Inputs

- PR number (required) — e.g. `586245`
- Repo (optional, defaults to `shop/world`)

## Workflow

### 1. Identify unresolved Binks threads

**Always start by checking thread resolution status.** Fetch review threads via GraphQL to get resolution state and the root comment ID for each thread, then cross-reference with the REST comments to filter down to only unresolved Binks findings.

```bash
# Step 1a: Get thread resolution status and root comment IDs
gh api graphql -f query='
query {
  repository(owner: "{owner}", name: "{repo}") {
    pullRequest(number: {pr}) {
      reviewThreads(first: 50) {
        nodes {
          id
          isResolved
          comments(first: 1) {
            nodes {
              databaseId
              author { login }
            }
          }
        }
      }
    }
  }
}'
```

From this response, build a set of **unresolved Binks comment IDs** — threads where `isResolved == false` AND the root comment author is `binks-code-reviewer`.

```bash
# Step 1b: Fetch full comment bodies only for unresolved threads
gh api repos/{owner}/{repo}/pulls/{pr}/comments \
  --jq '.[] | select(.user.login == "binks-code-reviewer[bot]") | "ID: \(.id)\nPath: \(.path)\nLine: \(.line)\nBody:\n\(.body)\n---"'
```

**Filter**: Only process comments whose ID appears in the unresolved set from step 1a. Skip all resolved threads entirely — they've already been addressed (either in this session or a previous one).

If all Binks threads are already resolved, report that and stop.

### 2. Assess each unresolved finding

For each **unresolved** Binks comment, **do not assume it's correct**. Read the relevant code and verify:

1. **Validity**: Is the claim actually correct? Check the code paths mentioned.
2. **Importance**: Even if valid, does it matter? Distinguish real bugs from stylistic nitpicks or overstated severity.
3. **Recommendation**: Fix it, acknowledge but skip, or push back — with reasoning.

### 3. Fix valid issues

For findings assessed as valid and worth fixing:

1. Make the code change
2. Add tests covering the fixed behavior
3. Run `dev typecheck` to verify (if available in the worktree)
4. Stage, amend, submit:
   ```bash
   git add -A && gt modify --no-edit
   gt submit --no-edit --stack
   devx ci trigger
   ```

### 4. React on the original comment

React with 👍 or 👎 on each Binks comment based on your assessment:

```bash
# thumbs up (valid finding)
gh api repos/{owner}/{repo}/pulls/comments/{comment_id}/reactions -f content='+1'

# thumbs down (invalid or not worth fixing)
gh api repos/{owner}/{repo}/pulls/comments/{comment_id}/reactions -f content='-1'
```

### 5. Reply with feedback

Reply in-thread to each Binks comment. Structure the reply as:

1. **What you did**: describe the fix, or explain why no change is needed
2. **Feedback on the finding**: assess the quality of Binks' analysis — was the conclusion correct? Was the explanation precise or did it miss the real issue? Call out red herrings, imprecise reasoning, overstated severity, or cases where the finding was spot-on.

```bash
gh api repos/{owner}/{repo}/pulls/{pr}/comments \
  -f body="<reply text>" \
  -F in_reply_to={comment_id}
```

### 6. Resolve threads

After replying, resolve each thread you addressed:

```bash
gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "{thread_id}"}) { thread { isResolved } } }'
```

Use the thread IDs captured in step 1a — no need to re-fetch.

## Reply tone

Follow the AGENTS.md guidelines for responding to Binks reviews:

- Don't assume the finding is correct — assess first
- Be direct about whether the fix was warranted
- Give calibration feedback: was the analysis precise? Did it miss the real issue? Was severity overstated?
- Keep it concise — one paragraph for the fix, one for the feedback

## Example reply (valid finding, good analysis)

> Fixed — added a `rescue CSV::MalformedCSVError` at the method level. Malformed CSVs now produce an error row instead of a 500.
>
> Feedback on this finding: Spot on. The analysis correctly identified that this tool is for debugging broken batch uploads, making malformed CSVs a likely input. The error propagation reasoning was accurate and severity was appropriate.

## Example reply (valid finding, overstated severity)

> Fixed — non-dimensional sizes now report `exists` when content is found, instead of falling through to the aspect ratio check.
>
> Feedback on this finding: The core observation is correct — composite sizes were misreported as `incomplete`. However, the severity is overstated. This is a read-only admin debug tool, not part of the import pipeline. A false `incomplete` wouldn't cause re-imports — it would just mean manual verification of those rows.

## Example reply (invalid finding)

> No change needed — the code already handles this case via the `validate_row_inputs` guard on line 168.
>
> Feedback on this finding: The concern about unhandled nil is incorrect. The early return in `validate_row_inputs` ensures `platform` is non-nil before reaching the taxonomy parse step. The analysis missed the control flow from the extracted method.
