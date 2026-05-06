---
name: pi-install
description: "Install or uninstall pi extensions, skills, agents, and prompts. Routes between tactical (/pkg, this machine only) and reproducible (manifest + dotfiles, all machines) workflows. Triggers on: 'install <name>', 'uninstall <name>', 'add extension', 'remove skill', '/pkg add', '/pkg rm', 'install for all my machines', 'try this extension', or any request to manage pi resources."
---

# Pi Install Manager

Manage installation and removal of pi resources (extensions, skills, agents, prompts) across the three layers of Sam's pi setup.

## Step 1: Classify the request

Ask if not stated. Match user intent to **one** of three layers:

| Signal | Layer | Where it lives |
|---|---|---|
| "let me try X", "for this session", "tactical", "machine-local" | **Tactical** | `/pkg add` symlinks into `~/.pi/agent/<kind>/` only |
| "for all my machines", "permanently", "commit it", "reproducible" | **Reproducible** | `~/dotfiles/personal/pi/shop-pi-fy.installs` manifest, materialized by `setup_pi` |
| The resource is something Sam authored or forked | **Dotfiles auto-discovery** | `~/dotfiles/personal/pi/<kind>/<name>/` — pi finds it via dotfiles `package.json` glob |

If unclear, default to **Reproducible** for things Sam will actively use, **Tactical** for one-off experiments.

## Step 2: Run the matching workflow

### Tactical (one machine, until next `setup_pi`)

```
/pkg list                    # confirm name and current state
/pkg add <name>              # install
/pkg rm <name>               # uninstall
```

This is symlink-only. Re-running `setup_pi` later will wipe a `/pkg add` if it's not in the manifest. Use this freely for short-lived experiments.

### Reproducible (versioned, all machines)

**Install:**

1. Open `~/dotfiles/personal/pi/shop-pi-fy.installs`.
2. Find the right category section (extensions / skills / agents / prompts). Add a line: `<kind>: <name>` where kind is `ext|skill|agent|prompt`.
3. Show Sam the diff. **Pause for explicit approval per AGENTS.md "New branch work requires explicit approval before commit"** — even though dotfiles uses raw git on main, treat this as a real change.
4. After approval: `cd ~/dotfiles && git add personal/pi/shop-pi-fy.installs && git commit -m "pi: add <name>"`
5. Highlight the commit hash; then `~/dotfiles/personal/install.sh` to materialize the new symlink.
6. Verify: `ls -la ~/.pi/agent/<kind>/<name>` should show a symlink into the shop-pi-fy package dir.

**Uninstall:**

1. Open `~/dotfiles/personal/pi/shop-pi-fy.installs`. Delete the line (or comment it with `#`).
2. Show Sam the diff. Pause for approval.
3. `cd ~/dotfiles && git commit -am "pi: remove <name>"`
4. **Critical:** `setup_pi` is purely additive — it doesn't prune. Run `/pkg rm <name>` from inside pi to delete the live symlink.
5. Verify: `ls -la ~/.pi/agent/<kind>/<name>` should error (no such file).

### Dotfiles auto-discovery (Sam's own extensions/skills)

If the resource lives at `~/dotfiles/personal/pi/extensions/<name>/` (or `skills/`, etc.):

- **Already installed** by virtue of being in the dotfiles `package.json` `pi.<kind>` glob. No symlink work needed, no `/pkg`.
- **To "uninstall":** `rm -rf ~/dotfiles/personal/pi/<kind>/<name>` and commit the deletion. Or move the directory aside if you're just disabling temporarily.
- **Never `/pkg add`** the same name from shop-pi-fy on top — double-loaded extensions fire event handlers twice. If shop-pi-fy ships a same-named upstream, add it to the install.sh skip list (see `~/dotfiles/personal/pi/README.md` forks table).

## Step 3: Verify the change took effect

After install/uninstall, confirm with **at least one** of:

- `/pkg list` — current state of all installed shop-pi-fy resources
- `ls -la ~/.pi/agent/<kind>/<name>` — direct symlink check
- `/auto-reload` — picks up changes without restart for most extensions
- For new extensions that register tools: check `which <tool_name>` after reload
- For new skills: confirm it appears in the skill list shown at session start

If a freshly-added extension doesn't show its tools after `/auto-reload`, restart pi (`exit` then `pi`).

## Edge cases

- **Fork conflict (🛑):** If `<name>` exists in BOTH dotfiles and shop-pi-fy (e.g. `memory`, `retitle`, `notify`, `bash-guard`, `subagent`, `shell-mode`, `context-viz`, `file-preview`), the dotfiles version wins. Do NOT add it to the manifest. The install.sh skip list filters it.
- **Already installed:** `/pkg add` is idempotent for symlinks but will error if the target already exists from a different source. Run `/pkg rm <name>` first to clean state.
- **Custom not-shop-pi-fy extension from a URL:** Use `pi install <git-url>` (built-in pi command). Adds to a different namespace; not covered by this skill.
- **Resource doesn't exist:** `/pkg list` should be your first check. If `<name>` isn't there, ask Sam if it's an upstream pi-mono extension, an npm package, or something to author from scratch.

## Quick reference

```bash
# inspect
/pkg list                                    # what shop-pi-fy resources are available + state
ls -la ~/.pi/agent/extensions/               # current symlinks

# tactical (this machine, this session)
/pkg add <name>
/pkg rm <name>

# reproducible (versioned, all machines) — REQUIRES APPROVAL BEFORE COMMIT
$EDITOR ~/dotfiles/personal/pi/shop-pi-fy.installs
cd ~/dotfiles && git add personal/pi/shop-pi-fy.installs
git commit -m "pi: <add|remove> <name>"
~/dotfiles/personal/install.sh               # materialize new symlinks
/pkg rm <name>                               # only if removing — setup_pi won't prune
```
