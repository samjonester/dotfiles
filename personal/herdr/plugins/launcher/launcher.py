#!/usr/bin/env python3
"""One fzf modal over herdr's shortcuts, its live session, and files on disk.

Five tabs share a single fzf process. Switching tabs, toggling hidden files,
and opening the cheat sheet all re-enter this script through fzf's `transform`
action, which lets a child process print fzf actions on stdout. The state those
children mutate lives in a JSON file named by $LAUNCHER_STATE, because each one
is a fresh process.

herdr has no API to fire a built-in keybinding, so the Actions tab is split:
bindings the CLI can reach run in place, and UI-mode ones -- help, settings,
copy mode, resize mode, goto, navigate, the indexed 1..9 jumps -- are listed
dimmed, with Enter inert, so the modal stays a complete reference without
pretending it can run them.

Subcommands. Only `open` and `pick` are entrypoints; fzf calls the rest.
  open                    open the popup, from the keybinding action
  pick                    the modal itself, inside the popup
  feed <tab>              candidate lines for a tab
  switch <tab|next|prev>  fzf actions that make a tab current
  click <col>             header click, mapped to a tab by column
  enter <tab> <payload>   accept, drill into a space, or ignore a dead row
  back                    leave a space's tab list, or close the modal
  new                     create a space or a tab at the current level
  after-new               close if something was created, refresh if not
  toggle-hidden           include or drop dotfiles and ignored files
  toggle-help             swap the preview between content and the cheat sheet
  preview <tab> <payload> preview body for one row
  root                    nested root picker for the Files tab
"""

import base64
import json
import os
import re
import shlex
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import traceback

HERDR = os.environ.get("HERDR_BIN_PATH") or shutil.which("herdr") or "herdr"
PLUGIN_ID = "sam.launcher"
SOCKET_TIMEOUT = 10
SELF = os.path.abspath(__file__)
HOME = os.path.expanduser("~")
# $VISUAL before $EDITOR: $EDITOR is conventionally the line editor git and
# crontab get, and is often nano even when the full-screen editor is not.
EDITOR = (os.environ.get("LAUNCHER_EDITOR") or os.environ.get("VISUAL")
          or os.environ.get("EDITOR") or "nvim")

SCROLLBACK_LINES = 5000
FOCUS_TRAIL = 8

RESET = "\x1b[0m"
DIM = "\x1b[38;5;245m"
FAINT = "\x1b[38;5;240m"
GRN = "\x1b[38;5;108m"
YEL = "\x1b[38;5;214m"
BLU = "\x1b[38;5;109m"
RED = "\x1b[38;5;167m"
INV = "\x1b[7m"
BOLD = "\x1b[1m"

TABS = ("actions", "agents", "spaces", "files")
TAB_LABEL = {"actions": "Actions", "agents": "Agents", "spaces": "Spaces",
             "files": "Files"}
STATUS_ICON = {"working": (YEL, "●"), "blocked": (RED, "◆"), "idle": (GRN, "○"),
               "done": (BLU, "✓"), "unknown": (FAINT, "·")}


class Fail(Exception):
    pass


# ---------------------------------------------------------------- herdr calls

def cli(*args):
    proc = subprocess.run([HERDR, *args], capture_output=True, text=True)
    if proc.returncode != 0:
        raise Fail(f"herdr {' '.join(args)}: {(proc.stderr or proc.stdout).strip()}")
    return json.loads(proc.stdout)["result"]


def api(method, params):
    """For the methods with no CLI verb, and for the reads whose CLI prints raw
    terminal output instead of JSON."""
    path = os.environ.get("HERDR_SOCKET_PATH")
    if not path:
        raise Fail("HERDR_SOCKET_PATH is unset — run this inside herdr")
    try:
        with socket.socket(socket.AF_UNIX) as sock:
            sock.settimeout(SOCKET_TIMEOUT)
            sock.connect(path)
            sock.sendall((json.dumps({"id": PLUGIN_ID, "method": method, "params": params}) + "\n").encode())
            buf = b""
            while not buf.endswith(b"\n"):
                chunk = sock.recv(65536)
                if not chunk:
                    raise Fail(f"{method}: socket closed early")
                buf += chunk
    except TimeoutError as err:
        raise Fail(f"{method}: no reply in {SOCKET_TIMEOUT}s") from err
    except OSError as err:
        raise Fail(f"{method}: {err}") from err
    reply = json.loads(buf.decode().strip())
    if "error" in reply:
        raise Fail(f"{method}: {reply['error'].get('message', reply['error'])}")
    return reply["result"]


def snapshot():
    return cli("api", "snapshot")["snapshot"]


def detach(argv):
    """Run a herdr command after this popup is gone.

    A popup is a singleton, so anything that opens another one is refused with
    ui_busy while we are still up. Double-forking past our session lets the
    child outlive the popup and retry until herdr is free.
    """
    if os.fork() != 0:
        return
    os.setsid()
    if os.fork() != 0:
        os._exit(0)
    null = os.open(os.devnull, os.O_RDWR)
    for fd in (0, 1, 2):
        os.dup2(null, fd)
    for _ in range(40):
        proc = subprocess.run([HERDR, *argv], capture_output=True, text=True)
        if proc.returncode == 0 and "ui_busy" not in proc.stdout + proc.stderr:
            break
        time.sleep(0.15)
    os._exit(0)


# --------------------------------------------------------------------- state

def state_path():
    path = os.environ.get("LAUNCHER_STATE")
    if not path:
        raise Fail("LAUNCHER_STATE is unset — this subcommand only runs under `pick`")
    return path


def load():
    with open(state_path()) as handle:
        return json.load(handle)


def save(state):
    with open(state_path(), "w") as handle:
        json.dump(state, handle)


def tilde(path):
    return "~" + path[len(HOME):] if path.startswith(HOME) else path


def preview_width():
    try:
        return max(20, int(os.environ.get("FZF_PREVIEW_COLUMNS", "80")))
    except ValueError:
        return 80


def preview_height():
    try:
        return max(8, int(os.environ.get("FZF_PREVIEW_LINES", "40")))
    except ValueError:
        return 40


ANSI = re.compile(r"\x1b\[[0-9;]*m")


def clip(text, width):
    return text if len(text) <= width else text[:width - 1] + "…"


def vclip(text, width):
    """Truncate on visible width. The colour codes in these rows take no
    columns but len() counts every byte of them."""
    if len(ANSI.sub("", text)) <= width:
        return text
    out, seen, index = [], 0, 0
    while index < len(text) and seen < width - 1:
        match = ANSI.match(text, index)
        if match:
            out.append(match.group())
            index = match.end()
            continue
        out.append(text[index])
        seen += 1
        index += 1
    return "".join(out) + "…" + RESET


def rule(title, width):
    head = f"── {title} "
    return f"{FAINT}{head}{'─' * max(0, width - len(head))}{RESET}"


# ------------------------------------------------------------------- keymap

