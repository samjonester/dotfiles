---
description: Open a shell in a cmux vertical split at the right working directory
argument-hint: "[directory]"
---
Open a cmux vertical split with a shell for ad-hoc commands.

**Directory resolution** — use the first match:
1. If `$1` is provided, use it
2. Look at conversation context — subagent cwds, recent tool calls, implementation working directories. Use the git root if appropriate.
3. Fall back to current working directory

**Then open** (single bash call). cmux `new-split` has no `--command`/`--cwd`, so capture the
new surface ref from its output (`OK surface:N workspace:M`) and send the command to it
(`\n` = Enter). The split inherits the parent pane's cwd, so `cd` to the target first:
```
ref=$(cmux new-split right --focus true | grep -oE 'surface:[0-9]+' | head -1); cmux send --surface "$ref" 'cd <dir>\n'
```

Ideal: 1 tool call total.
