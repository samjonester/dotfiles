---
description: Open neovim in a cmux vertical split at the right working directory
---
Open a cmux vertical split with neovim for browsing or editing code.

**Directory resolution** — use the first match:
1. If `$1` is provided, use it (can be a file path — nvim opens directly to it)
2. Look at conversation context — subagent cwds, recently edited files, implementation working directories. Use the git root of that directory.
3. Fall back to current working directory

If `$1` is a file path, open nvim directly to that file. Otherwise, open nvim at the directory root.

**Then open** (single bash call). cmux `new-split` has no `--command`/`--cwd`, so capture the
new surface ref from its output (`OK surface:N workspace:M`) and send the command to it
(`\n` = Enter). The split inherits the parent pane's cwd, so `cd` to the target first:
```
# For a directory:
ref=$(cmux new-split right --focus true | grep -oE 'surface:[0-9]+' | head -1); cmux send --surface "$ref" 'cd <dir> && nvim\n'

# For a file:
ref=$(cmux new-split right --focus true | grep -oE 'surface:[0-9]+' | head -1); cmux send --surface "$ref" 'cd <dir> && nvim <file>\n'
```

Ideal: 1 tool call total.
