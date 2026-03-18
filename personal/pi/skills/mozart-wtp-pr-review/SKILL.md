---
name: mozart-wtp-pr-review
description: Start Mozart PR review in an isolated WTP worktree by PR number or branch name. Use when the user asks to review an existing PR in a separate worktree slot.
---

# Mozart WTP: Begin PR Review (by PR number or branch)

Use this skill to open a PR in a WTP slot for isolated review.

## Inputs

- One of:
  - PR number (e.g. `512345`)
  - branch name (e.g. `author/feature-branch`)

## 1) Resolve branch (if PR number given)

When given a PR number, resolve head branch from world repo:

```bash
PR_NUMBER=<pr-number>
BRANCH=$(gh pr view "$PR_NUMBER" --repo shop/world --json headRefName --jq .headRefName)
[ -n "$BRANCH" ] || { echo "Could not resolve PR branch"; exit 1; }
echo "$BRANCH"
```

If branch is given directly, use it as `BRANCH`.

## 2) Claim slot and prepare runtime

Set `BRANCH` to the resolved branch name, then follow the WTP checkout flow in [../\_shared/wtp-checkout.md](../_shared/wtp-checkout.md) (prerequisites → claim → sync → prepare runtime).

All subsequent commands run from `$TARGET_DIR`.

Start app if requested:

```bash
/opt/dev/bin/dev server
```

## 5) Optional: resolve PR details from branch

If input was branch and you want PR metadata:

```bash
gh pr list --repo shop/world --head "$BRANCH" --json number,title,url --limit 1
```

## 6) Report back

Always return:

- input (`PR #` or branch)
- resolved branch
- claimed WTP path
- synced commit SHA (`git rev-parse --short HEAD`)
- service readiness
- whether server started

## 5) End of review

Free slot when done:

```bash
wtp free
```

Or cleanup merged branches:

```bash
wtp gc
```
