# Worktree Discipline for AI Agents

Rules for working with git worktrees. CWD confusion and stash mismanagement are the top failure modes.

## Hard Rules

### Worktree Work

1. **Switch CWD to the worktree immediately.** The moment you confirm a worktree exists (or create one), `cd` into it. Stay there for the entire task.
2. **All commands run from the worktree.** Tests, builds, git ops, `gh` CLI, API calls -- everything. Never `cd` to the main checkout.
3. **Never copy files between worktree and main checkout.** Commit and push from the worktree directly. `gt modify` and `gt submit` work from worktrees.
4. **Check branch state before committing.** `git branch --show-current` -- if empty, you're in detached HEAD. Checkout the branch first.
5. **Always use `-b` when creating worktrees for new work.** `git worktree add <path> origin/main` = detached HEAD (can't commit). Use `git worktree add -b <branch> <path> <base>`.
6. **Worktree = fully self-contained workspace.** Dependencies, tests, commits, push -- all happen there. Treat it like a separate clone.

### Stash, Unstaged Changes, and Syncing

1. **Never stash without user approval.** Stashing is destructive. If stash pop conflicts, recovery is messy. Always ask first.
2. **After stash pop, ALWAYS run `git status`.** Stash pop with conflicts leaves a mixed state: some files staged, some unstaged, some with conflict markers. Never assume it was clean.
3. **After conflict resolution, stage ALL files.** When stash pop has conflicts, only non-conflicting files are auto-staged. The conflicted file is unstaged with markers. After resolving, `git add` everything -- not just the conflicted file.
4. **Verify commit contents before push.** `git show --stat` or `gt diff` to confirm the commit includes all expected files. Especially after stash/merge/rebase.
5. **Prefer commit-then-rebase over stash-then-restack.** Commit WIP first, then `gt sync` + `gt restack`. Merge conflicts are explicit and affect the commit directly. Avoids the stash pop failure mode.
6. **If restack fails with unstaged changes, commit first.** Don't reach for stash. A messy commit you can amend is safer than a stash you might lose.
7. **Never discard unstaged changes without user approval.** Includes `git checkout -- .`, `git restore`, `git stash`, `git clean`.

### Moving Changes to a New Worktree

When you have unstaged changes and need them on a different branch in a new worktree:

**DO: Create the worktree clean, then re-apply edits directly.**

```bash
git worktree add -b <branch-name> <path> <base>
# Then use the edit tool on absolute paths in the worktree -- no copy, no patch
cd <path> && gt modify && gt submit
```

**DON'T:**

- `git diff > patch && git apply` -- bash guard blocks `git apply`, patches are fragile across branches
- `cp` files between checkouts -- copies whatever's on disk, including changes from other branches
- Stash in the source checkout to switch branches -- stash pop conflicts cascade
- Create worktrees on `origin/main` without `-b` -- detached HEAD

## Lessons Learned (sessions 019dbfa8, 019dbfcd)

These rules were extracted from two sessions with severe worktree missteps:

**CWD drift (019dbfa8):** Agent never switched CWD to the worktree after confirming it existed. All `gh` commands ran from the main checkout. Led to proposing "copy files back to main checkout" instead of committing directly from the worktree.

**Stash disaster (019dbfa8):** CI failed, agent stashed to restack, stash pop conflicted, agent staged only the conflicted file, pushed incomplete commit (5 files missing). Two CI failures before discovering the unstaged files.

**Transfer instead of re-create (019dbfcd):** Asked to move edits to a new worktree. Agent tried patches (blocked by bash guard, 4 attempts), file copies (contaminated from wrong branch, twice), stash gymnastics (2 stashes, 2 conflicts). **94 bash commands for a 3-command task.** Should have created a clean worktree and re-applied edits with the edit tool.

**Bash guard thrashing (019dbfa8):** When bash guard blocked `git`, agent tried 5+ workarounds (`GIT_OVERRIDE=1`, `GIT_DIR=.git`, `command git`, `/usr/bin/git`). Wasted ~6 tool calls. When bash guard blocks git, switch to `read`/`grep` immediately.

## Git Worktree Reference

### Shared vs. isolated

| Shared (`.git/commondir`)        | Per-worktree (isolated)       |
| -------------------------------- | ----------------------------- |
| Object database (commits, blobs) | HEAD (current branch)         |
| Remote config                    | Index / staging area          |
| Packed refs                      | Working tree files            |
| Hooks                            | Build artifacts, node_modules |

### Key commands

```bash
git worktree add -b <branch> <path> <base>  # new branch from base
git worktree add <path> <branch>             # existing branch
git worktree list                            # list all
git worktree remove <path>                   # remove (refuses if dirty)
git worktree prune                           # clean stale metadata
git worktree repair                          # fix broken paths after moving repo
```

### Common pitfalls

- **Same branch in two worktrees** -- git prevents this. Create a different branch name.
- **Manual `rm -rf`** -- use `git worktree remove`. If already deleted, `git worktree prune`.
- **Moving main repo** -- breaks absolute paths. Fix with `git worktree repair`.
- **Missing dependencies** -- `node_modules` etc. are per-worktree, not shared.
- **Detached HEAD** -- worktrees created from commits/tags. Must `git checkout <branch>` first.
- **Stale worktrees** -- remove immediately after branch merges. 10 worktrees of 2GB repo = 20GB.

### AI agent-specific pitfalls

- **CWD drift (#1)** -- agent defaults to session CWD (main checkout). Switch to worktree immediately.
- **Stash mismanagement (#2)** -- agent reaches for stash on "conflicting unstaged changes", doesn't verify stash pop state. Commit first instead.
- **Index corruption** -- concurrent `git add` from two sessions corrupts the index. One writer per worktree.
- **Context contamination** -- reading mid-edit files produces stale reasoning. Worktree isolation prevents this between trees.
- **Orphaned worktrees** -- clean up in session teardown.
- **Branch confusion after checkout** -- edits from detached HEAD may not survive checkout. Verify after switching.

## WTP (shop/world)

- `_wtp status` / `_wtp new` / `_wtp free <slot> [--force]`
- Never use `dev tree add` / `dev tree remove` directly
- For other repos: `git worktree` commands with naming convention `<repo>-<purpose>`
