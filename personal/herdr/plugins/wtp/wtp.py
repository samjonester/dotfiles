#!/usr/bin/env python3
"""shop/world pool-slot state for herdr: a Spaces token, and a picker that frees.

A wtp slot is claimed exactly when its worktree is on a branch — freeing one
detaches HEAD — so the whole pool is one `git worktree list --porcelain` against
the pool's bare repo, ~0.05s. `_wtp status` answers the same question in ten
seconds because it also computes dirty and unpushed per slot, so that only runs
inside a free confirmation, where those two facts are the point. shop/world uses
the reftable backend, so a worktree's HEAD file is a `refs/heads/.invalid` stub
and the branch has to come from `git worktree list`.

Freeing shells `_wtp free`, never `dev tree remove`: `wtp free` detaches HEAD and
returns the slot to the pool, `dev tree remove` deletes the checkout.

Subcommands. `open-picker`, `refresh`, and `on-workspace-created` are the
manifest's entrypoints; `pick` runs inside the popup.
  refresh [<ws>...]      recompute the slot token for every workspace, or some
  on-workspace-created   the workspace.created hook
  open-picker            open the popup, from the keybinding action
  pick                   the picker itself, inside the popup
  free <slot>            confirm, then free one slot
  slots                  print pool state (standalone; no herdr required)
"""

import json
import os
import shutil
import subprocess
import sys
import time

HERDR = os.environ.get("HERDR_BIN_PATH") or shutil.which("herdr") or "herdr"
PLUGIN_ID = "sam.wtp"
HOME = os.path.expanduser("~")

POOL_DIR = os.path.join(HOME, "world", "trees")
# The wtp pool hangs off one bare repo; POOL_DIR itself is not a git dir.
POOL_REPO = os.path.join(HOME, "world", "git")
# Every tree in the pool is <slot>/src.
WORKTREE_SUBDIR = "src"
WTP_BIN = (os.environ.get("WTP_BIN")
           or os.path.join(HOME, "src/github.com/shopify-playground/wtp/bin/_wtp"))

TOKEN = "slot"
# Budget for `<slot> <branch>` on a 32-column sidebar, leaving room for a second
# token on the same row. Only the branch is elided; the slot label never is.
# The picker always shows the branch in full.
TOKEN_WIDTH = 26

RESET = "\x1b[0m"
DIM = "\x1b[38;5;245m"
FAINT = "\x1b[38;5;240m"
GRN = "\x1b[38;5;108m"
YEL = "\x1b[38;5;214m"
BLU = "\x1b[38;5;109m"
RED = "\x1b[38;5;167m"
BOLD = "\x1b[1m"


class Fail(Exception):
    pass


# ---------------------------------------------------------------- herdr calls

def cli(*args):
    """One herdr CLI call. `workspace report-metadata` answers with an empty
    body, so a blank stdout is a success with nothing to read, not a parse
    error."""
    proc = subprocess.run([HERDR, *args], capture_output=True, text=True)
    if proc.returncode != 0:
        raise Fail(f"herdr {' '.join(args)}: {(proc.stderr or proc.stdout).strip()}")
    if not proc.stdout.strip():
        return None
    return json.loads(proc.stdout)["result"]


def snapshot():
    return cli("api", "snapshot")["snapshot"]


# ------------------------------------------------------------------ pool read

def git(cwd, *args):
    """(returncode, output) for one git call, with stderr folded in."""
    if not cwd or not os.path.isdir(cwd):
        return 1, ""
    proc = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)
    return proc.returncode, (proc.stdout + proc.stderr).strip()


def git_worktrees(start):
    """Every worktree of one repo, with its branch, in a single call."""
    code, out = git(start, "worktree", "list", "--porcelain")
    if code != 0:
        return []
    trees, path = [], None
    for line in out.splitlines():
        if line.startswith("worktree "):
            path = line[len("worktree "):]
        elif line.startswith("branch refs/heads/") and path:
            trees.append((path, line[len("branch refs/heads/"):]))
            path = None
    return trees


