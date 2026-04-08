---
description: Open a shell in a tmux vertical split at the right working directory
---
Open a tmux vertical split with a shell for ad-hoc commands.

**Directory resolution** — use the first match:
1. If `$1` is provided, use it
2. Look at conversation context — subagent cwds, recent tool calls, implementation working directories. Use the git root if appropriate.
3. Fall back to current working directory

**Then open** (single bash call):
```
tmux split-window -h -c <dir>
```

Ideal: 1 tool call total.
