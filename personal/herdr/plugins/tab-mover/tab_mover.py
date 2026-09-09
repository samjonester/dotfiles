#!/usr/bin/env python3
"""Move a herdr tab, with its full pane layout, into another open workspace.

herdr's `tab.move` only reorders tabs inside one workspace, so a cross-workspace
move has to be rebuilt from `pane.move`, the only call that relocates a live
terminal. Panes are moved one at a time and the destination split tree is
replayed from `layout.export`, so ratios and nesting survive the trip. The
source tab closes itself when its last pane leaves.

Subcommands:
  pick          interactive picker (runs in the popup pane)
  open-picker   open that popup (runs headless from the keybinding action)
  move <ws>     non-interactive move of the active tab into workspace <ws>
"""

import json
import os
import shutil
import socket
import subprocess
import sys

HERDR = os.environ.get("HERDR_BIN_PATH") or shutil.which("herdr") or "herdr"
PLUGIN_ID = "sam.tab-mover"


class Fail(Exception):
    pass


def cli(*args):
    proc = subprocess.run([HERDR, *args], capture_output=True, text=True)
    if proc.returncode != 0:
        raise Fail(f"herdr {' '.join(args)}: {(proc.stderr or proc.stdout).strip()}")
    return json.loads(proc.stdout)["result"]


def api(method, params):
    """layout.export has no CLI verb, so this speaks the socket directly."""
    path = os.environ.get("HERDR_SOCKET_PATH")
    if not path:
        raise Fail("HERDR_SOCKET_PATH is unset — run this inside herdr")
    with socket.socket(socket.AF_UNIX) as sock:
        sock.connect(path)
        sock.sendall((json.dumps({"id": "tab-mover", "method": method, "params": params}) + "\n").encode())
        buf = b""
        while not buf.endswith(b"\n"):
            chunk = sock.recv(65536)
            if not chunk:
                raise Fail(f"{method}: socket closed early")
            buf += chunk
    reply = json.loads(buf.decode().strip())
    if "error" in reply:
        raise Fail(f"{method}: {reply['error'].get('message', reply['error'])}")
    return reply["result"]


def workspaces():
    return cli("workspace", "list")["workspaces"]


def active_tab():
    """Prefer the id herdr handed the invoking action; fall back to focus."""
    for var in ("TAB_MOVER_SRC_TAB", "HERDR_TAB_ID", "HERDR_ACTIVE_TAB_ID"):
        if os.environ.get(var):
            return os.environ[var]
    for ws in workspaces():
        if ws["focused"]:
            for tab in cli("tab", "list", "--workspace", ws["workspace_id"])["tabs"]:
                if tab["focused"]:
                    return tab["tab_id"]
            return ws["active_tab_id"]
    raise Fail("no focused tab")


def tab_label(tab_id):
    for tab in cli("tab", "list", "--workspace", tab_id.split(":")[0])["tabs"]:
        if tab["tab_id"] == tab_id:
            return tab["label"]
    return None


def first_leaf(node):
    while node["type"] == "split":
        node = node["first"]
    return node["pane_id"]


def move_tab(src_tab, dest_ws):
    src_ws = src_tab.split(":")[0]
    if src_ws == dest_ws:
        raise Fail(f"{src_tab} is already in {dest_ws}")

    root = api("layout.export", {"tab_id": src_tab})["layout"]["root"]
    label = tab_label(src_tab)

    # The first pane opens the destination tab; every later pane splits off a
    # pane already living there.
    anchor = cli("pane", "move", first_leaf(root),
                 "--new-tab", "--workspace", dest_ws,
                 *(["--label", label] if label else []),
                 "--no-focus")["move_result"]
    dest_tab = anchor["pane"]["tab_id"]

    # `anchor` always fills exactly the region its subtree occupied in the
    # source, so splitting it reproduces that node's geometry. Holding that
    # invariant through the recursion replays any binary tree exactly.
    def place(node, anchor_pane):
        if node["type"] == "pane":
            return
        moved = cli("pane", "move", first_leaf(node["second"]),
                    "--tab", dest_tab,
                    "--split", node["direction"],
                    "--target-pane", anchor_pane,
                    "--ratio", str(node["ratio"]),
                    "--no-focus")["move_result"]
        place(node["first"], anchor_pane)
        place(node["second"], moved["pane"]["pane_id"])

    place(root, anchor["pane"]["pane_id"])
    return dest_tab, label


def choose(options):
    """fzf when it is on PATH, numbered prompt otherwise."""
    lines = [f"{ws['workspace_id']}\t{ws['number']}. {ws['label']}  "
             f"({ws['tab_count']} tab{'' if ws['tab_count'] == 1 else 's'})" for ws in options]
    if shutil.which("fzf"):
        proc = subprocess.run(
            ["fzf", "--prompt=move tab to> ", "--reverse", "--with-nth=2..", "--delimiter=\t"],
            input="\n".join(lines), capture_output=True, text=True)
        if proc.returncode != 0 or not proc.stdout.strip():
            return None
        return proc.stdout.split("\t")[0].strip()

    for index, line in enumerate(lines, 1):
        print(f"  {index}) {line.split(chr(9), 1)[1]}")
    try:
        reply = input("\nmove tab to [number, or Enter to cancel]: ").strip()
    except (EOFError, KeyboardInterrupt):
        return None
    if not reply.isdigit() or not 1 <= int(reply) <= len(options):
        return None
    return options[int(reply) - 1]["workspace_id"]


def cmd_pick():
    src_tab = active_tab()
    src_ws = src_tab.split(":")[0]
    options = [ws for ws in workspaces() if ws["workspace_id"] != src_ws]
    if not options:
        raise Fail("no other workspace is open")

    print(f"Moving tab {tab_label(src_tab) or src_tab}\n")
    dest = choose(options)
    if not dest:
        return 0

    dest_tab, label = move_tab(src_tab, dest)
    cli("tab", "focus", dest_tab)
    print(f"\nMoved '{label or src_tab}' to {dest} as {dest_tab}.")
    return 0


def cmd_open_picker():
    env = []
    src = os.environ.get("HERDR_TAB_ID") or os.environ.get("HERDR_ACTIVE_TAB_ID")
    if src:
        env = ["--env", f"TAB_MOVER_SRC_TAB={src}"]
    cli("plugin", "pane", "open", "--plugin", PLUGIN_ID, "--entrypoint", "pick", *env)
    return 0


def cmd_move(dest):
    src_tab = active_tab()
    dest_tab, label = move_tab(src_tab, dest)
    print(f"Moved '{label or src_tab}' to {dest} as {dest_tab}.")
    return 0


def main(argv):
    command = argv[1] if len(argv) > 1 else "pick"
    if command == "pick":
        return cmd_pick()
    if command == "open-picker":
        return cmd_open_picker()
    if command == "move":
        if len(argv) < 3:
            raise Fail("usage: tab_mover.py move <workspace-id>")
        return cmd_move(argv[2])
    raise Fail(f"unknown command '{command}'")


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv))
    except Fail as err:
        print(f"tab-mover: {err}", file=sys.stderr)
        # A popup closes the instant its command exits, so hold the error
        # on screen long enough to read.
        if sys.stdin.isatty():
            input("\npress Enter to close ")
        sys.exit(1)