def slot_label(path):
    """The tree a path belongs to — `pool-7`, `root` — or None outside the pool."""
    if not path:
        return None
    if not path.startswith(POOL_DIR + os.sep):
        return None
    return path[len(POOL_DIR) + 1:].split(os.sep)[0]


def slot_order(label):
    prefix, _, number = label.partition("-")
    return (0, int(number)) if prefix == "pool" and number.isdigit() else (1, 0)


def slot_src(label):
    return os.path.join(POOL_DIR, label, WORKTREE_SUBDIR)


def pool_slots():
    """Every pool-N slot on disk, numerically ordered, with its branch.

    Only pool-N: `_wtp free` refuses any other name, and the sibling trees in
    POOL_DIR (`root`, the `dev tree` checkouts) are not the pool's to hand out.
    """
    if not os.path.isdir(POOL_DIR):
        return []
    branches = dict(git_worktrees(POOL_REPO))
    slots = []
    for name in sorted(os.listdir(POOL_DIR), key=slot_order):
        if not name.startswith("pool-") or not os.path.isdir(os.path.join(POOL_DIR, name)):
            continue
        slots.append({"name": name,
                      "src": slot_src(name),
                      "branch": branches.get(slot_src(name))})
    return slots


# ------------------------------------------------------------- sidebar tokens

def token_for(cwd, branches):
    """`pool-7 sam/dv360-csv-import` for a path in the pool, else None."""
    label = slot_label(cwd)
    if not label:
        return None
    branch = branches.get(slot_src(label))
    if not branch:
        # A pool slot with a detached HEAD is free to claim; any other tree in
        # POOL_DIR is a `dev tree` checkout that was never on a branch.
        branch = "free" if label.startswith("pool-") else "detached"
    budget = TOKEN_WIDTH - len(label) - 1
    if budget < 8:
        return label
    if len(branch) > budget:
        branch = branch[:budget - 1] + "…"
    return f"{label} {branch}"


def workspace_cwds(snap):
    """workspace_id -> cwd, preferring the pane the workspace is looking at."""
    best = {}
    active = {w["workspace_id"]: w.get("active_tab_id") for w in snap.get("workspaces", [])}
    for pane in snap.get("panes", []):
        ws = pane.get("workspace_id")
        cwd = pane.get("cwd") or pane.get("foreground_cwd")
        if not ws or not cwd:
            continue
        rank = (0 if pane.get("focused") else 1,
                0 if pane.get("tab_id") == active.get(ws) else 1)
        if ws not in best or rank < best[ws][0]:
            best[ws] = (rank, cwd)
    return {ws: cwd for ws, (_, cwd) in best.items()}


def refresh(workspace_ids=None, cwd_hints=None):
    """Write, or clear, the slot token on every workspace. Returns what it set.

    `cwd_hints` covers a workspace whose panes have not reported a cwd yet; a
    live pane always wins over a hint.
    """
    snap = snapshot()
    cwds = workspace_cwds(snap)
    for ws, cwd in (cwd_hints or {}).items():
        cwds.setdefault(ws, cwd)
    branches = dict(git_worktrees(POOL_REPO))
    targets = workspace_ids or [w["workspace_id"] for w in snap.get("workspaces", [])]
    written = []
    for ws in targets:
        value = token_for(cwds.get(ws), branches)
        flag = ["--token", f"{TOKEN}={value}"] if value else ["--clear-token", TOKEN]
        try:
            cli("workspace", "report-metadata", ws, "--source", PLUGIN_ID, *flag)
        except Fail as err:
            # A workspace can close between the snapshot and the write; one
            # missing target is not a reason to skip the rest.
            print(f"{ws}: {err}", file=sys.stderr)
            continue
        written.append((ws, value))
    return written


# ---------------------------------------------------------------- free a slot

def run(argv):
    proc = subprocess.run(argv, capture_output=True, text=True)
    return proc.returncode, (proc.stdout + proc.stderr).strip()


def dirty_paths(src, limit=5):
    code, out = git(src, "status", "--porcelain")
    if code != 0 or not out:
        return []
    lines = out.splitlines()
    return lines[:limit] + ([f"… {len(lines) - limit} more"] if len(lines) > limit else [])


