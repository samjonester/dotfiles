---
description: Open lazygit in a cmux vertical split for reviewing changes
---
Open a cmux vertical split with nvim+lazygit for reviewing uncommitted changes.

**Directory resolution** — use the first match:
1. If `$1` is provided, use it
2. Look at conversation context — subagent cwds, recent `git status` outputs, implementation working directories. You already know where files were written. Use the git root of that directory.
3. Fall back to current working directory

**Then open** (single bash call). cmux `new-split` has no `--command`/`--cwd`, so capture the
new surface ref from its output (`OK surface:N workspace:M`) and send the command to it
(`\n` = Enter). The split inherits the parent pane's cwd, so `cd` to the target first:
```
ref=$(cmux new-split right --focus true | grep -oE 'surface:[0-9]+' | head -1); cmux send --surface "$ref" 'cd <dir> && nvim -c "lua Snacks.lazygit()"\n'
```

Ideal: 1 tool call total.
