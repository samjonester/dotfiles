# Git Workflow — shop/world (Current)

GitStream-centric workflow integrating GitStream, Meteorite, and Merge Garden. This area moves fast — verify against canonical docs if something breaks.

## Core Principles

- **Push to GitStream (`origin`), never directly to GitHub.** `origin` = `https://gitstream.shopify.io/shop/world.git`. CI/WCB/Bitrise/merge automation treat GitStream as source of truth — commits only on GitHub may be invisible to them.
- **Use plain `git`** for branching, syncing, rebasing, pushing. `gt`/Graphite is fully superseded by `gs`.
- **Open new PRs with `gs pr create`** (Meteorite is the default as of 2026-08-17; draft by default). Supersedes `dev open pr` and `gh pr create`. See `gitstream-meteorite.md`.
- **Acting on an existing PR? Resolve the system first** — GitHub and Meteorite have separate number namespaces. See `skills/_shared/pr-system.md`.
- **Enqueue merges with the `/merge` PR comment** — NOT the Graphite merge button. The Meteorite Merge button is the same action as the comment. Never `gs pr merge` (bypasses the queue).
- **Avoid GitHub/Graphite UI write actions**: restack, merge, web editor, commit suggestions, conflict resolution, squash/rebase/update-branch buttons. Make changes locally, push through GitStream.

## Default Flow

```sh
git fetch origin main
git switch -c my-branch origin/main
# edit, test
git add <files> && git commit -m "Do the thing"
git push -u origin HEAD
gs pr create --base main --title "$(git log -1 --format='%s')" --body-file <path>
gs pr view <N> --json | jq -r .htmlUrl   # the link to report
# if stale:
git fetch origin main && git rebase origin/main
git push --force-with-lease --force-if-includes origin HEAD
# when ready (CI must be green):
gs pr comment <PR> --body "/merge"   # gh pr comment for a GitHub PR
```

## Syncing & Pushing

- Sync via rebase, not merge: `git fetch origin main && git rebase origin/main`.
- Avoid bare `git fetch` / `git pull` / `git fetch --all` (slow in World, pulls unrelated refs). Use explicit refs: `git fetch origin main`.
- Force push: `--force-with-lease --force-if-includes`, never raw `--force` (raw `--force` is a recovery path only — ask `#help-gitstream`).

## CI & Merging

- CI does NOT auto-run on push. Trigger explicitly: `devx ci run`.
- `/merge` only works once CI is green; `/cancel-merge` to evict. `devx ci merge-when-ready` runs CI and merges if it passes.

## Stacks

- Plain branch-off-branch stacks work. `gs` has replaced `gt` for stack mechanics: `gs create/track`, `gs modify`, `gs restack --upstack`, `gs sync`, `gs submit --stack`, `gs log`, `gs up/down/top/bottom`. Conflicts halt — resolve then `gs continue` (`gs abort`, `gs undo`). See `gitstream-meteorite.md`.
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
- Meteorite/`gs` PR defaults added 2026-08-24 — see `gitstream-meteorite.md` for sources.