def unpushed_verdict(src, branch):
    """Is `_wtp free`'s unpushed refusal real? (safe_to_force, lines).

    `has_unpushed` measures against `<branch>@{upstream}`, and a slot set up with
    `git checkout -B <branch> FETCH_HEAD` inherits `branch.<name>.merge =
    refs/heads/main` — so every commit the branch adds to main counts as
    unpushed even when origin has the branch at exactly this commit. `git
    ls-remote` is what settles it, and it is one network call.
    """
    lines = []
    _, head = git(src, "rev-parse", "HEAD")
    _, upstream = git(src, "rev-parse", "--abbrev-ref", f"{branch}@{{upstream}}")
    _, merge = git(src, "config", "--get", f"branch.{branch}.merge")
    if merge and merge != f"refs/heads/{branch}":
        lines.append(f"branch.{branch}.merge is {merge} — wtp measured against the wrong ref")
    elif not merge:
        lines.append(f"no upstream configured for {branch} — wtp assumes unpushed")

    code, out = run(["git", "-C", src, "ls-remote", "origin", f"refs/heads/{branch}"])
    if code != 0:
        lines.append(f"git ls-remote failed: {out.splitlines()[0] if out else 'no output'}")
        return False, lines
    remote = out.split()[0] if out.strip() else None

    if not remote:
        _, count = git(src, "rev-list", "--count", "origin/main..HEAD")
        if count == "0":
            lines.append(f"{GRN}origin has no refs/heads/{branch}, and HEAD adds nothing to "
                         f"origin/main{RESET} — the branch is a bare local ref")
            return True, lines
        lines.append(f"{RED}origin has no refs/heads/{branch}{RESET} — "
                     f"--force deletes {count or '?'} commit(s) that exist nowhere else")
        return False, lines
    if remote == head:
        lines.append(f"{GRN}origin/{branch} is at HEAD ({head[:9]}){RESET} — "
                     f"nothing is actually unpushed")
        return True, lines
    if git(src, "cat-file", "-e", f"{remote}^{{commit}}")[0] == 0:
        if git(src, "merge-base", "--is-ancestor", "HEAD", remote)[0] == 0:
            lines.append(f"{GRN}origin/{branch} ({remote[:9]}) contains HEAD ({head[:9]}){RESET} — "
                         f"nothing is actually unpushed")
            return True, lines
        _, count = git(src, "rev-list", "--count", f"{remote}..HEAD")
        lines.append(f"{RED}{count or '?'} commit(s) here are not on origin/{branch}{RESET} "
                     f"({head[:9]} vs remote {remote[:9]})")
        return False, lines
    lines.append(f"{YEL}origin/{branch} is at {remote[:9]}, which is not in this checkout{RESET} — "
                 f"fetch before deciding")
    return False, lines


def attachments(slot_name):
    """Live herdr workspaces sitting in a slot, so a free cannot surprise one."""
    try:
        snap = snapshot()
    except (Fail, OSError):
        return []
    labels = {w["workspace_id"]: w.get("label", w["workspace_id"])
              for w in snap.get("workspaces", [])}
    found = {}
    for pane in snap.get("panes", []):
        if slot_label(pane.get("cwd") or pane.get("foreground_cwd")) != slot_name:
            continue
        ws = pane.get("workspace_id")
        agent = pane.get("agent")
        found.setdefault(ws, set())
        if agent:
            found[ws].add(f"{agent}:{pane.get('agent_status', 'unknown')}")
    return [(labels.get(ws, ws), sorted(agents)) for ws, agents in found.items()]


def ask(prompt):
    try:
        return input(prompt).strip()
    except (EOFError, KeyboardInterrupt):
        print()
        return ""


