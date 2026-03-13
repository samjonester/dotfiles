---
name: worktree-status
description: Show status of all git worktrees across the world repo and agent worktree directories. Use when the user wants an overview of active work, branches, uncommitted changes, or stale worktrees to clean up.
---

# Worktree Status

Display a comprehensive status of all active worktrees.

## Data Sources

There are three places worktrees live:

1. **World repo** (bare repo at `~/world/git`) — primary development worktrees under `~/world/trees/`
2. **Cursor agent worktrees** — `~/.cursor/worktrees/`
3. **Claudex agent worktrees** — `~/.claudex/worktrees/`

## Steps

### 1. List all worktrees from the bare repo

```bash
git -C ~/world/git worktree list
```

### 2. For each worktree, collect status

For every worktree path returned above:

```bash
# Branch and commit info
git -C <path> log --oneline -1
git -C <path> branch --show-current

# Uncommitted changes
git -C <path> status --short

# Graphite stack state (if available)
cd <path> && gt stack --oneline 2>/dev/null
```

### 3. Check agent worktree directories

```bash
ls -d ~/.cursor/worktrees/*/ ~/.claudex/worktrees/*/ 2>/dev/null
```

For each that exists, run the same git status/branch commands.

### 4. Check for empty tree directories

```bash
# ~/world/trees/ may have empty placeholder directories from old worktrees
for d in ~/world/trees/*/; do
  name=$(basename "$d")
  if [ ! -f "$d/.git" ] && [ ! -d "$d/.git" ]; then
    # Check if truly empty or just sparse
    count=$(find "$d" -maxdepth 1 -not -name "." | wc -l)
    if [ "$count" -eq 0 ]; then
      echo "STALE: $name (empty directory)"
    fi
  fi
done
```

### 5. Present summary

Format as a table:

| Worktree | Branch | Dirty | Stack | Location |
|----------|--------|-------|-------|----------|

Then add:
- **Total active worktrees** count
- **Worktrees with uncommitted changes** — list them with file counts
- **Stale/empty directories** — suggest `rm -rf ~/world/trees/<name>` for cleanup
- **Agent worktrees** — note which agent tool owns them
