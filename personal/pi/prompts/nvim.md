---
description: Open neovim in a tmux vertical split at the right working directory
---
Open a tmux vertical split with neovim for browsing or editing code.

**Directory resolution** — use the first match:
1. If `$1` is provided, use it (can be a file path — nvim opens directly to it)
2. Look at conversation context — subagent cwds, recently edited files, implementation working directories. Use the git root of that directory.
3. Fall back to current working directory

If `$1` is a file path, open nvim directly to that file. Otherwise, open nvim at the directory root.

**Then open** (single bash call):
```
# For a directory:
tmux split-window -h -c <dir> \; send-keys 'nvim' Enter

# For a file:
tmux split-window -h -c <dir> \; send-keys 'nvim <file>' Enter
```

Ideal: 1 tool call total.
