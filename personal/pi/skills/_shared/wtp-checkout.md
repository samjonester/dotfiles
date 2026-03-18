# WTP Worktree Checkout

Canonical flow for claiming a WTP worktree slot and syncing a branch. Referenced by skills that need isolated worktrees.

## Prerequisites

```bash
WTP_BIN="$HOME/src/github.com/shopify-playground/wtp/bin/_wtp"
[ -x "$WTP_BIN" ] || { echo "wtp not installed — see https://github.com/shopify-playground/wtp"; exit 1; }
```

## Claim or resume slot

```bash
TARGET_DIR="$($WTP_BIN "$BRANCH")"
echo "$TARGET_DIR"
```

- If the branch already has a claimed slot, WTP resumes it.
- If not, WTP claims a free pool slot and checks out the branch.
- `_wtp` returns the worktree path on stdout.

## Sync to latest remote

```bash
cd "$TARGET_DIR"
git fetch origin "$BRANCH"
if [ -z "$(git status --porcelain)" ]; then
  git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH" "origin/$BRANCH"
  git reset --hard "origin/$BRANCH"
else
  echo "Working tree not clean; skipping hard reset"
fi
```

Confirm the sync:

```bash
git log --oneline -1
pwd  # confirm we're in the worktree, not the main tree
```

## Prepare runtime

Check services:

```bash
/opt/dev/bin/dev ps -n .
/opt/dev/bin/dev ps 2>&1 | grep shared || true
```

If not ready:

```bash
/opt/dev/bin/dev up -P -S
```

## Cleanup (after work is done)

Release slot:

```bash
wtp free
```

Garbage-collect merged branches:

```bash
wtp gc
```
