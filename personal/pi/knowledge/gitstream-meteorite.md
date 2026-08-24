# Gitstream PRs & Meteorite (shop/world)

Meteorite is the default for **opening new PRs** in `shop/world`. Everything else depends on
where the PR already lives — resolve it, don't assume.

## New PRs → `gs` (shop/world only)

```sh
git push origin HEAD
gs pr create --base main --title "$(git log -1 --format='%s')" --body-file <path>
gs pr view <N> --json | jq -r .htmlUrl   # the link to report
```

- `--draft` is the **default**. Pass `--publish` only when explicitly asked.
- `gs pr create` does **not** push — push first, or use `gs submit` (pushes + creates in one).
- Report the `htmlUrl` (`meteorite.shopify.io/repos/shop/world/pulls/<N>`). The `url` field is
  the unopenable `api.gitstream.shopify.io` host.
- Other repos (`shop-pi-fy`, `growth-data-products`, `terraform-the-cloud`,
  `shopify-playground/*`, `Shopify/*`) stay on `gh pr create --draft`. `gs` only serves
  gitstream-backed repos.

## Existing PRs → resolve first

Gitstream PR numbers (~`2013xxx`) and GitHub PR numbers (~`984xxx`) are **separate
namespaces**. A GitHub PR returns `Not Found` from `gs`, and vice versa. Before any read,
comment, review, or check on a user-supplied PR, run the resolver in
`skills/_shared/pr-system.md` — it also carries the full `gh` → `gs` verb map.

## Stacks: `gs` replaces `gt`

`gs` now covers the stack mechanics that previously required Graphite:

```sh
gs create <name>        # tracked branch on top of current
gs modify -m "…"        # amend + restack descendants
gs restack --upstack    # rebase current branch + descendants
gs sync                 # fetch trunk, materialize missing branches, restack
gs submit --stack       # push + create/retarget every PR in the stack
gs log                  # render tracked stacks (alias: gs ls)
gs up / down / top / bottom
```

Conflicts halt the operation: resolve, then `gs continue` (`gs abort` to bail, `gs undo` to
restore the last snapshot).

Two stack failures are expected on a plain `git checkout -b` branch and are **not** a reason
to fall back to GitHub — push and use `gs pr create` instead:

- `gs: no stacks tracked in this repo`
- `read …/.git/.gs/state.json: not a directory` (Worldtree checkouts — `.git` is a stub file)

## Setup

- `gs` ships in the base `tec` toolchain — already on `PATH`, no `shadowenv exec`.
- `gs auth status` to check; `gs auth login` to fix.
- Defaults to `shop/world`; override with `GS_REPO_OWNER` / `GS_REPO_NAME`.

## Never

- `gs pr merge` — bypasses the merge queue. Merge with the `/merge` comment or the Meteorite
  Merge button (identical actions).
- Repairing a failed `gs` push/create with `gh pr create` or `gt submit` — that lands the PR in
  the wrong system. A task with a PR in each system is worse than a task that stopped and asked.

## Source

- Jon Bastien's #announcements post, 2026-08-17 (Meteorite GA):
  https://shopify.enterprise.slack.com/archives/C07ATD6DE2C/p1786994519346329
- Guide: https://gitstream-pr-guide.quick.shopify.io/ (Chao Duan, updated 2026-08-18)
- Skill: https://skills.quick.shopify.io/#/skills/gitstream-pr (`shop/world`
  `areas/tools/ae/skills/gitstream-pr/SKILL.md`)
- Support: `#help-meteorite-and-gs`. Known issues:
  https://github.com/orgs/shop/projects/1660/views/1
- Capability surface verified against `gs` 23557a3b by Sam, 2026-08-24.
