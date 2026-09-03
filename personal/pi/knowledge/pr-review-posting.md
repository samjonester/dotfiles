# PR Review Posting — API Reference

## The Core Problem

`gh pr review --comment --body "..."` posts a **top-level comment**, NOT inline/line-level comments. This is the single most common mistake. Line-level comments require the Reviews API.

`gs pr review` has the same problem and no inline flag at all — its only options are `--approve`, `--request-changes`, `--comment`, and a body.

## Which CLI

Resolve which system the PR is in first — see `skills/_shared/pr-system.md`. `gs api` is a mechanical `gh api` replacement (same paths, same REST shape, `{owner}`/`{repo}` filled in from the resolved World repo), but Meteorite uses a **different review-write shape**: the single-shot `comments: [...]` array below is the GitHub path. Meteorite takes three calls.

### Meteorite: pending review → anchored comments → event

Verified on PR #2011335, 2026-09-01. `commit_id` must be the PR's current `headSha` or the anchor breaks.

```bash
pr=2011335
head_sha=$(gs pr view "$pr" --json | jq -er '.headSha')
review_id=$(gs api "repos/{owner}/{repo}/pulls/$pr/reviews" -f event=PENDING | jq -er '.id')

jq -n --rawfile body /tmp/nit.md --arg commit_id "$head_sha" --arg path 'areas/.../Foo.tsx' \
  '{body: $body, commit_id: $commit_id, path: $path, side: "RIGHT", line: 23}' |
  gs api "repos/{owner}/{repo}/pulls/$pr/reviews/$review_id/comments" -X POST --input -

gs api "repos/{owner}/{repo}/pulls/$pr/reviews/$review_id/events" \
  -f event=APPROVE -F body="$(< /tmp/approval.md)"
```

Three ids, easy to confuse: the **pending review id** (`/reviews` POST), the **root review-comment id**, and the **thread UUID** printed by `gs pr view N --comments`. Only the review id works in `/reviews/{id}/…`. Lost the create response? A retry returns 422 (one pending review per author) — recover with `gs api "repos/{owner}/{repo}/pulls/$pr/reviews" --paginate` and pick your own `state == "PENDING"`. Abandoning instead: `gs api "…/reviews/$review_id" -X DELETE`. Full reference: `//.agents/skills/gs/reference.md:199`.

## API Patterns

### Approval with inline nits

````bash
gh api repos/{owner}/{repo}/pulls/{number}/reviews --input - <<'EOF'
{
  "event": "APPROVE",
  "body": "LGTM with minor nits.\n\n1. Consider renaming X (nit)\n2. Missing null check on Y (nit)",
  "comments": [
    {
      "path": "src/services/foo.rb",
      "line": 42,
      "side": "RIGHT",
      "body": "**Nit**: `foo` could be more descriptive — maybe `fetch_active_records`?\n\nNon-blocking."
    },
    {
      "path": "src/controllers/bar.rb",
      "line": 15,
      "side": "RIGHT",
      "body": "**Nit**: Missing null check — `record` could be nil if the find fails.\n\n```ruby\nrecord = Foo.find_by(id: id)\nreturn head :not_found unless record\n```"
    }
  ]
}
EOF
````

### Request changes with inline findings

````bash
gh api repos/{owner}/{repo}/pulls/{number}/reviews --input - <<'EOF'
{
  "event": "REQUEST_CHANGES",
  "body": "Two issues to address before merge:\n\n1. Missing error handling on translate endpoint\n2. Historical label regression confirmed via manual validation",
  "comments": [
    {
      "path": "app/controllers/translate_controller.rb",
      "line": 28,
      "side": "RIGHT",
      "body": "**Issue**: 500 on invalid token instead of 401.\n\n**Impact**: Figma plugin shows generic error.\n\n**Fix**:\n```ruby\nrescue TokenService::InvalidToken => e\n  render json: { error: 'invalid_token' }, status: :unauthorized\n```"
    }
  ]
}
EOF
````

### Top-level comment only (no inline)