# Group, title, description, runner. A runner of None means the binding is
# UI-mode only: herdr's API cannot reach it, so the row renders dimmed and
# Enter is inert.
BUILTINS = {
    "help": ("Session", "Keybinding help",
             "herdr's own modal — the fallback when this launcher is broken",
                        "goto:actions"),
    "settings": ("Session", "Settings", "herdr's settings UI",
                        "settings"),
    "detach": ("Session", "Detach",
               "leave the session running and drop back to the shell", None),
    "reload_config": ("Session", "Reload config.toml",
                      "re-read config.toml in the running server", "reload_config"),
    "open_notification_target": ("Session", "Open notification target",
                                 "jump to the pane that raised the last notification", None),
    "goto": ("Session", "Navigate mode",
             "move between workspaces and panes with hjkl until esc",
                        "goto:spaces"),
    "toggle_sidebar": ("Session", "Toggle sidebar",
                       "show or hide the workspace and agent rail", None),
    "workspace_picker": ("Workspace", "Workspace picker",
                         "herdr's built-in workspace list",
                        "goto:spaces"),
    "new_workspace": ("Workspace", "New workspace",
                      "create a workspace and focus it; prompts for a name", "new_workspace"),
    "rename_workspace": ("Workspace", "Rename workspace",
                         "relabel the focused workspace", "rename_workspace"),
    "close_workspace": ("Workspace", "Close workspace",
                        "close the focused workspace and every tab in it", "close_workspace"),
    "previous_workspace": ("Workspace", "Previous workspace",
                           "focus the workspace before this one", "prev_workspace"),
    "next_workspace": ("Workspace", "Next workspace",
                       "focus the workspace after this one", "next_workspace"),
    "switch_workspace": ("Workspace", "Switch to workspace 1..9",
                         "focus a workspace by its sidebar number",
                        "goto:spaces"),
    "new_worktree": ("Worktree", "New worktree",
                     "create a git worktree and open it as a workspace", "new_worktree"),
    "open_worktree": ("Worktree", "Open existing worktree",
                      "open a worktree that already exists on disk", "open_worktree"),
    "remove_worktree": ("Worktree", "Remove worktree",
                        "delete a worktree and its workspace — wtp slots use `wtp free`",
                        "remove_worktree"),
    "new_tab": ("Tab", "New tab",
                "create a tab in the focused workspace; prompts for a name", "new_tab"),
    "rename_tab": ("Tab", "Rename tab", "relabel the focused tab", "rename_tab"),
    "close_tab": ("Tab", "Close tab", "close the focused tab and its panes", "close_tab"),
    "previous_tab": ("Tab", "Previous tab", "focus the tab before this one", "prev_tab"),
    "next_tab": ("Tab", "Next tab", "focus the tab after this one", "next_tab"),
    "move_tab_previous": ("Tab", "Move tab toward front",
                          "reorder the focused tab within its workspace", "move_tab_prev"),
    "move_tab_next": ("Tab", "Move tab toward back",
                      "reorder the focused tab within its workspace", "move_tab_next"),
    "switch_tab": ("Tab", "Switch to tab 1..9", "focus a tab by its number",
                        "goto:tabs"),
    "split_vertical": ("Pane", "Split right", "split the focused pane side by side", "split_right"),
    "split_horizontal": ("Pane", "Split down",
                         "split the focused pane top and bottom", "split_down"),
    "close_pane": ("Pane", "Close pane", "close the focused pane", "close_pane"),
    "zoom": ("Pane", "Toggle zoom",
             "expand the focused pane to fill the tab, or restore it", "zoom"),
    "rename_pane": ("Pane", "Rename pane",
                    "set the label drawn on the pane border", "rename_pane"),
    "focus_pane_left": ("Pane", "Focus pane left", "move focus one pane left", "focus_left"),
    "focus_pane_down": ("Pane", "Focus pane down", "move focus one pane down", "focus_down"),
    "focus_pane_up": ("Pane", "Focus pane up", "move focus one pane up", "focus_up"),
    "focus_pane_right": ("Pane", "Focus pane right", "move focus one pane right", "focus_right"),
    "cycle_pane_next": ("Pane", "Cycle to next pane",
                        "focus the next pane in this tab", "cycle_next"),
    "cycle_pane_previous": ("Pane", "Cycle to previous pane",
                            "focus the previous pane in this tab", "cycle_prev"),
    "last_pane": ("Pane", "Last pane", "jump back to the previously focused pane",
                        "last_pane"),
    "resize_mode": ("Pane", "Resize mode", "hjkl resizes the focused pane until esc", None),
    "resize_pane_left": ("Pane", "Resize pane left",
                         "move the focused pane's edge one step left", "resize_left"),
    "resize_pane_down": ("Pane", "Resize pane down",
                         "move the focused pane's edge one step down", "resize_down"),
    "resize_pane_up": ("Pane", "Resize pane up",
                       "move the focused pane's edge one step up", "resize_up"),
    "resize_pane_right": ("Pane", "Resize pane right",
                          "move the focused pane's edge one step right", "resize_right"),
    "edit_scrollback": ("Pane", "Edit scrollback",
                        "open the focused pane's scrollback in $EDITOR",
                        "edit_scrollback"),
    "previous_agent": ("Agent", "Previous agent",
                       "focus the previous agent across all workspaces", "prev_agent"),
    "next_agent": ("Agent", "Next agent",
                   "focus the next agent across all workspaces", "next_agent"),
    "focus_agent": ("Agent", "Focus agent 1..9",
                    "focus an agent by its row in the sidebar",
                        "goto:agents"),
}

# `herdr --default-config` omits both of these, so they would otherwise be
# missing from a modal that claims to list everything. Their chords are herdr's
# fixed prefix-mode keys, not config values, which is also why neither runs.
FIXED = {
    "copy_mode": ("Pane", "Copy mode",
                  "scroll and select from the pane's scrollback", ["prefix+["]),
    "swap_pane": ("Pane", "Swap pane",
                  "trade places with the pane in that direction",
                  ["prefix+shift+h/j/k/l"]),
}

# Names the default-config scrape picks up that are not bindable actions:
# navigate-mode movement, the remote-only paste key, the [keys.indexed] table,
# and the prose fields of the commented `[[keys.command]]` example.
SKIP = {"prefix", "remote_image_paste", "navigate_workspace_up", "navigate_workspace_down",
        "navigate_pane_left", "navigate_pane_down", "navigate_pane_up", "navigate_pane_right",
        "type", "key", "command", "width", "height", "tabs", "workspaces", "agents"}

GROUP_ORDER = ["Session", "Workspace", "Worktree", "Tab", "Pane", "Agent", "Command", "Plugin"]


def default_keys():
    """Defaults come from the binary, so they track the installed version."""
    proc = subprocess.run([HERDR, "--default-config"], capture_output=True, text=True)
    keys, inside = {}, False
    for raw in proc.stdout.splitlines():
        line = raw.strip()
        body = line.lstrip("#").strip() if line.startswith("#") else line
        # Commented-out table headers still end the section: the [keys] block
        # closes with a commented `[[keys.command]]` example whose prose fields
        # would otherwise scrape as bindings.
        if body.startswith("["):
            inside = body.startswith("[keys]")
            continue
        if not inside or not line.startswith("#") or "=" not in body:
            continue
        name, _, value = body.partition("=")
        name, value = name.strip(), value.strip()
        if not name.replace("_", "").isalnum():
            continue
        if value.startswith('"'):
            end = value.find('"', 1)
            keys[name] = value[1:end] if end > 1 else ""
    return keys


def user_config():
    path = os.environ.get("HERDR_CONFIG_PATH") or os.path.join(HOME, ".config", "herdr", "config.toml")
    if not os.path.exists(path):
        return {}
    import tomllib
    with open(path, "rb") as handle:
        return tomllib.load(handle)


def chords(value):
    if isinstance(value, str):
        return [value] if value else []
    if isinstance(value, list):
        return [item for item in value if item]
    return []


