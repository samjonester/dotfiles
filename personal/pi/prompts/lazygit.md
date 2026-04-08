---
description: Open lazygit in a tmux vertical split for reviewing changes
---
Open a tmux vertical split with nvim+lazygit for reviewing uncommitted changes.

**Directory resolution** — use the first match:
1. If `$1` is provided, use it
2. Look at conversation context — subagent cwds, recent `git status` outputs, implementation working directories. You already know where files were written. Use the git root of that directory.
3. Fall back to current working directory

**Then open** (single bash call):
```
tmux split-window -h -c <dir> \; send-keys 'nvim -c "lua Snacks.lazygit()"' Enter
```

Ideal: 1 tool call total.
