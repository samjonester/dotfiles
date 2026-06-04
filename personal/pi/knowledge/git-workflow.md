# Git Workflow — shop/world (Current)

GitStream-centric workflow integrating Graphite, GitStream, and Merge Garden. This area moves fast — verify against canonical docs if something breaks.

## Core Principles

- **Push to GitStream (`origin`), never directly to GitHub.** `origin` = `https://gitstream.shopify.io/shop/world.git`. CI/WCB/Bitrise/merge automation treat GitStream as source of truth — commits only on GitHub may be invisible to them.
- **Use plain `git`** for branching, syncing, rebasing, pushing. `gt`/Graphite is no longer the default.
- **Prefer `dev open pr`** for PR creation (over `gh pr create`).
- **Enqueue merges with the `/merge` PR comment** — NOT the Graphite merge button. (Current guidance; supersedes the old `mergeit` label flow.)
- **Avoid GitHub/Graphite UI write actions**: restack, merge, web editor, commit suggestions, conflict resolution, squash/rebase/update-branch buttons. Make changes locally, push through GitStream.

## Default Flow

```sh
git fetch origin main
git switch -c my-branch origin/main
# edit, test
git add <files> && git commit -m "Do the thing"
git push -u origin HEAD
dev open pr
# if stale:
git fetch origin main && git rebase origin/main
git push --force-with-lease --force-if-includes origin HEAD
# when ready (CI must be green):
gh pr comment <PR> --body "/merge"
```

## Syncing & Pushing

- Sync via rebase, not merge: `git fetch origin main && git rebase origin/main`.
- Avoid bare `git fetch` / `git pull` / `git fetch --all` (slow in World, pulls unrelated refs). Use explicit refs: `git fetch origin main`.
- Force push: `--force-with-lease --force-if-includes`, never raw `--force` (raw `--force` is a recovery path only — ask `#help-gitstream`).

## CI & Merging

- CI does NOT auto-run on push. Trigger explicitly: `devx ci run`.
- `/merge` only works once CI is green; `/cancel-merge` to evict. `devx ci merge-when-ready` runs CI and merges if it passes.

## Stacks

- Plain branch-off-branch stacks work; use `gt` only for stack-specific mechanics (restack, navigate, modify in-stack) until the `gs` CLI replaces it. Be cautious with `gt get/sync/submit`.
- `/merge` on an upper PR queues it + everything downstack; on the bottom PR queues only the bottom.

## Commit Hygiene

- shop/world lands **merge commits**, not squash-and-merge. Keep commits atomic; clean up "fix typo"/"oops"/"address review" before merging. Don't rely on the queue to squash history.

## Troubleshooting

- Pushed but PR/CI didn't update: `dev gitstream push-status <branch>`, `dev gitstream info`, `dev gitstream help`.
- Missing commit after rebase/amend: `git reflog` before anything destructive. Weird ref/tag state: `dev repo streamline`.
- Bot/external process (Translation Platform, bumperbot) updated branch on GitHub only (`not our ref`, `commit_unavailable`): reconcile with `dev gitstream sync-github-ref <branch>` (fast-forward case only — if not a FF, ask `#help-gitstream`, don't force-push).

## Worktrees

- See `worktree-discipline.md`. Canonical shop/world guidance is `dev tree` (preserves sparse checkout/shadowenv/zone wiring); Sam uses the `_wtp` wrapper.

## Sam's Rules (preserved)

- New branch work: present changes for review **before** committing. Amendments on existing branches (CI fixes, review feedback): commit freely.

## Source
- "Current shop/world Git workflow best practices" — Tom Spencer, Vault post 385386, published 2026-06-01 (last updated 2026-06-02): https://vault.shopify.io/posts/385386-Current-shop-world-Git-workflow-best-practices
- Canonical: https://vault.shopify.io/docs/craft/2200-Engineering/development_handbook/keytech/github/shop_world_git_workflow
- Captured 2026-06-02 by Sam (prior content: graphite-workflow.md migration, Sam Jones 2026-05-26).