def keymap():
    defaults = default_keys()
    conf = user_config()
    keys = conf.get("keys", {}) if isinstance(conf.get("keys"), dict) else {}

    # Union so a binding added by a future herdr still shows up, ungrouped and
    # display-only, rather than silently going missing from a modal that
    # claims to list everything.
    names = list(BUILTINS) + [n for n in defaults if n not in BUILTINS and n not in SKIP]
    rows = []
    for name in names:
        group, title, description, runner = BUILTINS.get(
            name, ("Session", name.replace("_", " "), "", None))
        bound = chords(keys[name]) if name in keys else chords(defaults.get(name, ""))
        rows.append({"k": "builtin", "n": name, "g": group, "t": title,
                     "d": description, "c": bound, "r": runner})
    for name, (group, title, description, bound) in FIXED.items():
        rows.append({"k": "builtin", "n": name, "g": group, "t": title,
                     "d": description, "c": bound, "r": None})

    # One command bound to both a prefix chord and a prefix-free twin is one
    # row with two chords, not two rows.
    commands = {}
    for entry in keys.get("command", []) or []:
        command = entry.get("command", "")
        kind = entry.get("type", "popup")
        row = commands.setdefault((kind, command), {
            "k": "cmd", "g": "Command", "t": entry.get("description") or command,
            "d": f"{kind}: {command}", "c": [], "kind": kind, "cmd": command})
        row["c"] += chords(entry.get("key"))
    rows += list(commands.values())

    try:
        actions = cli("plugin", "action", "list")["actions"]
    except Fail:
        actions = []
    bound_plugin = {row.get("cmd") for row in rows if row.get("kind") == "plugin_action"}
    for action in actions:
        qualified = f"{action['plugin_id']}.{action['action_id']}"
        if qualified in bound_plugin:
            continue
        rows.append({"k": "plugin", "id": qualified, "g": "Plugin",
                     "t": action.get("title") or qualified,
                     "d": f"plugin action: {qualified}", "c": []})

    return rows


def focus_trail_path():
    state_dir = os.environ.get("HERDR_PLUGIN_STATE_DIR")
    return os.path.join(state_dir, "focus-trail") if state_dir else None


def read_focus_trail():
    path = focus_trail_path()
    if not path or not os.path.exists(path):
        return []
    with open(path) as handle:
        return [line.strip() for line in handle if line.strip()]


def goto_target(row):
    """A row herdr answers with a modal this launcher already replaces. Enter
    moves to that tab instead of claiming to run something."""
    route = row.get("r")
    return route[5:] if isinstance(route, str) and route.startswith("goto:") else None


def runnable(row):
    return bool(row.get("r")) or row["k"] in ("cmd", "plugin")


# ------------------------------------------------------------------- runners

def focused(state):
    snap = snapshot()
    return {
        "pane": state.get("src_pane") or snap.get("focused_pane_id"),
        "tab": state.get("src_tab") or snap.get("focused_tab_id"),
        "workspace": state.get("src_workspace") or snap.get("focused_workspace_id"),
        "snap": snap,
    }


def ask(prompt, required=False):
    try:
        answer = input(prompt).strip()
    except (EOFError, KeyboardInterrupt):
        raise Fail("cancelled")
    if required and not answer:
        raise Fail("cancelled")
    return answer


def confirm(prompt):
    return ask(f"{prompt} [y/N] ").lower() in ("y", "yes")


def step(items, current, delta, key):
    if not items:
        raise Fail("nothing to cycle")
    ids = [item[key] for item in items]
    index = ids.index(current) if current in ids else 0
    return ids[(index + delta) % len(ids)]


def _tabs_of(ctx):
    return [t for t in ctx["snap"]["tabs"] if t["workspace_id"] == ctx["workspace"]]


def _panes_of(ctx):
    return [p for p in ctx["snap"]["panes"] if p["tab_id"] == ctx["tab"]]


RUNNERS = {
    "reload_config":    lambda c: (cli("server", "reload-config"), "config reloaded")[1],
    "new_workspace":    lambda c: _new_workspace(c),
    "rename_workspace": lambda c: _rename(c, "workspace", c["workspace"]),
    "close_workspace":  lambda c: _close(c, "workspace", c["workspace"]),
    "prev_workspace":   lambda c: _focus(c, "workspace", step(c["snap"]["workspaces"], c["workspace"], -1, "workspace_id")),
    "next_workspace":   lambda c: _focus(c, "workspace", step(c["snap"]["workspaces"], c["workspace"], 1, "workspace_id")),
    "new_worktree":     lambda c: _new_worktree(c),
    "open_worktree":    lambda c: _open_worktree(c),
    "new_tab":          lambda c: _new_tab(c),
    "rename_tab":       lambda c: _rename(c, "tab", c["tab"]),
    "close_tab":        lambda c: _close(c, "tab", c["tab"]),
    "prev_tab":         lambda c: _focus(c, "tab", step(_tabs_of(c), c["tab"], -1, "tab_id")),
    "next_tab":         lambda c: _focus(c, "tab", step(_tabs_of(c), c["tab"], 1, "tab_id")),
    "move_tab_prev":    lambda c: _move_tab(c, -1),
    "move_tab_next":    lambda c: _move_tab(c, 1),
    "split_right":      lambda c: _split(c, "right"),
    "split_down":       lambda c: _split(c, "down"),
    "close_pane":       lambda c: _close(c, "pane", c["pane"]),
    "zoom":             lambda c: (cli("pane", "zoom", c["pane"]), "zoom toggled")[1],
    "rename_pane":      lambda c: _rename(c, "pane", c["pane"]),
    "focus_left":       lambda c: _focus_dir(c, "left"),
    "focus_down":       lambda c: _focus_dir(c, "down"),
    "focus_up":         lambda c: _focus_dir(c, "up"),
    "focus_right":      lambda c: _focus_dir(c, "right"),
    "cycle_next":       lambda c: _focus(c, "pane", step(_panes_of(c), c["pane"], 1, "pane_id")),
    "cycle_prev":       lambda c: _focus(c, "pane", step(_panes_of(c), c["pane"], -1, "pane_id")),
    "resize_left":      lambda c: _resize(c, "left"),
    "resize_down":      lambda c: _resize(c, "down"),
    "resize_up":        lambda c: _resize(c, "up"),
    "resize_right":     lambda c: _resize(c, "right"),
    "prev_agent":       lambda c: _cycle_agent(c, -1),
    "next_agent":       lambda c: _cycle_agent(c, 1),
    "settings":         lambda c: _edit_config(c),
    "edit_scrollback":  lambda c: _edit_scrollback(c),
    "remove_worktree":  lambda c: _remove_worktree(c),
    "last_pane":        lambda c: _last_pane(c),
}


def _new_workspace(ctx):
    label = ask("Workspace name: ")
    args = ["workspace", "create", "--focus"] + (["--label", label] if label else [])
    return f"created workspace {cli(*args)['workspace']['workspace_id']}"


def _new_tab(ctx):
    label = ask("Tab name: ")
    args = ["tab", "create", "--workspace", ctx["workspace"], "--focus"] + (["--label", label] if label else [])
    return f"created tab {cli(*args)['tab']['tab_id']}"


def _new_worktree(ctx):
    branch = ask("Branch: ", required=True)
    base = ask("Base ref [default]: ")
    args = ["worktree", "create", "--branch", branch, "--focus"] + (["--base", base] if base else [])
    return f"created worktree for {branch} in {cli(*args)['workspace']['workspace_id']}"


def _open_worktree(ctx):
    trees = [t for t in cli("worktree", "list")["worktrees"] if not t.get("is_bare")]
    if not trees:
        raise Fail("no worktrees to open")
    chosen = pick_line([(t["path"], f"{t['label']}  {DIM}{tilde(t['path'])}{RESET}") for t in trees],
                       "open worktree> ")
    if not chosen:
        return "cancelled"
    return f"opened {tilde(chosen)} in {cli('worktree', 'open', '--path', chosen, '--focus')['workspace']['workspace_id']}"


def _open_in_split(ctx, path, cwd=None):
    pane = cli("pane", "split", ctx["pane"], "--direction", "right",
               "--cwd", cwd or os.path.dirname(path) or "/", "--focus")["pane"]
    wait_for_shell(pane["pane_id"])
    api("pane.send_input", {"pane_id": pane["pane_id"],
                            "text": f"{EDITOR} {shlex.quote(path)}", "keys": ["enter"]})
    api("pane.focus", {"pane_id": pane["pane_id"]})
    return pane["pane_id"]