def free_slot(slot_name):
    """Confirm, then `_wtp free`. Never `dev tree remove`. Returns True if freed."""
    if not slot_name.startswith("pool-"):
        raise Fail(f"{slot_name} is not a pool slot — `_wtp free` only takes pool-N")
    if not os.access(WTP_BIN, os.X_OK):
        raise Fail(f"no executable wtp at {WTP_BIN} — set WTP_BIN")
    src = slot_src(slot_name)
    branch = dict(git_worktrees(POOL_REPO)).get(src)
    if not branch:
        print(f"{slot_name} is already free.")
        return False

    print(f"{BOLD}{slot_name}{RESET}  {YEL}{branch}{RESET}")
    print(f"{DIM}{src}{RESET}")
    for label, agents in attachments(slot_name):
        note = f" [{', '.join(agents)}]" if agents else ""
        print(f"{RED}  in use by workspace {label}{note}{RESET}")
    if ask(f"\nfree {slot_name}? [y/N] ").lower() not in ("y", "yes"):
        print("cancelled.")
        return False

    code, out = run([WTP_BIN, "free", slot_name])
    if out:
        print(out)
    if code == 0:
        return True
    if "Use --force to discard" not in out:
        return False

    print(f"\n{BOLD}why wtp refused{RESET}")
    safe = True
    paths = dirty_paths(src)
    if paths:
        safe = False
        print(f"{RED}uncommitted changes{RESET} — --force discards them:")
        for path in paths:
            print(f"  {DIM}{path}{RESET}")
    if "unpushed commits" in out:
        pushed, lines = unpushed_verdict(src, branch)
        safe = safe and pushed
        for line in lines:
            print(f"  {line}")

    verdict = (f"{GRN}nothing would be lost{RESET}" if safe
               else f"{RED}--force discards the above{RESET}")
    print(f"\n{verdict}")
    if ask(f"type '{slot_name}' to free with --force, anything else cancels: ") != slot_name:
        print("cancelled.")
        return False
    code, out = run([WTP_BIN, "free", slot_name, "--force"])
    if out:
        print(out)
    return code == 0


# -------------------------------------------------------------------- picker

def pick_slot(current):
    rows, values = [], []
    live = {}
    try:
        snap = snapshot()
        labels = {w["workspace_id"]: w.get("label", w["workspace_id"])
                  for w in snap.get("workspaces", [])}
        for pane in snap.get("panes", []):
            name = slot_label(pane.get("cwd") or pane.get("foreground_cwd"))
            if name:
                live.setdefault(name, set()).add(labels.get(pane["workspace_id"], ""))
    except (Fail, OSError):
        pass

    for slot in pool_slots():
        here = "›" if slot["name"] == current else " "
        state = (f"{YEL}{slot['branch']}{RESET}" if slot["branch"]
                 else f"{FAINT}free{RESET}")
        spaces = ", ".join(sorted(x for x in live.get(slot["name"], []) if x))
        note = f"  {BLU}⟨{spaces}⟩{RESET}" if spaces else ""
        rows.append(f"{slot['name']}\t{here} {slot['name']:<8} {state}{note}")
        values.append(slot["name"])
    if not rows:
        raise Fail(f"no pool slots under {POOL_DIR}")

    proc = subprocess.run(
        ["fzf", "--ansi", "--layout=reverse", "--delimiter=\t", "--with-nth=2..",
         "--expect=ctrl-r", "--prompt=wtp> ",
         "--header", "enter  free this slot    ctrl-r  refresh sidebar tokens    esc  close"],
        input="\n".join(rows), capture_output=True, text=True)
    out = proc.stdout.splitlines()
    if proc.returncode != 0 or not out:
        return None, None
    key = out[0].strip()
    choice = out[1].split("\t")[0].strip() if len(out) > 1 else None
    return key, choice


# ------------------------------------------------------------------ commands

def cmd_refresh(argv):
    for ws, value in refresh(argv or None):
        print(f"{ws}: {value or '(cleared)'}")
    return 0


