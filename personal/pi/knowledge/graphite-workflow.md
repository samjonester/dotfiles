# Graphite Workflow — Quick Reference

A cheat sheet for stacked-PR development with [Graphite](https://graphite.dev/).

## Branch Management

- `gt create -m "message"` — new branch in stack (stages all, commits)
- `gt modify` — amend current commit (stages all, amends)
- `gt absorb` — absorb staged changes into the right commit in the stack
- `gt submit` — push + create/update draft PR
- `gt submit --publish` — move PR from draft → ready for review
- `gt sync` — rebase stack on latest main
- `gt sync -f` — force-sync: cleans up stale merged/closed branches + fetches main
- `gt restack` — rebase dependent branches after amend

## Troubleshooting Submit

When `gt submit` fails with **"PR for the following branch has already been merged but the merged commits are not contained in the latest trunk branch"** or **"Aborting non-interactive submit"**:

1. Run `gt sync -f` — this cleans up stale merged/closed branches and fetches latest main
2. Then retry `gt submit`

This is the most common submit failure. Do NOT manually `gt branch delete` stale branches — `gt sync -f` handles it cleanly.

## PR Flow

1. `gt create -m "description"` — creates branch + commit
2. `gt submit` — pushes draft PR
3. Iterate: edit → `gt modify` → `gt submit`
4. Ready for review: `gt submit --publish`
5. Trigger CI (if your org requires explicit CI runs post-draft)
6. Merge via your merge queue / Graphite merge

## Stack Management

- `gt log` — show stack
- `gt ls` — list branches in tree view
- `gt branch` — list branches
- `gt checkout <branch>` — switch within stack
- `gt top` / `gt bottom` — navigate stack

## Rules

- Never `git commit` directly — use `gt modify` (amend) or `gt create` (new branch). Raw git commits break Graphite's branch metadata.
- Never `gh pr ready` — it only updates GitHub and does not sync to Graphite. Use `gt submit --publish`.
- For new branch work: present changes for review **before** committing.
- For amendments on existing branches (CI fixes, review feedback): commit freely.

## CI Notes

Some orgs auto-run CI on every push; others run once on draft → ready and then require explicit triggering. Check your org's conventions. Explicit-trigger orgs often expose a command along the lines of `ci run` / `ci run --pipeline <name>` / `ci merge-when-ready`.

## Source
- Sam Jones, 2026-04-23 (initial), 2026-05-06 (added gt sync -f troubleshooting)
