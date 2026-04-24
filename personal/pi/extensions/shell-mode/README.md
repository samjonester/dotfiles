# Shell Mode Extension

Adds modes to user `!` commands for interactive, fullscreen, and background execution.

Pi's built-in `!` command runs everything the same way — non-interactively with captured output. This extension intercepts `!` commands and routes them based on what they need: inline interactive terminal access, fullscreen TUI takeover, or background execution.

## Modes

| Prefix | Mode | Description |
|--------|------|-------------|
| `!<cmd>` | auto | Auto-detects based on command (see lists below) |
| `!i <cmd>` | interactive | Runs inline with `stdio: "inherit"` — for commands that need stdin |
| `!f <cmd>` | fullscreen | Suspends TUI, clears screen, runs command, restores TUI |
| `!fi <cmd>` | fullscreen | Same as `!f` |
| `!<cmd> &` | background | Trailing `&` — natural shell syntax for backgrounding |
| `!& <cmd>` | background | Prefix form — starts as a background job |
| `!bg <cmd>` | background | Same as `!&` |

### How modes work

**Interactive** — The command gets direct terminal access (`stdio: "inherit"`) and runs inline within the TUI. Good for commands that prompt for input, show menus, or need a TTY but don't take over the whole screen.

**Fullscreen** — The TUI suspends, the screen clears, and the command gets full terminal control. When it exits, the TUI restores. Good for editors, pagers, and TUI apps that use the alternate screen buffer.

**Background** — The command is handed off to the [background-jobs](../background-jobs/) extension's `bg_run` machinery. Output goes to temp files. Use `bg_log`, `bg_stop`, etc. to manage it. If background-jobs isn't enabled, `!&` and `!bg` show an error.

## Auto-detection

Commands are auto-classified by matching against built-in lists. Fullscreen is checked first, then interactive. Unrecognized commands pass through to normal pi bash handling.

### Interactive commands (inline)

Git prompts: `git rebase -i`, `git add -p`, `git add -i`, `git stash -p`, `git reset -p`, `git checkout -p`, `git difftool`, `git mergetool`

Graphite: `gt create`, `gt submit`, `gt modify`, `gt sync`, `gt checkout`, `gt config`, `gt auth`, `gt demo`, `gt init`

GitHub CLI: `gh pr create`, `gh pr checkout`, `gh pr view`, `gh issue create`, `gh issue view`, `gh auth login`, `gh auth refresh`, `gh auth switch`, `gh codespace ssh`, `gh codespace create`, `gh copilot`, `gh repo fork`

Remote: `ssh`, `telnet`, `mosh`

Databases: `psql`, `mysql`, `sqlite3`, `mongosh`, `redis-cli`

Containers: `kubectl exec -it`, `docker exec -it`, `docker run -it`

Shopify: `dev init`, `pi config`

### Fullscreen commands

Editors: `vim`, `nvim`, `vi`, `nano`, `emacs`, `pico`, `micro`, `helix`, `hx`, `kak`

Pagers: `less`, `more`, `most`

Monitors: `htop`, `top`, `btop`, `glances`

File managers: `ranger`, `nnn`, `lf`, `mc`, `vifm`

Git TUIs: `tig`, `lazygit`, `gitui`

Finders: `fzf`, `sk`

Multiplexers: `tmux`, `screen`, `zellij`

Other: `kubectl edit`, `ncdu`, `devx rig up`

## Configuration

### Environment variables

| Variable | Description |
|----------|-------------|
| `INTERACTIVE_COMMANDS` | Additional interactive commands (comma-separated) |
| `INTERACTIVE_EXCLUDE` | Commands to remove from interactive list (comma-separated) |
| `FULLSCREEN_COMMANDS` | Additional fullscreen commands (comma-separated) |
| `FULLSCREEN_EXCLUDE` | Commands to remove from fullscreen list (comma-separated) |
| `BACKGROUND_COMMANDS` | Commands to auto-background (comma-separated) |
| `BACKGROUND_EXCLUDE` | Commands to remove from background list (comma-separated) |

Example:

```bash
export INTERACTIVE_COMMANDS="my-tool,another-tool"
export FULLSCREEN_EXCLUDE="nano"  # run nano inline instead of fullscreen
```

## Pipe support

Commands after the last `|` are also matched. `cat file | less` is detected as fullscreen because `less` is in the fullscreen list.

## Output capture

Interactive and fullscreen commands run in a **pseudo-terminal** (PTY) via the OS `script` command. This means:

- The command sees a real TTY (`isatty()` returns true, colors work, prompts work)
- Output is displayed live to the terminal as usual
- Output is **also captured** and returned to the LLM (ANSI codes stripped)

This is a zero-dependency approach — no native addons required. If `script` is unavailable (e.g. CI), it falls back to regular `spawnSync` with `stdio: "inherit"` (output displayed but not captured).

Captured output is truncated to 10KB to protect the context window.

## Compatibility with `!!`

Pi's built-in `!!` (silent bash) is unaffected — it bypasses the `user_bash` event. `!!i`, `!!f`, etc. should work as expected (the `!!` strips one `!`, then the event fires with the rest).

## Background mode requirements

`!&` and `!bg` require the [background-jobs](../background-jobs/) extension to be enabled. If it isn't loaded, shell-mode shows a clear error message.
