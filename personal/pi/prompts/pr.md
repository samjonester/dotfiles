---
description: Open a PR in an isolated worktree for review — new tmux window, WTP checkout, dev up
---
Set up an isolated environment for reviewing a PR. This is the full "open a PR" workflow in one command.

**Input**: `$1` — a PR number (e.g. `524035`), a PR URL (e.g. `https://github.com/shop/world/pull/524035`), or a branch name (e.g. `author/feature`).

**Steps** (execute all sequentially):

### 1. Resolve the branch
- If input is a URL, extract the PR number from it
- If input is a PR number: `gh pr view <number> --repo shop/world --json headRefName --jq .headRefName`
- If input is already a branch name, use it directly
- Also grab PR title: `gh pr view <number> --repo shop/world --json title --jq .title`

### 2. Claim a WTP worktree slot
```bash
WTP_BIN="$HOME/src/github.com/shopify-playground/wtp/bin/_wtp"
TARGET_DIR="$($WTP_BIN "$BRANCH")"
cd "$TARGET_DIR"
```

### 3. Sync to latest
```bash
git fetch origin "$BRANCH"
if [ -z "$(git status --porcelain)" ]; then
  git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH" "origin/$BRANCH"
  git reset --hard "origin/$BRANCH"
fi
```

### 4. Open a new tmux window with Pi
Name the tmux window after the PR (e.g., `PR-524035` or truncated title).
```bash
tmux new-window -n "PR-<number>" -c "$TARGET_DIR" \; send-keys 'TMPDIR=$HOME/.pi/tmp devx pi' Enter
```

### 5. Run dev up in the background
In the new Pi session's first message, run:
```bash
/opt/dev/bin/dev up -P -S
```
This prepares the runtime (installs deps, starts services).

### 6. Report back (in the original pane)
Print a summary:
- PR number and title
- Branch name
- WTP slot and path
- "dev up running in new window — switch to it with `C-Space <n>` or `C-Space s`"

Ideal: ~5 tool calls total (resolve → claim → sync → open window → report).
