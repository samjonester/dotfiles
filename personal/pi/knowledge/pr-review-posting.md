# PR Review Posting — API Reference

## The Core Problem

`gh pr review --comment --body "..."` posts a **top-level comment**, NOT inline/line-level comments. This is the single most common mistake. Line-level comments require the Reviews API.

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
| Missing `"side": "RIGHT"`                   | API error                   | Always include side                |
| Using absolute line numbers                 | Comment on wrong line       | Use diff-relative line numbers     |
| `"event": "APPROVE"` with blocking findings | Contradictory signal        | Use `REQUEST_CHANGES` or `COMMENT` |