```bash
gh api repos/{owner}/{repo}/pulls/{number}/reviews --input - <<'EOF'
{
  "event": "COMMENT",
  "body": "Aligned with Connor's round-2 findings. Confirmed via manual validation on pool-2:\n\n- `withCurrentValue` fallback works end-to-end\n- `toTitleCase` handles edge cases correctly\n\nWill approve once Connor's threads are resolved."
}
EOF
```

## Field Reference

| Field             | Required | Values                                  |
| ----------------- | -------- | --------------------------------------- |
| `event`           | Yes      | `APPROVE`, `REQUEST_CHANGES`, `COMMENT` |
| `body`            | Yes      | Top-level review summary (markdown)     |
| `comments`        | No       | Array of inline comments                |
| `comments[].path` | Yes      | File path relative to repo root         |
| `comments[].line` | Yes      | Line number in the diff (RIGHT side)    |
| `comments[].side` | Yes      | `RIGHT` (new code) or `LEFT` (old code) |
| `comments[].body` | Yes      | Inline comment body (markdown)          |

## Content Rules

1. **Top-level body**: Executive summary + numbered finding list (one line each) for orientation. Include validation results if you ran manual testing.
2. **Inline body**: Self-contained — problem, impact, suggested fix. Reader may see it without top-level context.
3. **No duplication**: Don't repeat the full finding in both top-level and inline. Top-level has the one-liner, inline has the detail.
4. **Validation evidence**: Screenshots, curl output, or test results go in the top-level body, not inline (inline comments can't easily embed images).

## Reactions & Thread Resolution

On a Meteorite PR these are first-class `gs` verbs rather than raw API calls:

```bash
gs pr view <N> --comments                       # thread UUIDs + comment ids
gs pr comment <N> --reply-to <id> --body-file f  # in-thread reply
gs pr react <N> <comment-id> --thumbs-up        # or --thumbs-down
gs pr resolve <N> <thread-uuid>                  # UUID, not a PRRT_ node id
```

**👍/👎 emoji reactions are for bot reviews only (Binks, automated tools) — never on a human reviewer's comments.** Reactions are a validity signal calibrated for the `binks-review` flow. On a human's review:

- **Reply** in-thread with professional prose — one reply per point (done / declined-with-rationale).
- **Resolve** threads you addressed with a code/doc change; leave judgment-call or open-question threads for the reviewer to close.
- **Never** add an emoji reaction to a human's comment — it reads as flippant on considered feedback.

## Multi-line Diff Comments

For comments spanning multiple lines, add `start_line`:

```json
{
  "path": "src/foo.ts",
  "line": 50,
  "start_line": 45,
  "side": "RIGHT",
  "body": "This entire block should be extracted into a helper."
}
```

## Common Mistakes

| Mistake                                     | Result                      | Fix                                |
| ------------------------------------------- | --------------------------- | ---------------------------------- |
| `gh pr review --comment --body "..."`       | Posts top-level, not inline | Use `gh api` with Reviews API      |
| `gs pr review <N> --comment`                | Posts top-level; no inline flag exists | Use the `gs api` pending-review flow |
| `gs pr comment <N>` for a new inline comment | Only `--reply-to` an existing thread; no path/line flag | Use the `gs api` pending-review flow |
| Single-shot `comments: [...]` array on Meteorite | Unverified — GitHub shape | Use the three-call pending-review flow |
| `gh api` on a Meteorite PR (or `gs api` on a GitHub PR) | 404 Not Found | Resolve the system first — separate number namespaces |
| Missing `"side": "RIGHT"`                   | API error                   | Always include side                |
| Using absolute line numbers                 | Comment on wrong line       | Use diff-relative line numbers     |
| `"event": "APPROVE"` with blocking findings | Contradictory signal        | Use `REQUEST_CHANGES` or `COMMENT` |
| Asking the author to confirm a deferral | They never saw the finding | Fix it in this PR or drop it — see `review-calibration.md` → No Deferrals |
| 👍/👎 reaction on a human reviewer's comment | Reads as flippant; reactions are Binks-only | Reply in prose; resolve the thread if addressed |