def cmd_on_workspace_created():
    """Resolve the new workspace's slot and write its token.

    The event payload is undocumented, so the raw context is kept for the next
    time this needs debugging and the workspace id is dug out of whatever shape
    it arrives in. A workspace can also be announced before its first shell
    reports a cwd, so the slot is polled for rather than read once.
    """
    raw = os.environ.get("HERDR_PLUGIN_CONTEXT_JSON") or ""
    state_dir = os.environ.get("HERDR_PLUGIN_STATE_DIR")
    if state_dir and raw:
        try:
            os.makedirs(state_dir, exist_ok=True)
            with open(os.path.join(state_dir, "last-workspace-created.json"), "w") as handle:
                handle.write(raw)
        except OSError as err:
            print(f"context dump failed: {err}", file=sys.stderr)

    # The payload describes the event; HERDR_WORKSPACE_ID is ambient and, when a
    # command runs from inside a pane, names that pane's workspace instead. The
    # payload wins, and the env var is only the fallback for a shape find_key
    # cannot read.
    ctx = parse(raw)
    workspace = find_key(ctx, "workspace_id") or os.environ.get("HERDR_WORKSPACE_ID")
    if not workspace:
        raise Fail(f"no workspace id in HERDR_WORKSPACE_ID or context: {raw[:200]}")

    # An action's context carries workspace_cwd, and a worktree event carries
    # checkout_path; either settles the slot without waiting. Without one, the
    # workspace can be announced before its first shell reports a cwd.
    hint = find_key(ctx, "workspace_cwd") or find_key(ctx, "checkout_path")
    for attempt in range(20):
        if hint or workspace_cwds(snapshot()).get(workspace):
            break
        time.sleep(0.25)
    for ws, value in refresh([workspace], {workspace: hint} if hint else None):
        print(f"{ws}: {value or '(cleared)'} after {attempt * 0.25:.2f}s")
    return 0


def parse(raw):
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return {}


def find_key(node, key):
    """First value for `key` anywhere in a nested payload."""
    if isinstance(node, dict):
        if isinstance(node.get(key), str):
            return node[key]
        for value in node.values():
            found = find_key(value, key)
            if found:
                return found
    elif isinstance(node, list):
        for value in node:
            found = find_key(value, key)
            if found:
                return found
    return None


def cmd_open_picker():
    env = []
    workspace = os.environ.get("HERDR_WORKSPACE_ID")
    if workspace:
        env = ["--env", f"WTP_SRC_WORKSPACE={workspace}"]
    cli("plugin", "pane", "open", "--plugin", PLUGIN_ID, "--entrypoint", "pick", *env)
    return 0


def cmd_pick():
    if not shutil.which("fzf"):
        return cmd_slots()
    current = None
    workspace = os.environ.get("WTP_SRC_WORKSPACE")
    if workspace:
        try:
            current = slot_label(workspace_cwds(snapshot()).get(workspace))
        except (Fail, OSError):
            current = None
    while True:
        key, choice = pick_slot(current)
        if choice is None:
            return 0
        if key == "ctrl-r":
            written = refresh()
            print(f"{DIM}refreshed {len(written)} workspace token(s){RESET}")
            time.sleep(0.6)
            continue
        print()
        if free_slot(choice):
            refresh()
            print(f"{GRN}{choice} is free.{RESET}")
        ask("\npress Enter to continue ")


def cmd_free(slot_name):
    if free_slot(slot_name):
        refresh()
        print(f"{GRN}{slot_name} is free.{RESET}")
        return 0
    return 1


def cmd_slots():
    for slot in pool_slots():
        print(f"{slot['name']:<8} {slot['branch'] or 'free'}")
    return 0


def main(argv):
    command = argv[1] if len(argv) > 1 else "pick"
    if command == "refresh":
        return cmd_refresh(argv[2:])
    if command == "on-workspace-created":
        return cmd_on_workspace_created()
    if command == "open-picker":
        return cmd_open_picker()
    if command == "pick":
        return cmd_pick()
    if command == "free":
        if len(argv) < 3:
            raise Fail("usage: wtp.py free <pool-N>")
        return cmd_free(argv[2])
    if command == "slots":
        return cmd_slots()
    raise Fail(f"unknown command '{command}'")


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv))
    except Fail as err:
        print(f"wtp: {err}", file=sys.stderr)
        # A popup closes the instant its command exits, so hold the error on
        # screen long enough to read.
        if sys.stdin.isatty():
            input("\npress Enter to close ")
        sys.exit(1)
