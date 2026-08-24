# PR System Resolution (GitHub vs Meteorite)

`shop/world` PRs live in **two systems with separate number namespaces**. Resolve which one
before running any PR command. Referenced by skills that act on a PR the user supplied.

| System | Numbers | Web URL | CLI |
| --- | --- | --- | --- |
| GitHub | ~`984xxx` | `github.com/shop/world/pull/<N>` | `gh` |
| Gitstream / Meteorite | ~`2013xxx` | `meteorite.shopify.io/repos/shop/world/pulls/<N>` | `gs` |

A GitHub PR is invisible to `gs` and a Meteorite PR is invisible to `gh` — the number is not
portable between them. Never guess from the magnitude of the number; resolve it.

## Resolve

```bash
# $PR is a number or any PR URL (github.com, meteorite.shopify.io, or api.gitstream.shopify.io)
case "$PR" in
  *github.com*)     PR_SYS=gh ;;
  *meteorite.shopify.io*|*gitstream.shopify.io*) PR_SYS=gs ;;
  *) if gs pr view "$PR" --json >/dev/null 2>&1; then PR_SYS=gs
     elif gh pr view "$PR" --repo shop/world --json number >/dev/null 2>&1; then PR_SYS=gh
     else echo "PR $PR not found in either system"; exit 1
     fi ;;
esac
echo "$PR_SYS"
```

Probe order is `gs` first: it is authoritative for new PRs, and a stale `gh` token fails
open (exit 1) rather than mis-resolving.

Repos other than `shop/world` are always `gh`. `gs` only serves gitstream-backed repos.

## Two `gs` read surfaces — check both before declaring a gap

`gs pr view <N> --json` is a **thin summary**: `number`, `title`, `state`, `draft`, `headRef`,
`baseRef`, `headSha`, `baseSha`, `url`, `htmlUrl`, `body`, `author`, `assignees`, `createdAt`,
`updatedAt`, `mergeable`, `mergeableState`. Field names differ from `gh` — `headRef`, not
`headRefName`.

`gs api repos/{owner}/{repo}/pulls/<N>` returns the **full GitHub-shaped REST object**, which
is much wider: `additions`, `deletions`, `changed_files`, `labels`, `merged`, `merged_at`,
`merged_by`, `comments`, `review_comments`, `open_review_thread_count`, `requested_reviewers`,
`requested_teams`, `commits`, `reactions`, `closed_at`, `locked`, `merge_commit_sha`.

So anything missing from `gs pr view --json` is usually still reachable:

| Need | Not on `gs pr view --json` | Use instead |
| --- | --- | --- |
| Review verdicts | `reviews`, `reviewDecision` | `gs api repos/{owner}/{repo}/pulls/<N>/reviews` → `state` (`APPROVED`/`CHANGES_REQUESTED`/`COMMENTED`), `user`, `submitted_at`, `body` |
| Diff size | `additions`, `deletions` | `gs api repos/{owner}/{repo}/pulls/<N>` → `additions`, `deletions`, `changed_files` |
| Changed files | `files` | `gs api repos/{owner}/{repo}/pulls/<N>/files`, or `gs pr diff <N> --name-only` |
| Labels | `labels` | `gs api repos/{owner}/{repo}/pulls/<N>` → `labels[]` |
| Merge state | `mergedAt` | `gs api repos/{owner}/{repo}/pulls/<N>` → `merged`, `merged_at`, `merged_by` |
| Thread resolution | — | `gs pr view <N> --comments` marks each thread `(resolved)` / `(unresolved)`; count via `open_review_thread_count` |

### Confirmed unavailable

These have no `gs` equivalent — do not go looking:

- **Path-scoped diff.** `gs pr diff <N> -- <path>` errors with `gs: accepts 1 arg(s), received 2`. Narrow the full diff locally, or use `--name-only`.
- **`/threads` REST endpoint.** 404s. Thread UUIDs come only from `gs pr view <N> --comments`, so capture them in the same pass — nothing recovers them later.
- **GraphQL.** No endpoint at all; `resolveReviewThread` has no analogue beyond `gs pr resolve`.
- **Cross-repo search.** Nothing maps to `gh search prs`. `gs pr list` is `shop/world`-only and has no review-state filter, so filtering by review state costs one `gs api …/reviews` call per candidate.

## Command map

Once `PR_SYS` is known, every verb has a counterpart. `gs` has **no `--jq`** — pipe `--json`
through `jq`.

| Action | `gh` | `gs` |
| --- | --- | --- |
| Read | `gh pr view <N> --json …` | `gs pr view <N> --json` |
| Read + threads | `gh api …/pulls/<N>/comments` | `gs pr view <N> --comments` (prints thread UUIDs) |
| Diff | `gh pr diff <N>` | `gs pr diff <N>` (`--name-only` only — no pathspec) |
| List | `gh pr list` / `gh search prs` | `gs pr list` (`--review-requested @me`, `--author @me`, `--everyone`, `--head <branch>`) |
| Checks | `gh pr checks <N>` | `gs pr checks <N>` — **no `--watch`**; exit 8 = pending |
| Comment | `gh pr comment <N> --body-file f` | `gs pr comment <N> --body-file f` |
| Reply to thread | `gh api …/comments/<id>/replies` | `gs pr comment <N> --reply-to <id> --body-file f` |
| Resolve thread | `gh api graphql resolveReviewThread` | `gs pr resolve <N> <thread-uuid>` |
| React | `gh api …/comments/<id>/reactions -f content='+1'` | `gs pr react <N> <comment-id> --thumbs-up` |
| Review verdict | `gh pr review <N> --approve` | `gs pr review <N> --approve` |
| Inline review | `gh api …/pulls/<N>/reviews --input -` | `gs api …/pulls/<N>/reviews --input -` (same payload) |
| Edit | `gh pr edit <N> --title …` | `gs pr edit <N> --title …` (assignees/reviewers are **Shopify emails**, not handles) |
| Ready | `gh pr ready <N>` | `gs pr ready <N>` (`--undo` flips back to draft) |
| Raw API | `gh api <endpoint>` | `gs api <endpoint>` — mechanical swap, same REST shape |
| Web link | `github.com/shop/world/pull/<N>` | `gs pr view <N> --json \| jq -r .htmlUrl` |

## Gotchas

- **Never report the `url` field for a Meteorite PR.** It is `api.gitstream.shopify.io/...`,
  which a human cannot open. The browsable link is `htmlUrl`.
- **`gs pr resolve` takes a UUID**, not a GraphQL `PRRT_…` node id. Get it from
  `gs pr view <N> --comments`, which prints `thread: <uuid>` under each file:line.
- **`gs pr review` has no inline-comment flag.** Line-level comments go through
  `gs api repos/{owner}/{repo}/pulls/<N>/reviews --input -`; the payload is identical to the
  GitHub Reviews API (`path`, `line`, `side`, `body`). See `knowledge/pr-review-posting.md`.
- **No `gs pr checks --watch`.** Poll on an interval and read the exit code (8 = pending).
- **`gs api` fills in `{owner}`/`{repo}`** from the resolved World repo, so bare paths work.
- **No PR-URL-to-builds tool.** Get the Buildkite build URL from `gh pr checks <N>`, or from
  `gs pr checks <N> --json` for a Meteorite PR, then pass it to the `buildkite_*` tools as
  `build_url`.
- **Binks runs on Meteorite PRs.** Its threads carry the same
  `<!-- binks-thread:<hash> -->` marker.
- **Merging is unchanged**: the `/merge` comment and the Meteorite Merge button are the same
  action. Never run `gs pr merge` — it bypasses the merge queue.

## Related

- [wtp-checkout.md](wtp-checkout.md) — worktree checkout for the resolved head branch
- `knowledge/gitstream-meteorite.md` — new-PR creation defaults and `gt` → `gs` stack mechanics