def _edit_config(ctx):
    """herdr's settings UI is client-only. Editing the file it writes and
    reloading is the same outcome by a different door, so the row runs rather
    than sending you off to a chord."""
    path = os.environ.get("HERDR_CONFIG_PATH") or os.path.expanduser(
        "~/.config/herdr/config.toml")
    if not os.path.exists(path):
        raise Fail(f"no config at {tilde(path)}")
    _open_in_split(ctx, path, cwd=os.path.dirname(path))
    return f"editing {tilde(path)} — run `herdr server reload-config` to apply"


def _edit_scrollback(ctx):
    lines = api("pane.read", {"pane_id": ctx["pane"], "source": "recent_unwrapped",
                              "lines": SCROLLBACK_LINES})["read"]["text"]
    handle, path = tempfile.mkstemp(prefix="herdr-scrollback-", suffix=".log")
    with os.fdopen(handle, "w") as out:
        out.write(lines)
    _open_in_split(ctx, path, cwd=tempfile.gettempdir())
    return f"{len(lines.splitlines())} lines in {tilde(path)}"


def _remove_worktree(ctx):
    """Destructive and not undoable from here, so it asks twice: once for the
    tree, once for the deletion."""
    trees = [t for t in cli("worktree", "list")["worktrees"] if not t.get("is_bare")]
    if not trees:
        raise Fail("no worktrees to remove")
    chosen = pick_line([(t["path"], f"{t['label']}  {DIM}{tilde(t['path'])}{RESET}") for t in trees],
                       "remove worktree> ")
    if not chosen:
        return "cancelled"
    if not confirm(f"Remove {tilde(chosen)} and its workspace?"):
        return "cancelled"
    cli("worktree", "remove", "--path", chosen)
    return f"removed {tilde(chosen)}"


def _last_pane(ctx):
    """herdr tracks this in client state the API cannot read, so the plugin
    keeps its own trail from a pane.focused hook. Ids that no longer resolve
    are closed panes and this modal's own popup, which is gone by now."""
    live = {p["pane_id"] for p in ctx["snap"]["panes"]}
    trail = [pid for pid in read_focus_trail() if pid in live and pid != ctx["pane"]]
    if not trail:
        raise Fail("no previous pane recorded yet")
    return _focus(ctx, "pane", trail[-1])


def _rename(ctx, kind, target):
    name = ask(f"New {kind} name: ", required=True)
    cli(kind, "rename", target, name)
    return f"renamed {target} to {name}"


def _close(ctx, kind, target):
    if not confirm(f"Close {kind} {target}?"):
        return "cancelled"
    cli(kind, "close", target)
    return f"closed {target}"


def _focus(ctx, kind, target):
    # `herdr pane focus` is the directional verb and takes no id, so panes go
    # over the socket. Workspaces and tabs do take one.
    if kind == "pane":
        api("pane.focus", {"pane_id": target})
    else:
        cli(kind, "focus", target)
    return f"focused {target}"


def _focus_dir(ctx, direction):
    result = cli("pane", "focus", "--direction", direction, "--pane", ctx["pane"])
    return f"focused {result.get('focused_pane_id') or 'nothing'} to the {direction}"


def _resize(ctx, direction):
    cli("pane", "resize", "--direction", direction, "--pane", ctx["pane"])
    return f"resized {direction}"


def _split(ctx, direction):
    pane = cli("pane", "split", ctx["pane"], "--direction", direction)["pane"]
    return f"split {direction} into {pane['pane_id']}"


def _move_tab(ctx, delta):
    order = [t["tab_id"] for t in _tabs_of(ctx)]
    index = order.index(ctx["tab"]) if ctx["tab"] in order else 0
    target = max(0, min(len(order) - 1, index + delta))
    api("tab.move", {"tab_id": ctx["tab"], "insert_index": target})
    return f"moved tab to position {target + 1}"


def _cycle_agent(ctx, delta):
    agents = ctx["snap"]["agents"]
    if not agents:
        raise Fail("no agents running")
    ids = [a["pane_id"] for a in agents]
    index = ids.index(ctx["pane"]) if ctx["pane"] in ids else (0 if delta > 0 else -1)
    target = ids[(index + delta) % len(ids)]
    cli("agent", "focus", target)
    return f"focused agent in {target}"


# --------------------------------------------------------------------- feeds

def encode(payload):
    return base64.b64encode(json.dumps(payload).encode()).decode()


def decode(blob):
    return json.loads(base64.b64decode(blob).decode())


def agent_title(record):
    """pi reports the task in tokens; the terminal title wraps it in the agent
    glyph and the cwd, which the workspace column already shows."""
    tokens = record.get("tokens") or {}
    parts = [tokens.get(f"task{n}") for n in (1, 2, 3)]
    joined = " ".join(part for part in parts if part).strip()
    return joined or record.get("terminal_title_stripped") or record.get("terminal_title") or ""


def feed_actions(state):
    cache = os.path.join(os.path.dirname(state_path()), "actions.tsv")
    if os.path.exists(cache):
        sys.stdout.write(open(cache).read())
        return

    rows = keymap()
    rows.sort(key=lambda row: (GROUP_ORDER.index(row["g"]) if row["g"] in GROUP_ORDER else 99,
                               row["t"].lower()))
    width = max(len(row["t"]) for row in rows) + 2
    lines = []
    for row in rows:
        # Chords live in the preview only. A dimmed row is one nothing here can
        # perform, so the eye can skip it rather than read a marker.
        if runnable(row):
            body = f"{GRN}{row['g']:<9}{RESET} {row['t']:<{width}}{DIM}{row['d']}{RESET}"
        else:
            body = f"{FAINT}{row['g']:<9} {row['t']:<{width}}{row['d']}{RESET}"
        lines.append(f"actions\t{encode(row)}\t{body}\n")
    body = "".join(lines)
    with open(cache, "w") as handle:
        handle.write(body)
    sys.stdout.write(body)


def feed_agents(state):
    snap = snapshot()
    tabs = {t["tab_id"]: t["label"] for t in snap["tabs"]}
    spaces = {w["workspace_id"]: w["label"] for w in snap["workspaces"]}
    agents = snap["agents"]
    if not agents:
        return
    place = [f"{spaces.get(a['workspace_id'], a['workspace_id'])}/{tabs.get(a['tab_id'], a['tab_id'])}"
             for a in agents]
    width = max(len(p) for p in place) + 2
    for agent, where in zip(agents, place):
        colour, icon = STATUS_ICON.get(agent.get("agent_status"), STATUS_ICON["unknown"])
        payload = {"p": agent["pane_id"], "w": spaces.get(agent["workspace_id"], ""),
                   "tb": tabs.get(agent["tab_id"], ""), "t": agent_title(agent),
                   "s": agent.get("agent_status", "unknown"), "a": agent.get("agent"),
                   "n": agent.get("name"), "cwd": agent.get("cwd") or "",
                   "sess": (agent.get("agent_session") or {}).get("value") or ""}
        print(f"agents\t{encode(payload)}\t{colour}{icon}{RESET} {BLU}{where:<{width}}{RESET}"
              f"{payload['t']}  {FAINT}{agent['pane_id']}{RESET}")


def feed_spaces(state):
    """Two levels behind one tab: workspaces, then the tabs of the one picked."""
    if state.get("space"):
        return feed_space_tabs(state["space"])

    spaces = snapshot()["workspaces"]
    if not spaces:
        return
    width = max(len(w["label"]) for w in spaces) + 2
    for space in spaces:
        colour, icon = STATUS_ICON.get(space.get("agent_status"), STATUS_ICON["unknown"])
        here = f"{YEL}◂{RESET}" if space.get("focused") else " "
        payload = {"kind": "space", "id": space["workspace_id"], "label": space["label"]}
        counts = (f"{space['tab_count']} tab{'' if space['tab_count'] == 1 else 's'}"
                  f" · {space['pane_count']} pane{'' if space['pane_count'] == 1 else 's'}")
        print(f"spaces\t{encode(payload)}\t{colour}{icon}{RESET} {here} {space['label']:<{width}}"
              f"{DIM}{counts}{RESET}  {FAINT}{space['workspace_id']}{RESET}")


