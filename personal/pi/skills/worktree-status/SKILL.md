---
name: worktree-status
description: Show status of all pi worktrees including branch info and Graphite stack state. Use when the user wants an overview of active work.
---

# Worktree Status

Display the status of all active worktrees.

## Steps

1. List all worktrees:
   ```bash
   git -C "$HOME/src/shopify" worktree list
   ```
2. For each worktree under `.pi/worktrees/`:
   - Show the worktree path and branch
   - Show `git status --short` for uncommitted changes
   - Show `gt stack --oneline` if it's a Graphite stack
3. Summarize:
   - Total active worktrees
   - Any with uncommitted changes
   - Suggest `git worktree remove` for stale ones
