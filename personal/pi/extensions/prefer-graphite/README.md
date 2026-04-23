---
summary: Intercepts mutating git commands in Graphite repos and redirects to gt equivalents.
category: general
keywords: [git, graphite, stacking, workflow]
---

# Prefer Graphite Extension

Intercepts mutating git commands in [Graphite](https://graphite.dev)-managed repos and redirects the agent to use `gt` equivalents instead.

## What it does

When the agent runs a `bash` tool call, this extension walks up from the working directory looking for a `.graphite` directory (created by `gt init`). If found, mutating git commands are **blocked** with the exact `gt` command to use — the agent self-corrects without user intervention.

Read-only commands (`git status`, `git diff`, `git log`, etc.) are allowed through untouched.

### Redirect mapping

| git command | gt equivalent |
|---|---|
| `git checkout -b` | `gt create` |
| `git checkout` | `gt co`, `gt get`, `gt up`, `gt down` |
| `git switch -c` / `git switch --create` | `gt create` |
| `git switch` | `gt co`, `gt get` |
| `git push` | `gt submit`, `gt ss` |
| `git pull` | `gt get` |
| `git rebase` | `gt restack` |
| `git merge` | `gt fold` |
| `git branch -d` / `-D` / `--delete` | `gt delete`, `gt delete --force` |
| `git branch` | `gt log`, `gt ls`, `gt create` |
| `git commit --amend` | `gt modify` |
| `git commit` | `gt create`, `gt modify` |

Any other mutating git command not in the table is also blocked with a generic hint to load the graphite skill.

### Passthrough commands

These git commands are allowed through without interception — they're read-only or staging-only operations with no `gt` equivalent:

`git status`, `git diff`, `git log`, `git show`, `git blame`, `git grep`, `git rev-parse`, `git describe`, `git ls-files`, `git cat-file`, `git for-each-ref`, `git stash`, `git fetch`, `git add`

> **Why `git add`?** There is no `gt` equivalent for selectively staging files. `gt create --all` and `gt modify -a` stage *everything*, but you often need to stage specific files before running `gt modify` or split changes across stacked branches with `gt create`.

## Detection

**Zero config.** The extension auto-detects Graphite repos using two strategies:

1. **Walk up** from the working directory looking for a `.graphite` directory (standard `gt init` layout).
2. **Check the git common dir** for `.graphite_repo_config` (worktree layouts where the real git dir is shared, e.g. `~/world`).

Results are cached per directory for the session. Repos without Graphite are completely unaffected.

## Setup

Install the `shop-pi-fy` package and the extension activates automatically.