def feed_space_tabs(space_id):
    snap = snapshot()
    agents = {a["tab_id"]: a for a in snap["agents"]}
    tabs = [t for t in snap["tabs"] if t["workspace_id"] == space_id]
    if not tabs:
        return
    width = max(len(t["label"]) for t in tabs) + 2
    for tab in tabs:
        colour, icon = STATUS_ICON.get(tab.get("agent_status"), STATUS_ICON["unknown"])
        here = f"{YEL}◂{RESET}" if tab.get("focused") else " "
        agent = agents.get(tab["tab_id"])
        payload = {"kind": "tab", "id": tab["tab_id"], "ws": tab["workspace_id"],
                   "label": tab["label"]}
        note = agent_title(agent) if agent else f"{tab['pane_count']} pane{'' if tab['pane_count'] == 1 else 's'}"
        print(f"spaces\t{encode(payload)}\t{colour}{icon}{RESET} {here} {BLU}{tab['label']:<{width}}{RESET}"
              f"{DIM}{note}{RESET}  {FAINT}{tab['tab_id']}{RESET}")


def feed_files(state):
    root = state["root"]
    if not os.path.isdir(root):
        print(f"files\t\t{RED}not a directory: {tilde(root)}{RESET}")
        return
    if shutil.which("fd"):
        args = ["fd", "--type", "f", "--color", "never", "--strip-cwd-prefix", "--exclude", ".git"]
        if state.get("hidden"):
            args += ["--hidden", "--no-ignore"]
    else:
        args = ["find", ".", "-type", "f", "-not", "-path", "*/.git/*"]
    proc = subprocess.Popen(args, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    write = sys.stdout.write
    for line in proc.stdout:
        path = line.rstrip("\n")
        cut = path.rfind("/")
        shown = f"{DIM}{path[:cut + 1]}{RESET}{path[cut + 1:]}" if cut >= 0 else path
        write(f"files\t{path}\t{shown}\n")
    proc.wait()


FEEDS = {"actions": feed_actions, "agents": feed_agents, "spaces": feed_spaces,
         "files": feed_files}


# ---------------------------------------------------------------- fzf chrome

HINTS = {
    "actions": "enter runs · dimmed rows hand back the chord · ? keys",
    "agents": "enter focus · ctrl-y session id · ? keys",
    "spaces": "enter opens the space · ctrl-n new space · ? keys",
    "files": "enter opens in a split · ctrl-y path · ctrl-r root · ctrl-h hidden · ? keys",
}


def space_label(state):
    return (state.get("space_label") or state.get("space") or "") if state.get("space") else ""


def build_header(state, right=None):
    """One line, no parentheses: it is passed inside fzf's change-header()."""
    cells, ranges, column = [], {}, 1
    for index, tab in enumerate(TABS):
        if index:
            cells.append(f"{FAINT} │ {RESET}")
            column += 3
        text = f" {TAB_LABEL[tab]} "
        ranges[tab] = [column, column + len(text) - 1]
        cells.append((INV + BOLD if tab == state["tab"] else DIM) + text + RESET)
        column += len(text)
    state["ranges"] = ranges

    if right:
        return "".join(cells) + f"   {right}"

    right = HINTS[state["tab"]]
    if state["tab"] == "files":
        right = (f"root {tilde(state['root'])} {FAINT}·{RESET} "
                 f"hidden {'on' if state.get('hidden') else 'off'} {FAINT}·{RESET} {right}")
    elif state["tab"] == "spaces" and state.get("space"):
        right = (f"{BLU}{space_label(state)}{RESET}{DIM} {FAINT}·{RESET} enter focus "
                 f"{FAINT}·{RESET} ctrl-n new tab {FAINT}·{RESET} esc back {FAINT}·{RESET} ? keys")
    return "".join(cells) + f"   {DIM}{right}{RESET}"


def prompt_for(state):
    if state["tab"] == "spaces" and state.get("space"):
        return f"{space_label(state)}/tabs> "
    return f"{state['tab']}> "


def actions_for(state):
    """The fzf action string that makes the current tab and level live."""
    return (f"reload($LAUNCHER feed {state['tab']})"
            f"+change-prompt({prompt_for(state)})"
            f"+change-header({build_header(state)})"
            "+clear-query+first+refresh-preview")


# -------------------------------------------------------------------- preview

CHEATS = {
    "actions": [
        ("enter", "run it, jump to the tab that supersedes it, or hand back its chord"),
        ("preview", "shows the chord to press, and which of those three Enter does"),
    ],
    "agents": [
        ("enter", "focus that agent's pane"),
        ("ctrl-y", "copy the agent's session id"),
    ],
    "spaces": [
        ("enter", "open that workspace's tabs here, then focus the tab you pick"),
        ("esc", "back out to the workspace list"),
        ("ctrl-n", "new workspace, or a new tab once you are inside one"),
    ],
    "files": [
        ("enter", f"open in {EDITOR} in a new pane split off the active one"),
        ("ctrl-y", "copy the absolute path"),
        ("ctrl-r", "change the search root — claimed wtp slots, or type any path"),
        ("ctrl-h / alt-h", "include dotfiles and gitignored files"),
    ],
}

COMMON_CHEATS = [
    ("tab / shift-tab", "cycle tabs, or click a tab in the header"),
    ("shift-up / shift-down", "scroll the preview"),
    ("alt-up / alt-down", "page the preview"),
    ("?", "toggle this cheat sheet"),
]


def cheat_sheet(state):
    rows = CHEATS[state["tab"]] + COMMON_CHEATS
    width = max(len(key) for key, _ in rows)
    print(f"{BOLD}{TAB_LABEL[state['tab']]} keys{RESET}\n")
    for key, text in rows:
        print(f"  {YEL}{key:<{width}}{RESET}  {text}")
    print(f"\n  {DIM}esc closes the launcher. `?` is captured, so it cannot be typed into the query.{RESET}")


def screen_tail(pane_id, lines):
    """The pane's own screen, hard-truncated to the preview instead of wrapped.

    A herdr pane is often 300 columns wide; wrapping that into a 90-column
    preview turns every line into three and the result is unreadable.
    """
    try:
        text = api("pane.read", {"pane_id": pane_id, "source": "visible", "lines": 200})["read"]["text"]
    except (Fail, KeyError, ValueError) as err:
        return [f"{FAINT}{err}{RESET}"]
    rows = [clip(row.rstrip(), preview_width()) for row in text.split("\n")]
    while rows and not rows[-1].strip():
        rows.pop()
    return rows[-lines:]


def field(name, value):
    return f"  {DIM}{name:<10}{RESET}{value}"


def preview_action(payload):
    row = decode(payload)
    width = preview_width()
    print(f"{BOLD}{row['t']}{RESET}")
    print(f"{DIM}{row['g']}{RESET}\n")
    print(f"{YEL}{', '.join(row['c']) if row['c'] else 'unbound'}{RESET}\n")
    if row.get("d"):
        print(f"{row['d']}\n")
    print(rule("enter", width))
    target = goto_target(row)
    if target:
        print(f"{GRN}Opens the {TAB_LABEL[target if target != 'tabs' else 'spaces']} tab,{RESET}"
              f"{GRN} which does this job here.{RESET}  {DIM}keys.{row['n']}{RESET}")
    elif row["k"] == "builtin" and row["r"]:
        print(f"{GRN}Runs here.{RESET}  {DIM}keys.{row['n']}{RESET}")
    elif row["k"] == "builtin":
        print(f"{FAINT}herdr decodes this one in the client and exposes no API for a\n"
              f"plugin to fire it. Enter raises the chord as a toast and closes,\n"
              f"or holds the modal open with the chord in the header when toasts\n"
              f"are off. keys.{row['n']}{RESET}")
    elif row["k"] == "cmd":
        print(f"{GRN}Runs in this popup.{RESET}  {DIM}keys.command, type = {row['kind']}{RESET}")
    else:
        print(f"{GRN}Invoked once this popup closes.{RESET}  {DIM}{row['id']}{RESET}")


def preview_agent(payload):
    agent = decode(payload)
    width = preview_width()
    colour, icon = STATUS_ICON.get(agent["s"], STATUS_ICON["unknown"])
    print(f"{BOLD}{clip(agent['t'], width)}{RESET}\n")
    print(f"  {colour}{icon} {agent['s']}{RESET}"
          f"{'   ' + DIM + (agent['a'] or '') + RESET if agent.get('a') else ''}"
          f"{'  ' + agent['n'] if agent.get('n') else ''}")
    print(field("space", f"{agent['w']} / {agent['tb']}"))
    print(field("pane", agent["p"]))
    print(field("cwd", tilde(agent["cwd"])))
    if agent["sess"]:
        print(field("session", session_id(agent["sess"])))
    print()
    print(rule("screen", width))
    for row in screen_tail(agent["p"], preview_height() - 12):
        print(row)


def preview_space(payload):
    space = decode(payload)
    snap = snapshot()
    width = preview_width()
    record = next((w for w in snap["workspaces"] if w["workspace_id"] == space["id"]), None)
    if not record:
        print(f"{RED}workspace {space['id']} is gone{RESET}")
        return
    colour, icon = STATUS_ICON.get(record.get("agent_status"), STATUS_ICON["unknown"])
    print(f"{BOLD}{record['label']}{RESET}\n")
    print(f"  {colour}{icon} {record.get('agent_status', 'unknown')}{RESET}")
    print(field("id", record["workspace_id"]))
    print(field("holds", f"{record['tab_count']} tabs · {record['pane_count']} panes"))
    print()

    agents = {a["tab_id"]: a for a in snap["agents"]}
    tabs = [t for t in snap["tabs"] if t["workspace_id"] == space["id"]]
    print(rule("tabs", width))
    if not tabs:
        print(f"  {FAINT}none{RESET}")
        return
    label_width = max(len(t["label"]) for t in tabs) + 2
    for tab in tabs:
        tint, mark = STATUS_ICON.get(tab.get("agent_status"), STATUS_ICON["unknown"])
        here = f"{YEL}◂{RESET}" if tab.get("focused") else " "
        agent = agents.get(tab["tab_id"])
        note = agent_title(agent) if agent else f"{tab['pane_count']} panes"
        print(vclip(f"  {tint}{mark}{RESET} {here} {tab['label']:<{label_width}}{DIM}{note}{RESET}", width))


def preview_tab(payload):
    tab = decode(payload)
    snap = snapshot()
    width = preview_width()
    record = next((t for t in snap["tabs"] if t["tab_id"] == tab["id"]), None)
    if not record:
        print(f"{RED}tab {tab['id']} is gone{RESET}")
        return
    spaces = {w["workspace_id"]: w["label"] for w in snap["workspaces"]}
    colour, icon = STATUS_ICON.get(record.get("agent_status"), STATUS_ICON["unknown"])
    print(f"{BOLD}{record['label']}{RESET}\n")
    print(f"  {colour}{icon} {record.get('agent_status', 'unknown')}{RESET}")
    print(field("space", spaces.get(record["workspace_id"], record["workspace_id"])))
    print(field("id", record["tab_id"]))
    print()

    panes = [p for p in snap["panes"] if p["tab_id"] == tab["id"]]
    print(rule("panes", width))
    for pane in panes:
        tint, mark = STATUS_ICON.get(pane.get("agent_status"), STATUS_ICON["unknown"])
        here = f"{YEL}◂{RESET}" if pane.get("focused") else " "
        note = agent_title(pane) if pane.get("agent") else (pane.get("terminal_title_stripped") or "")
        print(vclip(f"  {tint}{mark}{RESET} {here} {FAINT}{pane['pane_id']}{RESET} {note}", width))
    if not panes:
        print(f"  {FAINT}none{RESET}")
        return

    lead = next((p for p in panes if p.get("focused")), panes[0])
    print()
    print(rule(f"screen · {lead['pane_id']}", width))
    for row in screen_tail(lead["pane_id"], preview_height() - 12 - len(panes)):
        print(row)


def preview_file(state, path):
    full = os.path.join(state["root"], path)
    print(f"{DIM}{tilde(full)}{RESET}\n")
    if not os.path.isfile(full):
        return
    if shutil.which("bat"):
        subprocess.run(["bat", "--style=numbers", "--color=always", "--paging=never",
                        "--line-range=:400", full])
    else:
        with open(full, errors="replace") as handle:
            for index, line in enumerate(handle):
                if index >= 400:
                    break
                sys.stdout.write(line)


# ---------------------------------------------------------------- root picker

POOL_DIR = os.path.join(HOME, "world", "trees")
# The wtp pool hangs off one bare repo; POOL_DIR itself is not a git dir.
POOL_REPO = os.path.join(HOME, "world", "git")


def git_worktrees(start):
    """Every worktree of one repo, with its branch, in a single call.

    A wtp slot is claimed exactly when its worktree is on a branch; freeing one
    detaches HEAD. That is `git worktree list` in ~60ms for the whole pool,
    where `_wtp status` takes ten seconds because it also computes dirty and
    unpushed per slot. The repo uses the reftable backend, so reading the HEAD
    file directly is not an option — it holds a `refs/heads/.invalid` stub.
    """
    if not start or not os.path.isdir(start):
        return []
    proc = subprocess.run(["git", "worktree", "list", "--porcelain"],
                          cwd=start, capture_output=True, text=True)
    if proc.returncode != 0:
        return []
    trees, path = [], None
    for line in proc.stdout.splitlines():
        if line.startswith("worktree "):
            path = line[len("worktree "):]
        elif line.startswith("branch refs/heads/") and path:
            trees.append((path, line[len("branch refs/heads/"):]))
            path = None
    return trees


def slot_label(path):
    if path.startswith(POOL_DIR + os.sep):
        return path[len(POOL_DIR) + 1:].split(os.sep)[0]
    return os.path.basename(path.rstrip(os.sep))


def slot_order(label):
    prefix, _, number = label.partition("-")
    return (0, int(number)) if prefix == "pool" and number.isdigit() else (1, 0)


def claimed_worktrees(current):
    """The pool plus whatever repo the current root belongs to, so this is
    useful outside ~/world without listing every tree on the machine."""
    found = {}
    for start in (current, POOL_REPO):
        for path, branch in git_worktrees(start):
            found.setdefault(path, branch)
    return sorted(found.items(), key=lambda item: (slot_order(slot_label(item[0])),
                                                   slot_label(item[0])))


def pick_line(options, prompt):
    """options is a list of (value, display); returns the chosen value."""
    lines = [f"{value}\t{display}" for value, display in options]
    proc = subprocess.run(["fzf", "--ansi", "--layout=reverse", "--delimiter=\t",
                           "--with-nth=2..", f"--prompt={prompt}"],
                          input="\n".join(lines), capture_output=True, text=True)
    if proc.returncode != 0 or not proc.stdout.strip():
        return None
    return proc.stdout.split("\t")[0].strip()


def cmd_root():
    state = load()
    options = [(state["origin"], f"{GRN}{'pane':<11}{RESET}{tilde(state['origin'])}")]
    for path, branch in claimed_worktrees(state["root"]):
        if path == state["origin"]:
            continue
        options.append((path, f"{BLU}{slot_label(path):<11}{RESET}{branch}"))
    lines = [f"{value}\t{display}" for value, display in options]
    proc = subprocess.run(["fzf", "--ansi", "--layout=reverse", "--delimiter=\t", "--with-nth=2..",
                           "--print-query", "--prompt=root> ",
                           "--header", f"{DIM}pick a claimed slot, or type any path and press enter{RESET}"],
                          input="\n".join(lines), capture_output=True, text=True)
    out = proc.stdout.split("\n")
    query, choice = (out[0] if out else ""), (out[1] if len(out) > 1 else "")

    if choice.strip():
        root = choice.split("\t")[0].strip()
    elif query.strip():
        root = os.path.abspath(os.path.expanduser(query.strip()))
        if os.path.isfile(root):
            root = os.path.dirname(root)
        if not os.path.isdir(root):
            return 0
    else:
        return 0

    state["root"] = root
    state["tab"] = "files"
    save(state)
    return 0


# ------------------------------------------------------------------- dispatch

def session_id(path):
    """pi names a session file <iso-timestamp>_<uuid>.jsonl."""
    stem = os.path.basename(path).removesuffix(".jsonl")
    _, sep, tail = stem.partition("_")
    return tail if sep else stem


def clipboard(text):
    for argv in (["pbcopy"], ["wl-copy"], ["xclip", "-selection", "clipboard"]):
        if shutil.which(argv[0]):
            subprocess.run(argv, input=text, text=True)
            return True
    return False


def hold(message):
    print(message)
    if sys.stdin.isatty():
        input("\npress Enter to close ")


def wait_for_shell(pane_id, timeout=3.0):
    """A freshly split pane accepts input only once its shell has registered."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if api("pane.process_info", {"pane_id": pane_id})["process_info"].get("shell_pid"):
                return True
        except Fail:
            pass
        time.sleep(0.1)
    return False


def run_action(state, payload):
    row = decode(payload)

    if row["k"] == "plugin":
        detach(["plugin", "action", "invoke", row["id"]])
        return None

    if row["k"] == "cmd":
        if row["kind"] == "plugin_action":
            detach(["plugin", "action", "invoke", row["cmd"]])
            return None
        if row["kind"] == "shell":
            subprocess.Popen(row["cmd"], shell=True, start_new_session=True,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return f"ran {row['cmd']}"
        shell = os.environ.get("SHELL") or "/bin/sh"
        os.execvp(shell, [shell, "-lc", row["cmd"]])

    if not row["r"]:
        # cmd_enter already raised the toast; accept only closed the modal so
        # the chord can be pressed against the session, not against fzf.
        return chord_hint(row)
    if goto_target(row):
        return None
    return RUNNERS[row["r"]](focused(state))


def run_agent(state, payload, key):
    agent = decode(payload)
    if key == "ctrl-y":
        if not agent["sess"]:
            raise Fail("that agent has no session file")
        value = session_id(agent["sess"])
        return f"copied {value}" if clipboard(value) else value
    cli("agent", "focus", agent["p"])
    return None


def run_space(state, payload, key):
    """Only ever reached at the tab level; a space row drills instead of
    accepting, so fzf never returns one."""
    row = decode(payload)
    if row.get("kind") == "space":
        cli("workspace", "focus", row["id"])
        return None
    cli("workspace", "focus", row["ws"])
    cli("tab", "focus", row["id"])
    return None


def run_file(state, path, key):
    full = os.path.join(state["root"], path)
    if key == "ctrl-y":
        return f"copied {tilde(full)}" if clipboard(full) else full
    pane = cli("pane", "split", focused(state)["pane"], "--direction", "right",
               "--cwd", state["root"], "--focus")["pane"]
    wait_for_shell(pane["pane_id"])
    # Over the socket, not `herdr pane run`, which prints nothing to parse.
    api("pane.send_input", {"pane_id": pane["pane_id"],
                           "text": f"{EDITOR} {shlex.quote(full)}", "keys": ["enter"]})
    # --focus lands before the shell exists; re-assert it so the cursor is in
    # the editor rather than back in the pane the split came from.
    api("pane.focus", {"pane_id": pane["pane_id"]})
    return None


DISPATCH = {"actions": lambda s, p, k: run_action(s, p),
            "agents": run_agent, "spaces": run_space, "files": run_file}


# ---------------------------------------------------------------- entrypoints

def cmd_open():
    env = []
    for name in ("HERDR_PANE_ID", "HERDR_TAB_ID", "HERDR_WORKSPACE_ID"):
        if os.environ.get(name):
            env += ["--env", f"LAUNCHER_SRC_{name[6:]}={os.environ[name]}"]
    cli("plugin", "pane", "open", "--plugin", PLUGIN_ID, "--entrypoint", "modal", *env)
    return 0


def cmd_pick():
    if not shutil.which("fzf"):
        raise Fail("fzf is not on PATH")

    snap = snapshot()
    pane = os.environ.get("LAUNCHER_SRC_PANE_ID") or snap.get("focused_pane_id")
    origin = next((p.get("foreground_cwd") or p.get("cwd") for p in snap["panes"]
                   if p["pane_id"] == pane and (p.get("foreground_cwd") or p.get("cwd"))), os.getcwd())

    workdir = tempfile.mkdtemp(prefix="herdr-launcher-")
    state = {
        "tab": "actions", "hidden": False, "help": False,
        "space": None, "space_label": None, "created": False,
        "root": origin, "origin": origin,
        "src_pane": pane,
        "src_tab": os.environ.get("LAUNCHER_SRC_TAB_ID") or snap.get("focused_tab_id"),
        "src_workspace": os.environ.get("LAUNCHER_SRC_WORKSPACE_ID") or snap.get("focused_workspace_id"),
    }
    env = dict(os.environ)
    env["LAUNCHER_STATE"] = os.path.join(workdir, "state.json")
    env["LAUNCHER"] = f"{shlex.quote(sys.executable)} {shlex.quote(SELF)}"
    os.environ["LAUNCHER_STATE"] = env["LAUNCHER_STATE"]
    header = build_header(state)
    save(state)

    argv = [
        # fzf starts children with $SHELL, and zsh does not word-split an
        # unquoted $LAUNCHER, so every bind below would exec one file whose
        # name is the interpreter path plus a space plus the script path.
        "fzf", "--with-shell", "sh -c",
        "--ansi", "--layout=reverse", "--info=inline-right", "--border=none",
        "--margin=0", "--padding=0", "--delimiter=\t", "--with-nth=3..",
        "--prompt=actions> ", "--header", header, "--header-first",
        "--preview", "$LAUNCHER preview {1} {2}",
        # nowrap: pane screens are far wider than the preview and wrapping them
        # turns one line into three.
        "--preview-window", "right,55%,border-left,nowrap",
        "--expect=ctrl-y",
        "--bind", "tab:transform:$LAUNCHER switch next",
        "--bind", "shift-tab:transform:$LAUNCHER switch prev",
        "--bind", "click-header:transform:$LAUNCHER click \"$FZF_CLICK_HEADER_COLUMN\"",
        "--bind", "enter:transform:$LAUNCHER enter {1} {2}",
        "--bind", "esc:transform:$LAUNCHER back",
        "--bind", "ctrl-n:execute($LAUNCHER new)+transform:$LAUNCHER after-new",
        "--bind", "ctrl-h:transform:$LAUNCHER toggle-hidden",
        "--bind", "alt-h:transform:$LAUNCHER toggle-hidden",
        "--bind", "ctrl-r:execute($LAUNCHER root)+transform:$LAUNCHER switch files",
        "--bind", "?:execute-silent($LAUNCHER toggle-help)+refresh-preview",
        "--bind", "shift-up:preview-up", "--bind", "shift-down:preview-down",
        "--bind", "alt-up:preview-page-up", "--bind", "alt-down:preview-page-down",
    ]
    seed = subprocess.run([sys.executable, SELF, "feed", "actions"], env=env,
                          capture_output=True, text=True).stdout
    proc = subprocess.run(argv, env=env, input=seed, capture_output=True, text=True)
    out = proc.stdout.split("\n")
    key = out[0].strip() if out else ""
    line = out[1] if len(out) > 1 else ""
    state = load()
    shutil.rmtree(workdir, ignore_errors=True)

    fields = line.split("\t")
    if len(fields) < 2 or not line.strip():
        return 0
    status = DISPATCH[fields[0]](state, fields[1], key)
    if status:
        print(status)
    return 0


def cmd_switch(target):
    state = load()
    if target in ("next", "prev"):
        index = TABS.index(state["tab"])
        state["tab"] = TABS[(index + (1 if target == "next" else -1)) % len(TABS)]
    elif target in TABS:
        state["tab"] = target
    state["help"] = False
    state["space"] = None
    state["space_label"] = None
    print(actions_for(state))
    save(state)
    return 0


def cmd_click(column):
    """FZF_CLICK_HEADER_COLUMN is 1-based within the header text, matching the
    columns build_header counts. Nearest-range is a hedge in case a future fzf
    reports the screen column instead; a click past the tab strip is ignored so
    the status text on the right stays inert."""
    state = load()
    ranges = state.get("ranges", {})
    try:
        col = int(column)
    except (TypeError, ValueError):
        ranges = {}
    if not ranges or col > max(end for _, end in ranges.values()) + 4:
        print("ignore")
        return 0
    nearest = min(ranges, key=lambda tab: abs(col - sum(ranges[tab]) / 2))
    return cmd_switch(nearest)


def cmd_enter(tab, payload):
    if tab == "actions" and payload:
        row = decode(payload)
        target = goto_target(row)
        if target:
            return enter_goto(target)
        if row["k"] == "builtin" and not row["r"]:
            return enter_chord(row)
    if tab == "spaces" and payload:
        row = decode(payload)
        if row.get("kind") == "space":
            state = load()
            state["space"] = row["id"]
            state["space_label"] = row["label"]
            print(actions_for(state))
            save(state)
            return 0
    print("accept")
    return 0


def chord_hint(row):
    chord = ", ".join(row["c"]) if row["c"] else ""
    return f"{row['t']} — press {chord}" if chord else f"{row['t']} is unbound"


def enter_goto(target):
    """switch_tab lands on the current workspace's tabs, not the workspace list,
    because the row promised a tab."""
    state = load()
    state["help"] = False
    if target == "tabs":
        workspace = state.get("src_workspace")
        labels = {w["workspace_id"]: w["label"] for w in snapshot()["workspaces"]}
        state["tab"] = "spaces"
        state["space"] = workspace
        state["space_label"] = labels.get(workspace, workspace)
    else:
        state["tab"] = target
        state["space"] = None
        state["space_label"] = None
    print(actions_for(state))
    save(state)
    return 0


def enter_chord(row):
    """Nothing here can fire it, so hand back the chord. A toast survives the
    modal closing, which is what you want, because pressing the chord is the
    next thing you do. When toasts are off, herdr answers `shown: false`; the
    modal then stays up and puts the chord in the header rather than closing
    on a keypress that produced nothing."""
    hint = chord_hint(row)
    shown = False
    if row["c"]:
        try:
            reply = cli("notification", "show", row["t"],
                        "--body", f"press {', '.join(row['c'])}")
            shown = bool(reply.get("shown"))
        except Fail:
            shown = False
    if shown:
        print("accept")
    else:
        print(f"change-header({build_header(load(), YEL + hint + RESET)})")
    return 0


def cmd_back():
    """esc unwinds one level before it closes the modal."""
    state = load()
    if state["tab"] != "spaces" or not state.get("space"):
        print("abort")
        return 0
    state["space"] = None
    state["space_label"] = None
    print(actions_for(state))
    save(state)
    return 0


def cmd_new():
    """Runs under fzf's execute, so it owns the terminal and can prompt."""
    state = load()
    state["created"] = False
    save(state)
    if state["tab"] != "spaces":
        return 0
    if state.get("space"):
        label = ask(f"New tab in {space_label(state)}: ")
        args = ["tab", "create", "--workspace", state["space"], "--focus"]
        cli(*(args + (["--label", label] if label else [])))
    else:
        label = ask("New workspace: ")
        args = ["workspace", "create", "--focus"]
        cli(*(args + (["--label", label] if label else [])))
    state["created"] = True
    save(state)
    return 0


def cmd_after_new():
    """herdr's own new_tab and new_workspace focus what they create, so match
    that and get out of the way; a cancelled prompt just refreshes."""
    state = load()
    print("abort" if state.get("created") else actions_for(state))
    return 0


def cmd_toggle_hidden():
    state = load()
    state["hidden"] = not state.get("hidden")
    state["tab"] = "files"
    save(state)
    print(actions_for(state))
    return 0


def cmd_toggle_help():
    state = load()
    state["help"] = not state.get("help")
    save(state)
    return 0


PREVIEWS = {"actions": lambda s, p: preview_action(p), "agents": lambda s, p: preview_agent(p),
            "spaces": lambda s, p: (preview_tab if s.get("space") else preview_space)(p),
            "files": preview_file}


def cmd_preview(tab, payload):
    state = load()
    if state.get("help"):
        cheat_sheet(state)
        return 0
    if tab in PREVIEWS and payload:
        PREVIEWS[tab](state, payload)
    return 0


def main(argv):
    command = argv[1] if len(argv) > 1 else "pick"
    rest = argv[2:]
    if command == "open":
        return cmd_open()
    if command == "pick":
        return cmd_pick()
    if command == "feed":
        return FEEDS[rest[0]](load()) or 0
    if command == "switch":
        return cmd_switch(rest[0] if rest else "next")
    if command == "click":
        return cmd_click(rest[0] if rest else "")
    if command == "enter":
        return cmd_enter(rest[0] if rest else "", rest[1] if len(rest) > 1 else "")
    if command == "back":
        return cmd_back()
    if command == "new":
        return cmd_new()
    if command == "after-new":
        return cmd_after_new()
    if command == "toggle-hidden":
        return cmd_toggle_hidden()
    if command == "toggle-help":
        return cmd_toggle_help()
    if command == "preview":
        return cmd_preview(rest[0] if rest else "", rest[1] if len(rest) > 1 else "")
    if command == "root":
        return cmd_root()
    raise Fail(f"unknown command '{command}'")


# What to emit if one of these dies. fzf takes a child's stdout as the actions
# to run, so an exception that prints nothing silently kills the key: a broken
# `enter` looks exactly like a modal that ignores you.
FZF_FALLBACK = {"enter": "accept", "switch": "ignore", "click": "ignore",
                "toggle-hidden": "ignore", "back": "abort", "after-new": "ignore"}


if __name__ == "__main__":
    entry = sys.argv[1] if len(sys.argv) > 1 else "pick"
    try:
        sys.exit(main(sys.argv) or 0)
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as err:  # noqa: BLE001 - a UI child must not die silently
        if entry in FZF_FALLBACK:
            print(FZF_FALLBACK[entry])
            sys.exit(0)
        if entry == "preview":
            # stderr from a preview child paints over fzf's own output.
            print(f"{RED}launcher: {err}{RESET}")
            sys.exit(0)
        # An unexpected type is a bug in here, so give it a traceback; a Fail
        # is already a diagnosis written for the reader.
        detail = err if isinstance(err, Fail) else traceback.format_exc().rstrip()
        print(f"launcher: {detail}", file=sys.stderr)
        # A popup closes the instant its command exits, so hold the error on
        # screen long enough to read.
        if entry == "pick" and sys.stdin.isatty():
            try:
                input("\npress Enter to close ")
            except (EOFError, KeyboardInterrupt):
                pass
        sys.exit(1)
